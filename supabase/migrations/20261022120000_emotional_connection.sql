-- Emotional dialogue: deliberately independent of all economic journals.
begin;
create table public.connection_catalog(kind text not null check(kind in ('card','questionnaire')), id text not null, version integer not null, content jsonb not null, primary key(kind,id));
create table public.connection_moods (
 user_id uuid not null references auth.users on delete cascade, day date not null,
 mood text not null check(mood in ('wonderful','good','calm','tired','anxious','sad','irritated','uncertain')),
 intensity integer not null check(intensity between 1 and 5), note text not null check(char_length(note)<=500), support boolean not null,
 shared boolean not null default false, member_id uuid references public.couple_members on delete set null, partner_member_id uuid references public.couple_members on delete set null,
 version integer not null default 1, primary key(user_id,day)
);
create table public.connection_reactions (
 owner_id uuid not null, day date not null, user_id uuid not null references auth.users on delete cascade,
 reaction text not null check(reaction in ('here','hug','talk','presence','thanks')),
 foreign key(owner_id,day) references public.connection_moods(user_id,day) on delete cascade,
 primary key(owner_id,day,user_id)
);
create table public.connection_sessions (
 id uuid primary key default gen_random_uuid(), space_id uuid not null references public.couple_spaces on delete cascade,
 a uuid not null references auth.users on delete cascade, b uuid not null references auth.users on delete cascade,
 am uuid not null references public.couple_members, bm uuid not null references public.couple_members,
 kind text not null check(kind in ('game','questionnaire')), catalog_id text,
 status text not null default 'pending' check(status in ('pending','active','paused','completed','closed','declined')),
 opt_a boolean not null default false,opt_b boolean not null default false,
 position integer not null default 0 check(position between 0 and 150),
 created_at timestamptz not null default clock_timestamp(), check(a<>b)
);
create unique index one_live_connection_game on public.connection_sessions(space_id) where kind='game' and status in ('pending','active','paused');
create unique index one_live_questionnaire on public.connection_sessions(space_id,catalog_id) where kind='questionnaire' and status in ('pending','active','paused');
create index connection_sessions_page on public.connection_sessions(space_id,created_at desc,id desc);
create table public.connection_answers (
 session_id uuid not null references public.connection_sessions on delete cascade,user_id uuid not null references auth.users on delete cascade,
 slot integer not null check(slot between 0 and 150), draft jsonb not null default '{}',submitted boolean not null default false,
 published boolean not null default false, skipped boolean not null default false,version integer not null default 0,
 primary key(session_id,user_id,slot)
);
create table public.connection_deck (
 session_id uuid not null references public.connection_sessions on delete cascade,position integer not null check(position between 1 and 150),
 card_id text not null, drawn boolean not null default false, primary key(session_id,position),unique(session_id,card_id)
);
create table public.connection_draws(session_id uuid not null references public.connection_sessions on delete cascade,slot integer not null check(slot between 1 and 150),card_id text not null,primary key(session_id,slot),unique(session_id,card_id));
create table public.connection_events (
 session_id uuid not null references public.connection_sessions on delete cascade,position integer not null,
 sender uuid not null references auth.users on delete cascade,recipient uuid not null references auth.users on delete cascade,
 acknowledged boolean not null default false,primary key(session_id,position,sender)
);
create table public.connection_requests (
 user_id uuid not null references auth.users on delete cascade,request_id uuid not null,
 intent jsonb not null,result jsonb not null,primary key(user_id,request_id)
);
create function public.connection_clock() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$;
create function public.connection_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.connection_sessions s join public.couple_members ma on ma.id=s.am and ma.left_at is null
 join public.couple_members mb on mb.id=s.bm and mb.left_at is null where s.id=p_id and auth.uid() in(s.a,s.b));
$$;
create function public.connection_mood_access(p_user uuid,p_day date) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.connection_moods m where m.user_id=p_user and m.day=p_day and
 (m.user_id=auth.uid() or (m.shared and exists(select 1 from public.couple_members a join public.couple_members b on a.space_id=b.space_id
 where a.id=m.member_id and b.id=m.partner_member_id and a.left_at is null and b.left_at is null and b.user_id=auth.uid()))));
$$;
create function public.connection_answer_access(p_id uuid,p_user uuid,p_slot integer) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid()=p_user or (public.connection_access(p_id) and exists(select 1 from public.connection_answers a
 join public.connection_answers b on a.session_id=b.session_id and a.slot=b.slot and a.user_id<>b.user_id
 where a.session_id=p_id and a.slot=p_slot and a.user_id=p_user and b.user_id=auth.uid() and a.submitted and b.submitted and a.published and b.published
 and exists(select 1 from public.connection_sessions s where s.id=p_id and (s.kind='questionnaire' or s.opt_a and s.opt_b or exists(select 1 from public.connection_draws d join public.connection_catalog c on c.kind='card' and c.id=d.card_id where d.session_id=s.id and d.slot=p_slot and c.content->>'category' not in ('heat','secret'))))));
$$;
-- Every write is fenced by both a request UUID/payload and a domain version.
create function public.connection_action(p_action text,p_id uuid,p_expected integer,p_payload jsonb,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user(); s public.connection_sessions; m public.connection_moods; v public.connection_answers;
 sp uuid; am uuid; bm uuid; b uuid; d date; j jsonb; old public.connection_requests; intent jsonb;
 result jsonb:='{}'; n integer; pos integer; item record; q jsonb; cat text;
begin
 if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>40000 or p_expected is null then raise exception 'connection_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select space_id,id into sp,am from public.couple_members where user_id=u and left_at is null;
 if sp is not null then perform 1 from public.couple_spaces where id=sp for update; end if;
 select id,user_id into bm,b from public.couple_members where space_id=sp and user_id<>u and left_at is null;
 intent:=to_jsonb(encode(sha256(convert_to(jsonb_build_object('action',p_action,'id',p_id,'expected',p_expected,'payload',p_payload)::text,'UTF8')),'hex'));
 select * into old from public.connection_requests where user_id=u and request_id=p_request;
 if found then
   if old.intent<>intent then raise exception 'connection_conflict'; end if;
   return old.result; -- only UUID/result, never previously disclosed sensitive content
 end if;
 d:=(public.connection_clock() at time zone 'UTC')::date;
 if p_action='mood' then
   if p_payload->>'day' is distinct from to_char(d,'YYYY-MM-DD') then raise exception 'connection_period_changed'; end if;
   select * into m from public.connection_moods where user_id=u and day=d for update;
   if coalesce(m.version,0)<>p_expected then raise exception 'connection_changed'; end if;
   if p_payload->>'mood' not in ('wonderful','good','calm','tired','anxious','sad','irritated','uncertain')
    or coalesce((p_payload->>'intensity')::integer,0) not between 1 and 5 or char_length(coalesce(p_payload->>'note',''))>500
    or jsonb_typeof(p_payload->'shared') is distinct from 'boolean' or jsonb_typeof(p_payload->'support') is distinct from 'boolean' then raise exception 'connection_invalid'; end if;
   insert into public.connection_moods values(u,d,p_payload->>'mood',(p_payload->>'intensity')::integer,coalesce(p_payload->>'note',''),(p_payload->>'support')::boolean,(p_payload->>'shared')::boolean,am,bm,1)
   on conflict(user_id,day) do update set mood=excluded.mood,intensity=excluded.intensity,note=excluded.note,support=excluded.support,shared=excluded.shared,member_id=excluded.member_id,partner_member_id=excluded.partner_member_id,version=connection_moods.version+1;
   delete from public.connection_reactions where owner_id=u and day=d; -- old support never implies a response to edited content
 elsif p_action='react' then
   if b is null or not public.connection_mood_access(b,(p_payload->>'day')::date) then raise exception 'connection_unavailable'; end if;
   insert into public.connection_reactions values(b,(p_payload->>'day')::date,u,p_payload->>'reaction') on conflict(owner_id,day,user_id) do update set reaction=excluded.reaction;
 elsif p_action in ('start_game','start_questionnaire') then
   if b is null then raise exception 'connection_partner_required'; end if;
   cat:=case when p_action='start_game' then 'game' else 'questionnaire' end;
   select count(*) into n from public.connection_sessions where a=u and kind=cat;
   if n<>p_expected then raise exception 'connection_changed'; end if;
   if cat='questionnaire' and not exists(select 1 from public.connection_catalog where kind='questionnaire' and id=p_payload->>'catalog') then raise exception 'connection_invalid'; end if;
   if (select count(*) from public.connection_sessions where space_id=sp and status in ('pending','active','paused'))>=30 then raise exception 'connection_limit'; end if;
   insert into public.connection_sessions(space_id,a,b,am,bm,kind,catalog_id) values(sp,u,b,am,bm,cat,p_payload->>'catalog') returning * into s;
   result:=jsonb_build_object('id',s.id);
 elsif p_action='delete_own_history' then
   select * into s from public.connection_sessions where id=p_id for update;
   if not found or u not in(s.a,s.b) then raise exception 'connection_unavailable'; end if;
   delete from public.connection_answers where session_id=s.id and user_id=u;
   update public.connection_sessions set status='closed' where id=s.id;
 else
   select * into s from public.connection_sessions where id=p_id for update;
   if not found or not public.connection_access(s.id) or s.space_id is distinct from sp then raise exception 'connection_unavailable'; end if;
   if p_action='accept' then
     if s.b<>u or s.status<>'pending' then raise exception 'connection_changed'; end if;
     update public.connection_sessions set status='active' where id=s.id;
     if s.kind='game' then
       insert into public.connection_deck(session_id,position,card_id) select s.id,row_number() over(order by random()),id from public.connection_catalog where kind='card';
     end if;
   elsif p_action in ('decline','close','pause','resume') then
     if p_action='decline' and (s.b<>u or s.status<>'pending') then raise exception 'connection_changed'; end if;
     if (p_action='pause' and s.status<>'active') or (p_action='resume' and s.status<>'paused') or s.status not in ('pending','active','paused') then raise exception 'connection_changed'; end if;
     update public.connection_sessions set status=case p_action when 'decline' then 'declined' when 'close' then 'closed' when 'pause' then 'paused' else 'active' end where id=s.id;
     if p_action='close' and s.kind='questionnaire' then delete from public.connection_answers where session_id=s.id and user_id=u; end if;
   elsif p_action='erase_answers' then
     delete from public.connection_answers where session_id=s.id and user_id=u;
     update public.connection_sessions set status='closed' where id=s.id;
   elsif p_action='opt' and s.kind='game' then
     if s.status not in ('active','paused') or jsonb_typeof(p_payload->'enabled') is distinct from 'boolean' then raise exception 'connection_invalid'; end if;
     update public.connection_sessions cs set opt_a=case when cs.a=u then (p_payload->>'enabled')::boolean else opt_a end,opt_b=case when cs.b=u then (p_payload->>'enabled')::boolean else opt_b end where id=s.id;
   elsif p_action='draw' and s.kind='game' then
     if s.status<>'active' or s.position<>p_expected then raise exception 'connection_changed'; end if;
     if s.position>0 and (select count(*) from public.connection_answers where session_id=s.id and slot=s.position and submitted)<>2 then raise exception 'connection_not_ready'; end if;
     select dk.position into pos from public.connection_deck dk join public.connection_catalog c on c.kind='card' and c.id=dk.card_id
      where dk.session_id=s.id and not dk.drawn and (s.opt_a and s.opt_b or c.content->>'category' not in ('heat','secret')) order by dk.position limit 1;
     if pos is null then
       if exists(select 1 from public.connection_deck where session_id=s.id and not drawn) then raise exception 'connection_categories_locked'; end if;
       update public.connection_sessions set status='completed' where id=s.id;
     else
       update public.connection_deck set drawn=true where session_id=s.id and position=pos;
       -- position in sessions is the DRAW NUMBER; deck position is private shuffle order.
       update public.connection_sessions set position=position+1 where id=s.id;
       insert into public.connection_draws(session_id,slot,card_id) select s.id,s.position+1,card_id from public.connection_deck where session_id=s.id and position=pos;
     end if;
   elsif p_action in ('save','submit','skip','unpublish') then
     if p_action='skip' and s.kind<>'game' then raise exception 'connection_invalid'; end if;
     if s.status<>'active' and p_action<>'unpublish' then raise exception 'connection_changed'; end if;
     pos:=case when s.kind='game' then s.position else 0 end;
     if p_payload->>'slot' is distinct from pos::text or (s.kind='game' and pos=0) then raise exception 'connection_changed'; end if;
     select * into v from public.connection_answers where session_id=s.id and user_id=u and slot=pos;
     if coalesce(v.version,0)<>p_expected then raise exception 'connection_changed'; end if;
     if v.submitted and p_action not in ('unpublish') then raise exception 'connection_changed'; end if;
     j:=case when p_action='skip' then to_jsonb(''::text) else coalesce(p_payload->'answers',v.draft,'{}') end;
     if s.kind='game' then
       if jsonb_typeof(j)<>'string' or char_length(j#>>'{}')>2000 then raise exception 'connection_invalid'; end if;
     else
       if jsonb_typeof(j)<>'object' then raise exception 'connection_invalid'; end if;
       select content into q from public.connection_catalog where kind='questionnaire' and id=s.catalog_id;
       if exists(select 1 from jsonb_object_keys(j) k where not exists(select 1 from jsonb_array_elements(q->'questions') x where x->>'id'=k)) then raise exception 'connection_invalid'; end if;
       for item in select value as x from jsonb_array_elements(q->'questions') loop
         if j ? (item.x->>'id') then
           if item.x->>'type'='scale' then
             if coalesce(j->>(item.x->>'id'),'') not in ('1','2','3','4','5') then raise exception 'connection_invalid'; end if;
           elsif not exists(select 1 from jsonb_array_elements(item.x->'options') o where o->>'id'=j->>(item.x->>'id')) then raise exception 'connection_invalid'; end if;
         elsif p_action='submit' then raise exception 'connection_not_ready'; end if;
       end loop;
     end if;
     if p_action='submit' and p_payload->'publish' is distinct from 'true'::jsonb then raise exception 'connection_consent_required'; end if;
     if p_action='unpublish' then
       delete from public.connection_answers where session_id=s.id and user_id=u and slot=pos;
       update public.connection_sessions set status='closed' where id=s.id;
     else
       insert into public.connection_answers(session_id,user_id,slot,draft,submitted,published,skipped,version)
       values(s.id,u,pos,case when p_action='skip' then to_jsonb(''::text) else j end,p_action in ('submit','skip'),p_action in ('submit','skip'),p_action='skip',1)
       on conflict(session_id,user_id,slot) do update set draft=excluded.draft,submitted=excluded.submitted,published=excluded.published,skipped=excluded.skipped,version=connection_answers.version+1;
       if s.kind='questionnaire' and (select count(*) from public.connection_answers where session_id=s.id and submitted and published)=2 then update public.connection_sessions set status='completed' where id=s.id; end if;
     end if;
   elsif p_action='notify' and s.kind='game' and s.position>0 then
     if s.position<>p_expected then raise exception 'connection_changed'; end if;
     insert into public.connection_events values(s.id,s.position,u,case when s.a=u then s.b else s.a end,false) on conflict do nothing;
   elsif p_action='ack' then
     update public.connection_events set acknowledged=true where session_id=s.id and recipient=u and position=p_expected;
   else raise exception 'connection_invalid'; end if;
 end if;
 insert into public.connection_requests values(u,p_request,intent,result);
 return result;
exception when invalid_text_representation or check_violation or not_null_violation or unique_violation then raise exception 'connection_invalid';
end $$;
create function public.connection_read(p_view text,p_id uuid default null,p_cursor jsonb default null) returns jsonb
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
    'events',coalesce((select jsonb_agg(to_jsonb(e)) from public.connection_events e where recipient=u and not acknowledged and public.connection_access(e.session_id)),'[]')) into result;
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
      from public.connection_answers a where a.session_id=s.id and a.slot=case when s.kind='game' then s.position else 0 end;
     result:=jsonb_build_object('session',to_jsonb(s),'answers',rows,'card',(select c.content from public.connection_draws d join public.connection_catalog c on c.kind='card' and c.id=d.card_id where d.session_id=s.id and d.slot=s.position and (s.opt_a and s.opt_b or c.content->>'category' not in ('heat','secret'))),
       'remaining',150-s.position,'answer_count',(select count(*) from public.connection_answers where session_id=s.id and submitted and not skipped),'questionnaire',(select content from public.connection_catalog where kind='questionnaire' and id=s.catalog_id));
   else
     select coalesce(jsonb_agg(to_jsonb(t) order by t.slot desc),'[]') into rows from (
       select d.slot,c.content as card,(select jsonb_agg(jsonb_build_object('user_id',a.user_id,'draft',a.draft,'skipped',a.skipped)) from public.connection_answers a where a.session_id=s.id and a.slot=d.slot and public.connection_answer_access(a.session_id,a.user_id,a.slot)) as answers
       from public.connection_draws d join public.connection_catalog c on c.kind='card' and c.id=d.card_id
       where d.session_id=s.id and (d.slot<s.position or s.status='completed') and d.slot<coalesce(v_slot,151) and (s.opt_a and s.opt_b or c.content->>'category' not in ('heat','secret')) order by d.slot desc limit 20) t;
     result:=jsonb_build_object('items',rows,'next_cursor',case when jsonb_array_length(rows)=20 then jsonb_build_object('actor',u,'context',ctx,'view',p_view,'id',p_id,'ceiling',upper_time,'slot',rows->19->>'slot') end);
   end if;
 elsif p_view='request' then
   select r.result into result from public.connection_requests r where user_id=u and request_id=p_id;
 else raise exception 'connection_invalid'; end if;
 return jsonb_build_object('context',ctx,'data',result);
exception when invalid_text_representation then raise exception 'connection_cursor_invalid';
end $$;
create function public.connection_departure() returns trigger language plpgsql security definer set search_path='' as $$
declare member uuid:=old.id;
begin
 if TG_OP='DELETE' or (old.left_at is null and new.left_at is not null) then
   update public.connection_sessions set status='closed' where (am=member or bm=member) and status in ('pending','active','paused');
   update public.connection_moods set shared=false where member_id=member or partner_member_id=member;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
create trigger connection_departure after update of left_at on public.couple_members for each row execute function public.connection_departure();
create trigger connection_member_deleted before delete on public.couple_members for each row execute function public.connection_departure();
alter table public.connection_catalog enable row level security;
alter table public.connection_moods enable row level security;
alter table public.connection_reactions enable row level security;
alter table public.connection_sessions enable row level security;
alter table public.connection_answers enable row level security;
alter table public.connection_deck enable row level security;
alter table public.connection_draws enable row level security;
alter table public.connection_events enable row level security;
alter table public.connection_requests enable row level security;
create policy catalog_read on public.connection_catalog for select to authenticated using(kind='questionnaire');
create policy mood_read on public.connection_moods for select to authenticated using(public.connection_mood_access(user_id,day));
create policy reaction_read on public.connection_reactions for select to authenticated using(public.connection_mood_access(owner_id,day));
create policy session_read on public.connection_sessions for select to authenticated using(public.connection_access(id));
create policy answer_read on public.connection_answers for select to authenticated using(public.connection_answer_access(session_id,user_id,slot));
create policy event_read on public.connection_events for select to authenticated using(recipient=auth.uid() and public.connection_access(session_id));
-- Deck, draw ordering and request journal are server-only; private payloads are never journaled.
revoke all on public.connection_catalog,public.connection_moods,public.connection_reactions,public.connection_sessions,public.connection_answers,public.connection_deck,public.connection_draws,public.connection_events,public.connection_requests from public,anon,authenticated;
grant select on public.connection_catalog,public.connection_moods,public.connection_reactions,public.connection_sessions,public.connection_answers,public.connection_events to authenticated;
revoke all on function public.connection_clock(), public.connection_departure(), public.connection_access(uuid),public.connection_mood_access(uuid,date),public.connection_answer_access(uuid,uuid,integer),public.connection_action(text,uuid,integer,jsonb,uuid),public.connection_read(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.connection_access(uuid),public.connection_mood_access(uuid,date),public.connection_answer_access(uuid,uuid,integer),public.connection_action(text,uuid,integer,jsonb,uuid),public.connection_read(text,uuid,jsonb) to authenticated;
insert into public.connection_catalog(kind,id,version,content) values ('card','us-01',1,$catalog${"id": "us-01", "category": "us", "text": "Яку нашу випадкову зустріч ти пам’ятаєш найвиразніше?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-02',1,$catalog${"id": "us-02", "category": "us", "text": "Яка дрібниця вдома нагадує тобі про нас?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-03',1,$catalog${"id": "us-03", "category": "us", "text": "Коли поруч зі мною ти відчуваєш затишок?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-04',1,$catalog${"id": "us-04", "category": "us", "text": "Яку нашу прогулянку ти зберіг(-ла) б у маленькій пляшечці спогадів?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-05',1,$catalog${"id": "us-05", "category": "us", "text": "Яка моя звичка непомітно стала для тебе рідною?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-06',1,$catalog${"id": "us-06", "category": "us", "text": "Який звук міг би бути саундтреком нашого знайомства?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-07',1,$catalog${"id": "us-07", "category": "us", "text": "Що ми навчилися робити разом краще, ніж окремо?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-08',1,$catalog${"id": "us-08", "category": "us", "text": "Яку звичайну неділю з нами ти вважаєш особливою?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-09',1,$catalog${"id": "us-09", "category": "us", "text": "Яка спільна фотографія розповідає більше, ніж видно на ній?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-10',1,$catalog${"id": "us-10", "category": "us", "text": "Який мій жест допомагає тобі видихнути?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-11',1,$catalog${"id": "us-11", "category": "us", "text": "Де ти хотів(-ла) б зустріти зі мною світанок?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-12',1,$catalog${"id": "us-12", "category": "us", "text": "Яка наша маленька традиція заслуговує на продовження?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-13',1,$catalog${"id": "us-13", "category": "us", "text": "Що в мені приємно здивувало тебе з часом?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-14',1,$catalog${"id": "us-14", "category": "us", "text": "Який наш смішний промах досі викликає усмішку?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-15',1,$catalog${"id": "us-15", "category": "us", "text": "Яку страву ти пов’язуєш із нами?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-16',1,$catalog${"id": "us-16", "category": "us", "text": "Як би ти назвав(-ла) розділ книги про цей період нашого життя?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-17',1,$catalog${"id": "us-17", "category": "us", "text": "Який день удвох ти хотів(-ла) б пережити повільніше?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-18',1,$catalog${"id": "us-18", "category": "us", "text": "Що ти помічаєш у мені, коли ми мовчимо поруч?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-19',1,$catalog${"id": "us-19", "category": "us", "text": "Який невеликий подарунок від мене залишив теплий слід?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-20',1,$catalog${"id": "us-20", "category": "us", "text": "Куди ми могли б повернутися вже трохи іншими людьми?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-21',1,$catalog${"id": "us-21", "category": "us", "text": "Які три слова описують наше найзатишніше місце?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-22',1,$catalog${"id": "us-22", "category": "us", "text": "Яку спільну справу ти хотів(-ла) б спробувати вперше?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-23',1,$catalog${"id": "us-23", "category": "us", "text": "Який момент змусив тебе подумати: «Ми впоралися»?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-24',1,$catalog${"id": "us-24", "category": "us", "text": "Що ти цінуєш у наших буденних розмовах?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-25',1,$catalog${"id": "us-25", "category": "us", "text": "Яку нашу історію ти розповів(-ла) б нам через двадцять років?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-26',1,$catalog${"id": "us-26", "category": "us", "text": "Що робить нашу кухню або стіл місцем зустрічі?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-27',1,$catalog${"id": "us-27", "category": "us", "text": "Який маршрут містом став для тебе нашим?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-28',1,$catalog${"id": "us-28", "category": "us", "text": "Яке моє повідомлення було особливо вчасним?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-29',1,$catalog${"id": "us-29", "category": "us", "text": "Що ти хотів(-ла) б частіше помічати в наших днях?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','us-30',1,$catalog${"id": "us-30", "category": "us", "text": "Який добрий спогад ми могли б створити вже цього тижня?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-01',1,$catalog${"id": "dessert-01", "category": "dessert", "text": "Яку романтичну записку було б приємно знайти в кишені?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-02',1,$catalog${"id": "dessert-02", "category": "dessert", "text": "Як виглядало б наше побачення за ціною двох чашок кави?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-03',1,$catalog${"id": "dessert-03", "category": "dessert", "text": "Яка музика додала б іскри нашому вечору?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-04',1,$catalog${"id": "dessert-04", "category": "dessert", "text": "Який комплімент від мене ти хотів(-ла) б почути сьогодні?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-05',1,$catalog${"id": "dessert-05", "category": "dessert", "text": "Який несподіваний образ для побачення тебе потішив би?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-06',1,$catalog${"id": "dessert-06", "category": "dessert", "text": "Куди ти запросив(-ла) б мене, якби ми щойно познайомилися?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-07',1,$catalog${"id": "dessert-07", "category": "dessert", "text": "Який аромат асоціюється в тебе з романтикою?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-08',1,$catalog${"id": "dessert-08", "category": "dessert", "text": "Яка грайлива назва пасувала б нашому дуету?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-09',1,$catalog${"id": "dessert-09", "category": "dessert", "text": "Якби ми влаштували пікнік у кімнаті, що було б у кошику?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-10',1,$catalog${"id": "dessert-10", "category": "dessert", "text": "Який танець ти спробував(-ла) б зі мною без глядачів?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-11',1,$catalog${"id": "dessert-11", "category": "dessert", "text": "Який десерт найкраще передає твій сьогоднішній настрій?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-12',1,$catalog${"id": "dessert-12", "category": "dessert", "text": "Як ти любиш отримувати запрошення на побачення?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-13',1,$catalog${"id": "dessert-13", "category": "dessert", "text": "Що перетворює звичайну вечерю на романтичну?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-14',1,$catalog${"id": "dessert-14", "category": "dessert", "text": "Який мій погляд ти впізнав(-ла) б серед сотні?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-15',1,$catalog${"id": "dessert-15", "category": "dessert", "text": "Яку маленьку таємну усмішку ми могли б мати на людях?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-16',1,$catalog${"id": "dessert-16", "category": "dessert", "text": "Що ти обрав(-ла) б: побачення на даху чи біля води, і чому?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-17',1,$catalog${"id": "dessert-17", "category": "dessert", "text": "Яка кумедна спроба флірту могла б тебе розсмішити?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-18',1,$catalog${"id": "dessert-18", "category": "dessert", "text": "Який колір пасує нашому ідеальному вечору?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-19',1,$catalog${"id": "dessert-19", "category": "dessert", "text": "Яке кіношне побачення ти переробив(-ла) б під нас?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-20',1,$catalog${"id": "dessert-20", "category": "dessert", "text": "Яка дрібна увага зранку налаштовує тебе на романтику?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-21',1,$catalog${"id": "dessert-21", "category": "dessert", "text": "Що тобі приємніше: сюрприз із підказкою чи чіткий план?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-22',1,$catalog${"id": "dessert-22", "category": "dessert", "text": "Яку страву було б весело готувати вдвох під музику?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-23',1,$catalog${"id": "dessert-23", "category": "dessert", "text": "Як би виглядало наше побачення без жодного екрана?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-24',1,$catalog${"id": "dessert-24", "category": "dessert", "text": "Який аксесуар ти вибрав(-ла) б для мене на святковий вечір?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-25',1,$catalog${"id": "dessert-25", "category": "dessert", "text": "Який романтичний жест на відстані тобі близький?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-26',1,$catalog${"id": "dessert-26", "category": "dessert", "text": "Про що ти запитав(-ла) б мене під час першого танцю?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-27',1,$catalog${"id": "dessert-27", "category": "dessert", "text": "Яку приємну витівку можна вигадати для дощового дня?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-28',1,$catalog${"id": "dessert-28", "category": "dessert", "text": "Як ти любиш, щоб закінчувалося вдале побачення?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-29',1,$catalog${"id": "dessert-29", "category": "dessert", "text": "Яке місце в нашому місті має недооцінений романтичний потенціал?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','dessert-30',1,$catalog${"id": "dessert-30", "category": "dessert", "text": "Який привід для маленького свята ми могли б вигадати самі?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-01',1,$catalog${"id": "trust-01", "category": "trust", "text": "Як мені зрозуміти, що тобі зараз потрібне слухання, а не порада?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-02',1,$catalog${"id": "trust-02", "category": "trust", "text": "Про яку свою межу тобі хотілося б говорити легше?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-03',1,$catalog${"id": "trust-03", "category": "trust", "text": "Які слова допомагають тобі відчувати, що тебе почули?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-04',1,$catalog${"id": "trust-04", "category": "trust", "text": "Що для тебе означає надійність у дрібницях?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-05',1,$catalog${"id": "trust-05", "category": "trust", "text": "Як ми можемо поважати приватність телефонів одне одного?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-06',1,$catalog${"id": "trust-06", "category": "trust", "text": "Який спосіб попросити паузу в розмові тобі зручний?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-07',1,$catalog${"id": "trust-07", "category": "trust", "text": "Що допомагає тобі повертатися до складної теми?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-08',1,$catalog${"id": "trust-08", "category": "trust", "text": "Як ти хотів(-ла) б чути вибачення?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-09',1,$catalog${"id": "trust-09", "category": "trust", "text": "Коли тобі найпростіше сказати «я не знаю»?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-10',1,$catalog${"id": "trust-10", "category": "trust", "text": "Яке запитання варто ставити перед тим, як давати пораду?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-11',1,$catalog${"id": "trust-11", "category": "trust", "text": "Що для тебе відрізняє турботу від контролю?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-12',1,$catalog${"id": "trust-12", "category": "trust", "text": "Як я можу дбайливо реагувати на твоє «ні»?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-13',1,$catalog${"id": "trust-13", "category": "trust", "text": "Які твої переживання не потребують негайного розв’язання?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-14',1,$catalog${"id": "trust-14", "category": "trust", "text": "Що дає тобі відчуття свободи всередині стосунків?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-15',1,$catalog${"id": "trust-15", "category": "trust", "text": "Як ти хочеш домовлятися про час наодинці?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-16',1,$catalog${"id": "trust-16", "category": "trust", "text": "Яку помилку ти хотів(-ла) б мати право визнати без сорому?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-17',1,$catalog${"id": "trust-17", "category": "trust", "text": "Що допомагає тобі довіряти власному темпу зближення?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-18',1,$catalog${"id": "trust-18", "category": "trust", "text": "Як запитати про складний день, не влаштовуючи допит?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-19',1,$catalog${"id": "trust-19", "category": "trust", "text": "Який вид підтримки може ненавмисно втомлювати тебе?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-20',1,$catalog${"id": "trust-20", "category": "trust", "text": "Що тобі важливо знати перед розмовою про гроші?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-21',1,$catalog${"id": "trust-21", "category": "trust", "text": "Як ми могли б говорити про ревнощі без звинувачень?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-22',1,$catalog${"id": "trust-22", "category": "trust", "text": "Яку домовленість варто час від часу перевіряти заново?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-23',1,$catalog${"id": "trust-23", "category": "trust", "text": "Що для тебе означає залишатися собою поруч зі мною?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-24',1,$catalog${"id": "trust-24", "category": "trust", "text": "Як ти відчуваєш, що твої особисті дружби поважають?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-25',1,$catalog${"id": "trust-25", "category": "trust", "text": "Коли добре мовчання підтримує тебе краще за слова?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-26',1,$catalog${"id": "trust-26", "category": "trust", "text": "Який спосіб виправити непорозуміння тобі найближчий?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-27',1,$catalog${"id": "trust-27", "category": "trust", "text": "Як ти хотів(-ла) б позначати тему, до якої ще не готовий(-а)?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-28',1,$catalog${"id": "trust-28", "category": "trust", "text": "Що допомагає тобі просити про допомогу без почуття боргу?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-29',1,$catalog${"id": "trust-29", "category": "trust", "text": "Яку обіцянку краще замінити чесним обговоренням можливостей?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','trust-30',1,$catalog${"id": "trust-30", "category": "trust", "text": "Як ми зрозуміємо, що наша домовленість досі підходить обом?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-01',1,$catalog${"id": "heat-01", "category": "heat", "text": "Яка атмосфера допомагає тобі почуватися вільно під час розмови про близькість?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-02',1,$catalog${"id": "heat-02", "category": "heat", "text": "Як тобі комфортно повідомляти, що сьогодні хочеться лише ніжності?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-03',1,$catalog${"id": "heat-03", "category": "heat", "text": "Які слова про привабливість звучать для тебе тепло?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-04',1,$catalog${"id": "heat-04", "category": "heat", "text": "Як ти хотів(-ла) б запитувати про бажання без очікування згоди?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-05',1,$catalog${"id": "heat-05", "category": "heat", "text": "Що допомагає тобі розслабитися перед інтимною розмовою?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-06',1,$catalog${"id": "heat-06", "category": "heat", "text": "Як ти розумієш різницю між фліртом і запрошенням до дії?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-07',1,$catalog${"id": "heat-07", "category": "heat", "text": "Який спосіб перевірити комфорт у моменті тобі подобається?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-08',1,$catalog${"id": "heat-08", "category": "heat", "text": "Що робить дотик бажаним саме для тебе?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-09',1,$catalog${"id": "heat-09", "category": "heat", "text": "Як тобі приємно давати зрозуміти, що ти передумав(-ла)?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-10',1,$catalog${"id": "heat-10", "category": "heat", "text": "Яку межу щодо публічних проявів ніжності ти хотів(-ла) б обговорити?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-11',1,$catalog${"id": "heat-11", "category": "heat", "text": "Який темп романтичного вечора дозволяє тобі не поспішати?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-12',1,$catalog${"id": "heat-12", "category": "heat", "text": "Що допомагає тобі говорити про власні вподобання без ніяковості?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-13',1,$catalog${"id": "heat-13", "category": "heat", "text": "Як ми можемо залишати місце для сміху в близькості?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-14',1,$catalog${"id": "heat-14", "category": "heat", "text": "Яке освітлення створює для тебе відчуття затишку?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-15',1,$catalog${"id": "heat-15", "category": "heat", "text": "Як тобі комфортніше починати розмову про інтимні очікування?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-16',1,$catalog${"id": "heat-16", "category": "heat", "text": "Яка форма ніжності приємна тобі після напруженого дня?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-17',1,$catalog${"id": "heat-17", "category": "heat", "text": "Що для тебе означає взаємна уважність у близькості?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-18',1,$catalog${"id": "heat-18", "category": "heat", "text": "Яке запитання про комфорт ти хотів(-ла) б чути частіше?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-19',1,$catalog${"id": "heat-19", "category": "heat", "text": "Як відрізняється твоя потреба в близькості залежно від настрою?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-20',1,$catalog${"id": "heat-20", "category": "heat", "text": "Які прояви романтики не потребують фізичного контакту?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-21',1,$catalog${"id": "heat-21", "category": "heat", "text": "Що тобі важливо відчувати, коли ти відмовляєшся від близькості?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-22',1,$catalog${"id": "heat-22", "category": "heat", "text": "Як ми могли б говорити про зміни бажань із часом?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-23',1,$catalog${"id": "heat-23", "category": "heat", "text": "Яка музика допомагає тобі почуватися привабливо?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-24',1,$catalog${"id": "heat-24", "category": "heat", "text": "Які слова після ніжного моменту підтримують тебе?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-25',1,$catalog${"id": "heat-25", "category": "heat", "text": "Як ти хочеш домовлятися про приватність інтимних розмов?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-26',1,$catalog${"id": "heat-26", "category": "heat", "text": "Що допомагає тобі не сприймати відмову як оцінку себе?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-27',1,$catalog${"id": "heat-27", "category": "heat", "text": "Який спосіб запитати дозволу на обійми здається тобі природним?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-28',1,$catalog${"id": "heat-28", "category": "heat", "text": "Яке бажання можна спокійно обговорити без обіцянки здійснення?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-29',1,$catalog${"id": "heat-29", "category": "heat", "text": "Як ти хотів(-ла) б завершувати відверту розмову, якщо втомився(-лася)?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','heat-30',1,$catalog${"id": "heat-30", "category": "heat", "text": "Що для тебе робить близькість взаємною, а не обов’язковою?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-01',1,$catalog${"id": "secret-01", "category": "secret", "text": "Яку незвичну професію ти спробував(-ла) б на один день?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-02',1,$catalog${"id": "secret-02", "category": "secret", "text": "Яка маленька мрія чекає на вільні вихідні?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-03',1,$catalog${"id": "secret-03", "category": "secret", "text": "Що ти колекціонував(-ла) б, якби місце не мало значення?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-04',1,$catalog${"id": "secret-04", "category": "secret", "text": "Який лист ти хотів(-ла) б отримати від себе з майбутнього?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-05',1,$catalog${"id": "secret-05", "category": "secret", "text": "Про яку подорож ти любиш думати перед сном?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-06',1,$catalog${"id": "secret-06", "category": "secret", "text": "Яке вміння хотілося б опанувати без жодної користі?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-07',1,$catalog${"id": "secret-07", "category": "secret", "text": "Яка частина твого характеру рідко помітна іншим?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-08',1,$catalog${"id": "secret-08", "category": "secret", "text": "Як виглядав би твій день без необхідності справляти враження?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-09',1,$catalog${"id": "secret-09", "category": "secret", "text": "Яку дитячу цікавість ти хотів(-ла) б повернути?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-10',1,$catalog${"id": "secret-10", "category": "secret", "text": "Яка книга могла б підказати мені щось про твій внутрішній світ?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-11',1,$catalog${"id": "secret-11", "category": "secret", "text": "Який подарунок свідчив би, що тебе уважно слухали?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-12',1,$catalog${"id": "secret-12", "category": "secret", "text": "Про яку тему ти міг(-ла) б захоплено говорити годину?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-13',1,$catalog${"id": "secret-13", "category": "secret", "text": "Яке місце ти хотів(-ла) б показати мені тільки тому, що воно твоє?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-14',1,$catalog${"id": "secret-14", "category": "secret", "text": "Який невеликий ризик ти обрав(-ла) б заради цікавості?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-15',1,$catalog${"id": "secret-15", "category": "secret", "text": "Що ти створив(-ла) б, якби не боявся(-лася) недосконалості?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-16',1,$catalog${"id": "secret-16", "category": "secret", "text": "Яка твоя улюблена мрія зовсім не потребує великих грошей?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-17',1,$catalog${"id": "secret-17", "category": "secret", "text": "Який святковий ритуал ти хотів(-ла) б придумати для себе?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-18',1,$catalog${"id": "secret-18", "category": "secret", "text": "Яку роль у виставі ти таємно хотів(-ла) б зіграти?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-19',1,$catalog${"id": "secret-19", "category": "secret", "text": "Яка запахова або смакова пам’ять переносить тебе в дитинство?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-20',1,$catalog${"id": "secret-20", "category": "secret", "text": "Який комплімент про твій характер рідко звучить, але важливий?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-21',1,$catalog${"id": "secret-21", "category": "secret", "text": "Що ти хотів(-ла) б відкласти в капсулу часу для нас?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-22',1,$catalog${"id": "secret-22", "category": "secret", "text": "Яку пригоду можна пережити в межах одного кварталу?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-23',1,$catalog${"id": "secret-23", "category": "secret", "text": "Який твій талант заслуговує більше місця в житті?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-24',1,$catalog${"id": "secret-24", "category": "secret", "text": "Про який дім ти мрієш, якщо описувати лише відчуття?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-25',1,$catalog${"id": "secret-25", "category": "secret", "text": "Яку власну традицію ти хотів(-ла) б колись передати далі?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-26',1,$catalog${"id": "secret-26", "category": "secret", "text": "Яка несподівана тема пробуджує в тобі дослідника?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-27',1,$catalog${"id": "secret-27", "category": "secret", "text": "Що ти зробив(-ла) б у день, повністю присвячений цікавості?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-28',1,$catalog${"id": "secret-28", "category": "secret", "text": "Яку свою зміну за останній рік ти хотів(-ла) б відсвяткувати?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-29',1,$catalog${"id": "secret-29", "category": "secret", "text": "Яке побажання собі ти досі соромишся сказати вголос?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('card','secret-30',1,$catalog${"id": "secret-30", "category": "secret", "text": "Яку невелику мрію нам було б приємно підтримати одне в одному?", "version": 1}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('questionnaire','care',1,$catalog${"id": "care", "title": "Мова любові", "version": 1, "questions": [{"id": "care-01", "text": "Мені важливі конкретні слова вдячності.", "type": "scale", "topic": "care", "options": [], "rule": "distance-1-5"}, {"id": "care-02", "text": "Спільний час без екранів допомагає мені відчути турботу.", "type": "scale", "topic": "care", "options": [], "rule": "distance-1-5"}, {"id": "care-03", "text": "Маленькі доречні подарунки мають для мене значення.", "type": "scale", "topic": "care", "options": [], "rule": "distance-1-5"}, {"id": "care-04", "text": "Допомога зі справою може бути проявом ніжності.", "type": "scale", "topic": "care", "options": [], "rule": "distance-1-5"}, {"id": "care-05", "text": "Мені важливо, щоб перед обіймами враховували мій настрій.", "type": "scale", "topic": "care", "options": [], "rule": "distance-1-5"}, {"id": "care-06", "text": "Я люблю самостійно пояснювати, яка турбота потрібна сьогодні.", "type": "scale", "topic": "care", "options": [], "rule": "distance-1-5"}, {"id": "care-07", "text": "Регулярні короткі знаки уваги для мене цінні.", "type": "scale", "topic": "care", "options": [], "rule": "distance-1-5"}, {"id": "care-08", "text": "Мені приємно, коли пам’ятають мої дрібні вподобання.", "type": "scale", "topic": "care", "options": [], "rule": "distance-1-5"}, {"id": "care-09", "text": "Який прояв турботи ти обрав(-ла) б після складного дня?", "type": "choice", "topic": "care", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}, {"id": "care-10", "text": "Що тобі найважливіше в несподіваному знаку уваги?", "type": "priority", "topic": "care", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}]}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('questionnaire','talk',1,$catalog${"id": "talk", "title": "Спілкування", "version": 1, "questions": [{"id": "talk-01", "text": "Мені легше обговорювати складне в заздалегідь обраний час.", "type": "scale", "topic": "talk", "options": [], "rule": "distance-1-5"}, {"id": "talk-02", "text": "Мені потрібно подумати перед відповіддю про почуття.", "type": "scale", "topic": "talk", "options": [], "rule": "distance-1-5"}, {"id": "talk-03", "text": "Я ціную уточнення замість здогадок про мій настрій.", "type": "scale", "topic": "talk", "options": [], "rule": "distance-1-5"}, {"id": "talk-04", "text": "Письмове повідомлення допомагає мені почати складну тему.", "type": "scale", "topic": "talk", "options": [], "rule": "distance-1-5"}, {"id": "talk-05", "text": "Під час розмови мені важливо не перебивати одне одного.", "type": "scale", "topic": "talk", "options": [], "rule": "distance-1-5"}, {"id": "talk-06", "text": "Я хочу чути запитання перед порадою.", "type": "scale", "topic": "talk", "options": [], "rule": "distance-1-5"}, {"id": "talk-07", "text": "Мені зручно називати потребу прямо.", "type": "scale", "topic": "talk", "options": [], "rule": "distance-1-5"}, {"id": "talk-08", "text": "Я люблю підсумовувати, про що ми домовилися.", "type": "scale", "topic": "talk", "options": [], "rule": "distance-1-5"}, {"id": "talk-09", "text": "Як ти волієш почати непросту розмову?", "type": "choice", "topic": "talk", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}, {"id": "talk-10", "text": "Що найважливіше, коли тебе слухають?", "type": "priority", "topic": "talk", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}]}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('questionnaire','boundaries',1,$catalog${"id": "boundaries", "title": "Особисті кордони", "version": 1, "questions": [{"id": "boundaries-01", "text": "Час наодинці допомагає мені відновлюватися.", "type": "scale", "topic": "boundaries", "options": [], "rule": "distance-1-5"}, {"id": "boundaries-02", "text": "Я хочу самостійно вирішувати, чим ділитися з телефона.", "type": "scale", "topic": "boundaries", "options": [], "rule": "distance-1-5"}, {"id": "boundaries-03", "text": "Мені важливо зберігати власні дружні зв’язки.", "type": "scale", "topic": "boundaries", "options": [], "rule": "distance-1-5"}, {"id": "boundaries-04", "text": "Я ціную попередню домовленість про гостей.", "type": "scale", "topic": "boundaries", "options": [], "rule": "distance-1-5"}, {"id": "boundaries-05", "text": "Мені потрібно мати право передумати.", "type": "scale", "topic": "boundaries", "options": [], "rule": "distance-1-5"}, {"id": "boundaries-06", "text": "Я хочу окремо погоджувати публікацію наших фото.", "type": "scale", "topic": "boundaries", "options": [], "rule": "distance-1-5"}, {"id": "boundaries-07", "text": "Я люблю обговорювати межі без необхідності виправдовуватися.", "type": "scale", "topic": "boundaries", "options": [], "rule": "distance-1-5"}, {"id": "boundaries-08", "text": "Приватний щоденник має залишатися приватним.", "type": "scale", "topic": "boundaries", "options": [], "rule": "distance-1-5"}, {"id": "boundaries-09", "text": "Як зручніше повідомити про потребу в особистому просторі?", "type": "choice", "topic": "boundaries", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}, {"id": "boundaries-10", "text": "Яка умова найважливіша для відчуття поваги до меж?", "type": "priority", "topic": "boundaries", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}]}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('questionnaire','conflict',1,$catalog${"id": "conflict", "title": "Конфлікти та примирення", "version": 1, "questions": [{"id": "conflict-01", "text": "Пауза допомагає мені не говорити зопалу.", "type": "scale", "topic": "conflict", "options": [], "rule": "distance-1-5"}, {"id": "conflict-02", "text": "Мені важливо знати, коли ми повернемося до розмови.", "type": "scale", "topic": "conflict", "options": [], "rule": "distance-1-5"}, {"id": "conflict-03", "text": "Я ціную вибачення з конкретним визнанням вчинку.", "type": "scale", "topic": "conflict", "options": [], "rule": "distance-1-5"}, {"id": "conflict-04", "text": "Мені легше говорити про одну проблему за раз.", "type": "scale", "topic": "conflict", "options": [], "rule": "distance-1-5"}, {"id": "conflict-05", "text": "Я хочу відрізняти незгоду від неповаги.", "type": "scale", "topic": "conflict", "options": [], "rule": "distance-1-5"}, {"id": "conflict-06", "text": "Після суперечки мені потрібен час на відновлення.", "type": "scale", "topic": "conflict", "options": [], "rule": "distance-1-5"}, {"id": "conflict-07", "text": "Я ціную спільний пошук рішення без переможця.", "type": "scale", "topic": "conflict", "options": [], "rule": "distance-1-5"}, {"id": "conflict-08", "text": "Мені допомагає спокійний тон навіть за різних поглядів.", "type": "scale", "topic": "conflict", "options": [], "rule": "distance-1-5"}, {"id": "conflict-09", "text": "Що допомагає повернутися до розмови після паузи?", "type": "choice", "topic": "conflict", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}, {"id": "conflict-10", "text": "Який крок примирення для тебе найважливіший?", "type": "priority", "topic": "conflict", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}]}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('questionnaire','future',1,$catalog${"id": "future", "title": "Спільне майбутнє", "version": 1, "questions": [{"id": "future-01", "text": "Я люблю обговорювати плани на кілька років.", "type": "scale", "topic": "future", "options": [], "rule": "distance-1-5"}, {"id": "future-02", "text": "Мені важливо залишати в планах місце для змін.", "type": "scale", "topic": "future", "options": [], "rule": "distance-1-5"}, {"id": "future-03", "text": "Я хочу узгоджувати великі витрати заздалегідь.", "type": "scale", "topic": "future", "options": [], "rule": "distance-1-5"}, {"id": "future-04", "text": "Власний розвиток має залишатися частиною спільних планів.", "type": "scale", "topic": "future", "options": [], "rule": "distance-1-5"}, {"id": "future-05", "text": "Мені цікаво час від часу переглядати наші пріоритети.", "type": "scale", "topic": "future", "options": [], "rule": "distance-1-5"}, {"id": "future-06", "text": "Я ціную маленькі здійсненні кроки до мрії.", "type": "scale", "topic": "future", "options": [], "rule": "distance-1-5"}, {"id": "future-07", "text": "Мені важливо відкрито говорити про невизначеність.", "type": "scale", "topic": "future", "options": [], "rule": "distance-1-5"}, {"id": "future-08", "text": "Я хочу розрізняти власну мрію і спільну домовленість.", "type": "scale", "topic": "future", "options": [], "rule": "distance-1-5"}, {"id": "future-09", "text": "Як тобі зручніше починати планування?", "type": "choice", "topic": "future", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}, {"id": "future-10", "text": "Що важливіше на першому етапі спільної мрії?", "type": "priority", "topic": "future", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}]}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('questionnaire','home',1,$catalog${"id": "home", "title": "Побут та відповідальність", "version": 1, "questions": [{"id": "home-01", "text": "Я хочу бачити весь обсяг домашньої роботи, включно з плануванням.", "type": "scale", "topic": "home", "options": [], "rule": "distance-1-5"}, {"id": "home-02", "text": "Мені важливо переглядати розподіл справ при зміні навантаження.", "type": "scale", "topic": "home", "options": [], "rule": "distance-1-5"}, {"id": "home-03", "text": "Я ціную чіткі домовленості про регулярні справи.", "type": "scale", "topic": "home", "options": [], "rule": "distance-1-5"}, {"id": "home-04", "text": "Для мене припустимі різні способи виконати одну справу.", "type": "scale", "topic": "home", "options": [], "rule": "distance-1-5"}, {"id": "home-05", "text": "Мені легше просити допомоги до перевтоми.", "type": "scale", "topic": "home", "options": [], "rule": "distance-1-5"}, {"id": "home-06", "text": "Я хочу обговорювати стандарти порядку без сорому.", "type": "scale", "topic": "home", "options": [], "rule": "distance-1-5"}, {"id": "home-07", "text": "Відпочинок обох має враховуватися в розподілі справ.", "type": "scale", "topic": "home", "options": [], "rule": "distance-1-5"}, {"id": "home-08", "text": "Мені важливо не вважати побутову допомогу боргом.", "type": "scale", "topic": "home", "options": [], "rule": "distance-1-5"}, {"id": "home-09", "text": "Як краще помітити, що розподіл справ потребує змін?", "type": "choice", "topic": "home", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}, {"id": "home-10", "text": "Що головне у спільній побутовій домовленості?", "type": "priority", "topic": "home", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}]}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('questionnaire','support',1,$catalog${"id": "support", "title": "Емоційна підтримка", "version": 1, "questions": [{"id": "support-01", "text": "У складний момент мені корисне уважне слухання.", "type": "scale", "topic": "support", "options": [], "rule": "distance-1-5"}, {"id": "support-02", "text": "Іноді я потребую присутності без розмов.", "type": "scale", "topic": "support", "options": [], "rule": "distance-1-5"}, {"id": "support-03", "text": "Я хочу самостійно обирати, коли обговорювати переживання.", "type": "scale", "topic": "support", "options": [], "rule": "distance-1-5"}, {"id": "support-04", "text": "Практична допомога може полегшити мій день.", "type": "scale", "topic": "support", "options": [], "rule": "distance-1-5"}, {"id": "support-05", "text": "Мені важливо чути, що мої почуття не оцінюють.", "type": "scale", "topic": "support", "options": [], "rule": "distance-1-5"}, {"id": "support-06", "text": "Я ціную запитання про бажаний вид підтримки.", "type": "scale", "topic": "support", "options": [], "rule": "distance-1-5"}, {"id": "support-07", "text": "Мені допомагає нагадування про можливість відпочити.", "type": "scale", "topic": "support", "options": [], "rule": "distance-1-5"}, {"id": "support-08", "text": "Я хочу мати право не пояснювати свій настрій.", "type": "scale", "topic": "support", "options": [], "rule": "distance-1-5"}, {"id": "support-09", "text": "Якої підтримки ти частіше хочеш після виснажливого дня?", "type": "choice", "topic": "support", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}, {"id": "support-10", "text": "Що найважливіше в підтримувальній розмові?", "type": "priority", "topic": "support", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}]}$catalog$::jsonb);
insert into public.connection_catalog(kind,id,version,content) values ('questionnaire','romance',1,$catalog${"id": "romance", "title": "Близькість та романтика", "version": 1, "questions": [{"id": "romance-01", "text": "Мені приємно заздалегідь знати про романтичний план.", "type": "scale", "topic": "romance", "options": [], "rule": "distance-1-5"}, {"id": "romance-02", "text": "Я ціную можливість відмовитися від дотику без образ.", "type": "scale", "topic": "romance", "options": [], "rule": "distance-1-5"}, {"id": "romance-03", "text": "Мені важливо обговорювати комфорт словами.", "type": "scale", "topic": "romance", "options": [], "rule": "distance-1-5"}, {"id": "romance-04", "text": "Романтика для мене можлива без фізичної близькості.", "type": "scale", "topic": "romance", "options": [], "rule": "distance-1-5"}, {"id": "romance-05", "text": "Я люблю час від часу пробувати новий формат побачення.", "type": "scale", "topic": "romance", "options": [], "rule": "distance-1-5"}, {"id": "romance-06", "text": "Мені потрібне право змінювати вподобання.", "type": "scale", "topic": "romance", "options": [], "rule": "distance-1-5"}, {"id": "romance-07", "text": "Мені приємні маленькі знаки флірту у звичайний день.", "type": "scale", "topic": "romance", "options": [], "rule": "distance-1-5"}, {"id": "romance-08", "text": "Я хочу відрізняти розмову про бажання від згоди на дію.", "type": "scale", "topic": "romance", "options": [], "rule": "distance-1-5"}, {"id": "romance-09", "text": "Який формат романтичного часу тобі зараз ближчий?", "type": "choice", "topic": "romance", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}, {"id": "romance-10", "text": "Що найважливіше для комфортного зближення?", "type": "priority", "topic": "romance", "options": [{"id": "talk", "label": "Розмова та уважне слухання", "meaning": "dialogue"}, {"id": "time", "label": "Спокійний час поруч", "meaning": "presence"}, {"id": "plan", "label": "Конкретна домовленість або допомога", "meaning": "action"}], "rule": "semantic-equality"}]}$catalog$::jsonb);
commit;
