-- In-app activity only. No historical backfill, external delivery, rewards or paywall.
begin;
create table public.couple_activity_events (
 id uuid primary key default gen_random_uuid(),
 space_id uuid not null references public.couple_spaces on delete cascade,
 am uuid not null references public.couple_members on delete cascade,
 bm uuid not null references public.couple_members on delete cascade,
 actor_id uuid not null references auth.users on delete cascade,
 recipient_id uuid not null references auth.users on delete cascade,
 kind text not null check(kind in ('task_consent','task_partial','task_done','goal_consent','goal_done','ritual_consent','ritual_partial','ritual_done','connection_invite','connection_ready','connection_notify','reaction')),
 source_id uuid not null, slot integer not null default 0 check(slot between 0 and 150),
 created_at timestamptz not null default clock_timestamp(), read_at timestamptz,
 unique(kind,source_id,slot,actor_id,recipient_id), check(am<>bm)
);
create index activity_inbox_page on public.couple_activity_events(recipient_id,created_at desc,id desc);
create index activity_unread on public.couple_activity_events(recipient_id,created_at desc,id desc) where read_at is null;
create table public.couple_activity_reactions (
 event_id uuid not null references public.couple_activity_events on delete cascade,
 user_id uuid not null references auth.users on delete cascade,
 kind text not null check(kind in ('support','sweet','proud','thanks')),
 updated_at timestamptz not null default clock_timestamp(), primary key(event_id,user_id)
);
create table public.couple_activity_preferences (
 user_id uuid primary key references auth.users on delete cascade,
 reactions_enabled boolean not null default true
);
create table public.couple_activity_requests (
 user_id uuid not null references auth.users on delete cascade, request_id uuid not null,
 intent text not null, primary key(user_id,request_id)
);
create table public.couple_activity_cursors (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users on delete cascade,
 context text not null, ceiling timestamptz not null, last_at timestamptz not null, last_id uuid not null,
 expires_at timestamptz not null default clock_timestamp()+interval '30 minutes', created_at timestamptz not null default clock_timestamp()
);
create index activity_cursor_owner on public.couple_activity_cursors(user_id,created_at desc);

-- Internal source predicate; never returns saved private text, and never trusts a
-- historical inbox row as permission. Exact memberships prevent all rejoin leaks.
create function public.activity_source_visible(e public.couple_activity_events) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare base public.couple_activity_events; s public.connection_sessions;
begin
 if not exists(select 1 from public.couple_members a join public.couple_members b on b.space_id=a.space_id
   where a.id=e.am and b.id=e.bm and a.space_id=e.space_id and a.left_at is null and b.left_at is null
   and auth.uid() in(a.user_id,b.user_id) and e.actor_id in(a.user_id,b.user_id) and e.recipient_id in(a.user_id,b.user_id)) then return false; end if;
 case e.kind
 when 'task_consent' then
   return exists(select 1 from public.tasks t join public.task_participants p on p.task_id=t.id
     where t.id=e.source_id and t.status='pending' and p.user_id=e.recipient_id and p.consent='pending' and public.can_read_task(t.id));
 when 'task_partial','task_done' then
   return exists(select 1 from public.task_instances i join public.tasks t on t.id=i.task_id
     where i.id=e.source_id and t.kind='joint' and public.can_read_task(t.id) and t.status in ('active','completed')
     and i.status=case e.kind when 'task_done' then 'completed' else 'active' end
     and (e.kind='task_done' or t.recurrence='once' or i.period_start=public.task_period(t.recurrence,t.anchor_date))
     and exists(select 1 from public.task_completions c where c.instance_id=i.id and c.user_id=e.actor_id)
     and (select count(*) from public.task_participants p where p.task_id=t.id and p.consent='accepted')=2);
 when 'goal_consent' then
   return exists(select 1 from public.goal_consents c where c.id=e.source_id and c.status='pending' and public.can_read_goal(c.goal_id));
 when 'goal_done' then
   return exists(select 1 from public.couple_goals g where g.id=e.source_id and g.status='completed' and public.can_read_goal(g.id));
 when 'ritual_consent' then
   return exists(select 1 from public.ritual_consents c where c.id=e.source_id and c.status='pending' and public.can_read_ritual(c.ritual_id));
 when 'ritual_partial','ritual_done' then
   return exists(select 1 from public.ritual_instances i where i.id=e.source_id and public.can_read_ritual(i.ritual_id)
     and i.status=case e.kind when 'ritual_done' then 'completed' else 'partial' end
     and (e.kind='ritual_done' or i.scheduled_on=(public.ritual_clock() at time zone 'UTC')::date)
     and exists(select 1 from public.ritual_completions c where c.instance_id=i.id and c.user_id=e.actor_id));
 when 'connection_invite','connection_notify','connection_ready' then
   select * into s from public.connection_sessions where id=e.source_id;
   if not found or not public.connection_access(s.id) then return false; end if;
   if e.kind='connection_invite' then return s.status='pending'; end if;
   if s.status not in ('active','paused','completed') then return false; end if;
   if s.kind='game' and not exists(select 1 from public.connection_draws d join public.connection_catalog c on c.kind='card' and c.id=d.card_id
     where d.session_id=s.id and d.slot=e.slot and (s.opt_a and s.opt_b or c.content->>'category' not in ('heat','secret'))) then return false; end if;
   if e.kind='connection_notify' then
     return exists(select 1 from public.connection_events n where n.session_id=s.id and n.position=e.slot and n.sender=e.actor_id and n.recipient=e.recipient_id);
   end if;
   -- Both publications, even when the current reader owns one answer. No early metadata leak.
   return (select count(*) from public.connection_answers a where a.session_id=s.id and a.slot=e.slot and a.submitted and a.published and a.user_id in(s.a,s.b))=2;
 when 'reaction' then
   if not coalesce((select reactions_enabled from public.couple_activity_preferences where user_id=e.recipient_id),true) then return false; end if;
   select * into base from public.couple_activity_events where id=e.source_id and kind<>'reaction';
   return found and base.actor_id=e.recipient_id and base.recipient_id=e.actor_id and public.activity_source_visible(base)
     and exists(select 1 from public.couple_activity_reactions r where r.event_id=base.id and r.user_id=e.actor_id);
 else return false;
 end case;
end $$;
create function public.activity_event_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.couple_activity_events e where e.id=p_id and e.recipient_id=auth.uid() and public.activity_source_visible(e));
$$;
-- Called only by business triggers while the source transaction holds its locks.
create function public.activity_emit(p_space uuid,p_actor uuid,p_recipient uuid,p_kind text,p_source uuid,p_slot integer default 0) returns void
language plpgsql security definer set search_path='' as $$
declare a uuid; b uuid;
begin
 select m.id into a from public.couple_members m where m.space_id=p_space and m.user_id=p_actor and m.left_at is null;
 select m.id into b from public.couple_members m where m.space_id=p_space and m.user_id<>p_actor and m.left_at is null;
 if a is null or b is null or not exists(select 1 from public.couple_members where id in(a,b) and user_id=p_recipient) then return; end if;
 insert into public.couple_activity_events(space_id,am,bm,actor_id,recipient_id,kind,source_id,slot)
 values(p_space,a,b,p_actor,p_recipient,p_kind,p_source,p_slot) on conflict do nothing;
end $$;
create function public.activity_from_source() returns trigger
language plpgsql security definer set search_path='' as $$
declare sp uuid; actor uuid; other uuid; source uuid; k text; pos integer:=0; s public.connection_sessions; t public.tasks; g public.couple_goals; r public.couple_rituals; peer record;
begin
 case TG_TABLE_NAME
 when 'task_participants' then
   if new.consent<>'pending' then return new; end if;
   select * into t from public.tasks where id=new.task_id;
   if t.kind not in ('proposal','joint') or new.user_id=t.creator_id then return new; end if;
   perform public.activity_emit(t.space_id,t.creator_id,new.user_id,'task_consent',t.id); return new;
 when 'task_completions' then
   select tt.* into t from public.tasks tt join public.task_instances i on i.task_id=tt.id where i.id=new.instance_id;
   if t.kind<>'joint' then return new; end if;
   sp:=t.space_id; actor:=new.user_id; source:=new.instance_id; k:='task_partial';
 when 'task_instances' then
   if new.status<>'completed' or old.status='completed' then return new; end if;
   select * into t from public.tasks where id=new.task_id;
   if t.kind<>'joint' then return new; end if;
   for peer in select user_id from public.task_participants where task_id=t.id and consent='accepted' loop
     perform public.activity_emit(t.space_id,auth.uid(),peer.user_id,'task_done',new.id);
   end loop; return new;
 when 'goal_consents' then
   if new.status<>'pending' then return new; end if;
   select * into g from public.couple_goals where id=new.goal_id;
   sp:=g.space_id; actor:=new.requester_id; source:=new.id; k:='goal_consent';
 when 'couple_goals' then
   if new.status<>'completed' or old.status='completed' then return new; end if;
   perform public.activity_emit(new.space_id,auth.uid(),new.creator_id,'goal_done',new.id);
   perform public.activity_emit(new.space_id,auth.uid(),new.partner_id,'goal_done',new.id); return new;
 when 'ritual_consents' then
   if new.status<>'pending' then return new; end if;
   select * into r from public.couple_rituals where id=new.ritual_id;
   sp:=r.space_id; actor:=new.requester_id; source:=new.id; k:='ritual_consent';
 when 'ritual_completions' then
   select i.space_id into sp from public.ritual_instances i where i.id=new.instance_id;
   actor:=new.user_id; source:=new.instance_id; k:='ritual_partial';
 when 'ritual_instances' then
   if new.status<>'completed' or old.status='completed' then return new; end if;
   select * into r from public.couple_rituals where id=new.ritual_id;
   perform public.activity_emit(new.space_id,auth.uid(),r.creator_id,'ritual_done',new.id);
   perform public.activity_emit(new.space_id,auth.uid(),r.partner_id,'ritual_done',new.id); return new;
 when 'connection_sessions' then
   perform public.activity_emit(new.space_id,new.a,new.b,'connection_invite',new.id); return new;
 when 'connection_answers' then
   select * into s from public.connection_sessions where id=new.session_id;
   if not new.submitted or not new.published or (select count(*) from public.connection_answers a where a.session_id=s.id and a.slot=new.slot and a.submitted and a.published)<>2 then return new; end if;
   perform public.activity_emit(s.space_id,s.a,s.b,'connection_ready',s.id,new.slot);
   perform public.activity_emit(s.space_id,s.b,s.a,'connection_ready',s.id,new.slot); return new;
 when 'connection_events' then
   if TG_OP='UPDATE' then
     if new.acknowledged and not old.acknowledged then
       update public.couple_activity_events set read_at=coalesce(read_at,clock_timestamp()) where kind='connection_notify' and source_id=new.session_id and slot=new.position and actor_id=new.sender and recipient_id=new.recipient and read_at is null;
     end if;
     return new;
   end if;
   select * into s from public.connection_sessions where id=new.session_id;
   perform public.activity_emit(s.space_id,new.sender,new.recipient,'connection_notify',new.session_id,new.position); return new;
 else return new;
 end case;
 select user_id into other from public.couple_members where space_id=sp and user_id<>actor and left_at is null;
 perform public.activity_emit(sp,actor,other,k,source,pos); return new;
end $$;
create trigger activity_task_consent after insert on public.task_participants for each row execute function public.activity_from_source();
create trigger activity_task_mark after insert on public.task_completions for each row execute function public.activity_from_source();
create trigger activity_task_done after update of status on public.task_instances for each row execute function public.activity_from_source();
create trigger activity_goal_consent after insert on public.goal_consents for each row execute function public.activity_from_source();
create trigger activity_goal_done after update of status on public.couple_goals for each row execute function public.activity_from_source();
create trigger activity_ritual_consent after insert on public.ritual_consents for each row execute function public.activity_from_source();
create trigger activity_ritual_mark after insert on public.ritual_completions for each row execute function public.activity_from_source();
create trigger activity_ritual_done after update of status on public.ritual_instances for each row execute function public.activity_from_source();
create trigger activity_connection_invite after insert on public.connection_sessions for each row execute function public.activity_from_source();
create trigger activity_connection_ready after insert or update on public.connection_answers for each row execute function public.activity_from_source();
create trigger activity_connection_notify after insert or update of acknowledged on public.connection_events for each row execute function public.activity_from_source();

create function public.activity_sync_read() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='connection_notify' and new.read_at is not null and old.read_at is null then
   update public.connection_events set acknowledged=true where session_id=new.source_id and position=new.slot and sender=new.actor_id and recipient=new.recipient_id and not acknowledged;
 end if; return new;
end $$;
create trigger activity_read_sync after update of read_at on public.couple_activity_events for each row execute function public.activity_sync_read();

-- Live labels are projected only after source authorization; no stale title snapshots.
create function public.activity_subject(e public.couple_activity_events) returns text
language sql stable security definer set search_path='' as $$
 select case
 when e.kind='task_consent' then (select title from public.tasks where id=e.source_id)
 when e.kind in ('task_partial','task_done') then (select t.title from public.task_instances i join public.tasks t on t.id=i.task_id where i.id=e.source_id)
 when e.kind='goal_consent' then (select g.title from public.goal_consents c join public.couple_goals g on g.id=c.goal_id where c.id=e.source_id)
 when e.kind='goal_done' then (select title from public.couple_goals where id=e.source_id)
 when e.kind='ritual_consent' then (select r.terms->>'title' from public.ritual_consents c join public.couple_rituals r on r.id=c.ritual_id where c.id=e.source_id)
 when e.kind in ('ritual_partial','ritual_done') then (select terms->>'title' from public.ritual_instances where id=e.source_id)
 when e.kind in ('connection_invite','connection_notify','connection_ready') then (select case kind when 'game' then 'Між нами' else 'Опитування для двох' end from public.connection_sessions where id=e.source_id)
 end where public.activity_source_visible(e);
$$;
revoke all on function public.activity_subject(public.couple_activity_events) from public,anon,authenticated;

create function public.activity_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();
begin
 return jsonb_build_object('context',public.ritual_context(),
 'unread',(select count(*) from (select 1 from public.couple_activity_events e where e.recipient_id=u and e.read_at is null and public.activity_source_visible(e) limit 100) q),
 'reactions_enabled',coalesce((select reactions_enabled from public.couple_activity_preferences where user_id=u),true),
 -- Today avoids duplicating the existing active-game invitation hero.
 'spotlight',(select to_jsonb(q) from (select e.id,e.kind,e.created_at,e.source_id,e.slot,public.activity_subject(e) as subject from public.couple_activity_events e where e.recipient_id=u and e.read_at is null
    and e.kind not in ('connection_invite','connection_notify','task_consent') and public.activity_source_visible(e)
    order by (e.kind in ('goal_consent','ritual_consent')) desc,e.created_at desc,e.id desc limit 1) q));
end $$;
create function public.list_couple_activity(p_cursor uuid default null,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user(); ctx text; c public.couple_activity_cursors; rows jsonb; last jsonb; token uuid; upper_at timestamptz;
begin
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'activity_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 ctx:=public.ritual_context(); upper_at:=clock_timestamp();
 if p_cursor is not null then
   select * into c from public.couple_activity_cursors where id=p_cursor and user_id=u and context=ctx and expires_at>clock_timestamp();
   if not found then raise exception 'activity_cursor_invalid'; end if; upper_at:=c.ceiling;
 end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]') into rows from (
   select e.id,e.kind,e.source_id,e.slot,e.actor_id,e.created_at,e.read_at,public.activity_subject(e) as subject,
    (e.kind<>'reaction' and e.actor_id<>u) as can_react,
    (select r.kind from public.couple_activity_reactions r where r.event_id=e.id and r.user_id=u) as own_reaction,
    (select r.kind from public.couple_activity_reactions r where e.kind='reaction' and r.event_id=e.source_id and r.user_id=e.actor_id) as reaction
   from public.couple_activity_events e where e.recipient_id=u and e.created_at<=upper_at and public.activity_source_visible(e)
    and (p_cursor is null or (e.created_at,e.id)<(c.last_at,c.last_id)) order by e.created_at desc,e.id desc limit p_limit+1
 ) q;
 if jsonb_array_length(rows)>p_limit then
   rows:=rows-p_limit; last:=rows->(p_limit-1);
   delete from public.couple_activity_cursors where user_id=u and (expires_at<=clock_timestamp() or id in(select id from public.couple_activity_cursors where user_id=u order by created_at desc,id offset 99));
   insert into public.couple_activity_cursors(user_id,context,ceiling,last_at,last_id) values(u,ctx,upper_at,(last->>'created_at')::timestamptz,(last->>'id')::uuid) returning id into token;
 end if;
 return jsonb_build_object('context',ctx,'items',rows,'next_cursor',token);
end $$;
-- Returns a currently authorized source link, never a stored stale URL or title.
create function public.read_couple_activity(p_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user(); e public.couple_activity_events; sp uuid; target uuid; path text;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select space_id into sp from public.couple_members where user_id=u and left_at is null;
 if sp is null then raise exception 'activity_unavailable'; end if;
 perform 1 from public.couple_spaces where id=sp for update;
 if p_id is null then
   update public.couple_activity_events x set read_at=clock_timestamp() where x.recipient_id=u and x.read_at is null and public.activity_source_visible(x);
   return jsonb_build_object('context',public.ritual_context());
 end if;
 select * into e from public.couple_activity_events where id=p_id and recipient_id=u for update;
 if not found or not public.activity_source_visible(e) then raise exception 'activity_unavailable'; end if;
 update public.couple_activity_events set read_at=coalesce(read_at,clock_timestamp()) where id=e.id;
 -- A support receipt may open the shared source, never the other recipient inbox.
 if e.kind='reaction' then select * into e from public.couple_activity_events where id=e.source_id and kind<>'reaction'; end if;
 case e.kind
 when 'connection_invite','connection_ready','connection_notify' then path:='/us/connection/session/'||e.source_id::text||case when e.slot>0 then '?card='||e.slot::text else '' end;
 when 'task_consent','task_partial' then path:='/tasks';
 when 'task_done' then path:='/tasks?instance='||e.source_id::text;
 when 'goal_consent' then select goal_id into target from public.goal_consents where id=e.source_id; path:='/goals/'||target::text;
 when 'goal_done' then path:='/goals/'||e.source_id::text;
 when 'ritual_consent','ritual_partial','ritual_done' then path:='/us/traditions';
 else path:='/activity';
 end case;
 return jsonb_build_object('context',public.ritual_context(),'path',path);
end $$;
create function public.set_activity_reaction(p_event uuid,p_kind text,p_expected text,p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user(); e public.couple_activity_events; sp uuid; current_kind text; h text; previous text;
begin
 if p_request is null or (p_kind is not null and p_kind not in ('support','sweet','proud','thanks')) or (p_expected is not null and p_expected not in ('support','sweet','proud','thanks')) then raise exception 'activity_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select space_id into sp from public.couple_members where user_id=u and left_at is null;
 if sp is null then raise exception 'activity_unavailable'; end if;
 perform 1 from public.couple_spaces where id=sp for update;
 select * into e from public.couple_activity_events where id=p_event and recipient_id=u for update;
 if not found or e.kind='reaction' or e.actor_id=u or not public.activity_source_visible(e) then raise exception 'activity_unavailable'; end if;
 h:=encode(sha256(convert_to(jsonb_build_array(p_event,p_kind,p_expected)::text,'UTF8')),'hex');
 select intent into previous from public.couple_activity_requests where user_id=u and request_id=p_request;
 if found then if previous<>h then raise exception 'activity_request_conflict'; end if; return; end if;
 select kind into current_kind from public.couple_activity_reactions where event_id=e.id and user_id=u;
 if current_kind is distinct from p_expected then raise exception 'activity_changed'; end if;
 if p_kind is null then delete from public.couple_activity_reactions where event_id=e.id and user_id=u;
 else
   insert into public.couple_activity_reactions values(e.id,u,p_kind,clock_timestamp()) on conflict(event_id,user_id) do update set kind=excluded.kind,updated_at=excluded.updated_at;
   if coalesce((select reactions_enabled from public.couple_activity_preferences where user_id=e.actor_id),true) then
     perform public.activity_emit(e.space_id,u,e.actor_id,'reaction',e.id);
   end if;
 end if;
 insert into public.couple_activity_requests values(u,p_request,h);
end $$;
create function public.set_activity_preferences(p_reactions_enabled boolean) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();
begin
 if p_reactions_enabled is null then raise exception 'activity_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 insert into public.couple_activity_preferences values(u,p_reactions_enabled) on conflict(user_id) do update set reactions_enabled=excluded.reactions_enabled;
end $$;

alter table public.couple_activity_events enable row level security;
alter table public.couple_activity_reactions enable row level security;
alter table public.couple_activity_preferences enable row level security;
alter table public.couple_activity_requests enable row level security;
alter table public.couple_activity_cursors enable row level security;
revoke all on public.couple_activity_events,public.couple_activity_reactions,public.couple_activity_preferences,public.couple_activity_requests,public.couple_activity_cursors from public,anon,authenticated;
grant select on public.couple_activity_events,public.couple_activity_reactions,public.couple_activity_preferences to authenticated;
create policy activity_read on public.couple_activity_events for select to authenticated using(public.activity_event_visible(id));
create policy activity_reaction_read on public.couple_activity_reactions for select to authenticated using(exists(select 1 from public.couple_activity_events e where e.id=event_id and public.activity_event_visible(e.id)));
create policy activity_preference_read on public.couple_activity_preferences for select to authenticated using(user_id=auth.uid());
revoke all on function public.activity_source_visible(public.couple_activity_events),public.activity_emit(uuid,uuid,uuid,text,uuid,integer),public.activity_from_source(),public.activity_sync_read(),public.activity_event_visible(uuid),public.activity_summary(),public.list_couple_activity(uuid,integer),public.read_couple_activity(uuid),public.set_activity_reaction(uuid,text,text,uuid),public.set_activity_preferences(boolean) from public,anon,authenticated;
grant execute on function public.activity_event_visible(uuid),public.activity_summary(),public.list_couple_activity(uuid,integer),public.read_couple_activity(uuid),public.set_activity_reaction(uuid,text,text,uuid),public.set_activity_preferences(boolean) to authenticated;
-- Keep the existing Today/visible-card receipt projection subject to the same
-- current category/status permission as the new inbox; no second invitation stream.
create or replace function public.connection_read(p_view text,p_id uuid default null,p_cursor jsonb default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.require_verified_user(); ctx text; result jsonb; s public.connection_sessions; rows jsonb; after_id uuid; after_time timestamptz; upper_time timestamptz; v_slot integer;
begin
 ctx:=public.ritual_context();
 if p_cursor is not null then
   if p_cursor->>'actor' is distinct from u::text or p_cursor->>'context' is distinct from ctx or p_cursor->>'view' is distinct from p_view or p_cursor->>'id' is distinct from coalesce(p_id::text,'') then raise exception 'connection_cursor_invalid'; end if;
   after_id:=(p_cursor->>'last_id')::uuid; after_time:=(p_cursor->>'last_time')::timestamptz; v_slot:=(p_cursor->>'slot')::integer;
 end if;
 upper_time:=coalesce((p_cursor->>'ceiling')::timestamptz,now());
 if p_view='home' then
   select jsonb_build_object('today',to_char((public.connection_clock() at time zone 'UTC')::date,'YYYY-MM-DD'),
    'moods',coalesce((select jsonb_agg(to_jsonb(m) order by day) from public.connection_moods m where m.user_id=u and day between (public.connection_clock() at time zone 'UTC')::date-29 and (public.connection_clock() at time zone 'UTC')::date),'[]'),
    'partner_mood',(select to_jsonb(m) from public.connection_moods m where m.user_id<>u and m.day=(public.connection_clock() at time zone 'UTC')::date and public.connection_mood_access(m.user_id,m.day) limit 1),
    'reactions',coalesce((select jsonb_agg(to_jsonb(r)) from public.connection_reactions r where public.connection_mood_access(r.owner_id,r.day) and r.day=(public.connection_clock() at time zone 'UTC')::date),'[]'),
    'active_game_id',(select id from public.connection_sessions where kind='game' and status in ('active','paused') and public.connection_access(id) limit 1),
    'game_version',(select count(*) from public.connection_sessions where a=u and kind='game'),
    'questionnaire_version',(select count(*) from public.connection_sessions where a=u and kind='questionnaire'),
    'events',coalesce((select jsonb_agg(to_jsonb(e)) from public.connection_events e where recipient=u and not acknowledged and public.connection_access(e.session_id) and exists(select 1 from public.connection_sessions cs join public.connection_draws d on d.session_id=cs.id and d.slot=e.position join public.connection_catalog c on c.kind='card' and c.id=d.card_id where cs.id=e.session_id and cs.status in ('active','paused','completed') and (cs.opt_a and cs.opt_b or c.content->>'category' not in ('heat','secret')))),'[]')) into result;
 elsif p_view='sessions' then
   select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc,id desc),'[]') into rows from (
     select ls.* from public.connection_sessions ls where ls.space_id=(select cm.space_id from public.couple_members cm where cm.user_id=u and cm.left_at is null) and public.connection_access(ls.id) and created_at<=upper_time
     and (after_time is null or (created_at,id)<(after_time,after_id)) order by created_at desc,id desc limit 20) t;
   result:=jsonb_build_object('items',rows,'next_cursor',case when jsonb_array_length(rows)=20 then jsonb_build_object('actor',u,'context',ctx,'view',p_view,'id','','ceiling',upper_time,'last_time',rows->19->>'created_at','last_id',rows->19->>'id') end);
 elsif p_view in ('session','history') or p_view ~ '^card-[1-9][0-9]{0,2}$' then
   select * into s from public.connection_sessions where id=p_id;
   if not found or not public.connection_access(s.id) then raise exception 'connection_unavailable'; end if;
   if p_view like 'card-%' then
     select jsonb_build_object('slot',d.slot,'card',c.content,'answers',(select jsonb_agg(jsonb_build_object('user_id',a.user_id,'draft',a.draft,'skipped',a.skipped)) from public.connection_answers a where a.session_id=s.id and a.slot=d.slot and public.connection_answer_access(a.session_id,a.user_id,a.slot))) into result from public.connection_draws d join public.connection_catalog c on c.kind='card' and c.id=d.card_id where d.session_id=s.id and d.slot=substring(p_view from 6)::integer and (s.opt_a and s.opt_b or c.content->>'category' not in ('heat','secret'));
   elsif p_view='session' then
     select coalesce(jsonb_agg(jsonb_build_object('user_id',a.user_id,'slot',a.slot,'submitted',a.submitted,'skipped',a.skipped,
      'version',case when a.user_id=u then a.version else null end,
      'draft',case when public.connection_answer_access(a.session_id,a.user_id,a.slot) then a.draft else null end)),'[]') into rows
      from public.connection_answers a where a.session_id=s.id and a.slot=case when s.kind='game' then s.position else 0 end and (a.user_id=u or s.status in ('active','paused','completed'));
     result:=jsonb_build_object('session',to_jsonb(s),'answers',rows,'card',(select c.content from public.connection_draws d join public.connection_catalog c on c.kind='card' and c.id=d.card_id where d.session_id=s.id and d.slot=s.position and (s.opt_a and s.opt_b or c.content->>'category' not in ('heat','secret'))),
       'remaining',150-s.position,'answer_count',(select count(*) from public.connection_answers where session_id=s.id and submitted and not skipped and public.connection_answer_access(session_id,user_id,slot)),'questionnaire',(select content from public.connection_catalog where kind='questionnaire' and id=s.catalog_id));
   else
     select coalesce(jsonb_agg(to_jsonb(t) order by t.slot desc),'[]') into rows from (
       select d.slot,c.content as card,(select jsonb_agg(jsonb_build_object('user_id',a.user_id,'draft',a.draft,'skipped',a.skipped)) from public.connection_answers a where a.session_id=s.id and a.slot=d.slot and public.connection_answer_access(a.session_id,a.user_id,a.slot)) as answers
       from public.connection_draws d join public.connection_catalog c on c.kind='card' and c.id=d.card_id
       where d.session_id=s.id and (d.slot<s.position or s.status='completed') and d.slot<coalesce(v_slot,151) and (s.opt_a and s.opt_b or c.content->>'category' not in ('heat','secret')) order by d.slot desc limit 20) t;
     result:=jsonb_build_object('items',rows,'next_cursor',case when jsonb_array_length(rows)=20 then jsonb_build_object('actor',u,'context',ctx,'view',p_view,'id',p_id,'ceiling',upper_time,'slot',rows->19->>'slot') end);
   end if;
 elsif p_view='request' then
   select r.result into result from public.connection_requests r where user_id=u and request_id=p_id;
   if result ? 'id' and not public.connection_access((result->>'id')::uuid) then result:='{}'::jsonb; end if;
 else raise exception 'connection_invalid'; end if;
 return jsonb_build_object('context',ctx,'data',result);
exception when invalid_text_representation then raise exception 'connection_cursor_invalid';
end $$;
commit;
