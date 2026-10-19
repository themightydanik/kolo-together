-- Apply only with separate owner authorization; no remote execution here.
begin;
create table public.couple_goals (
 id uuid primary key default gen_random_uuid(), request_id uuid not null,
 space_id uuid not null references public.couple_spaces(id) on delete cascade,
 creator_id uuid not null references auth.users(id) on delete cascade,
 partner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(char_length(title) between 2 and 100),
 description text not null default '' check(char_length(description)<=1000),
 category text not null check(category in ('travel','home','relationship','health','learning','other')),
 emoji text not null check(emoji in ('🏔️','🏡','❤️','🌿','📚','✨')),
 target_date date, status text not null default 'pending' check(status in ('pending','active','paused','completed','closed','declined')),
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(creator_id,request_id), check(creator_id<>partner_id)
);
-- Consent is a normalized request/decision envelope; requester implicitly agrees,
-- the other original participant alone decides. Payload is validated server-side.
create table public.goal_consents (
 id uuid primary key default gen_random_uuid(), goal_id uuid not null references public.couple_goals(id) on delete cascade,
 request_id uuid not null, requester_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('activate','step_add','step_edit','reorder','pause','resume','close','complete')),
 payload jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','accepted','declined','withdrawn','void')),
 created_at timestamptz not null default clock_timestamp(), responded_at timestamptz,
 unique(requester_id,request_id)
);
create unique index one_pending_goal_consent on public.goal_consents(goal_id) where status='pending';
create table public.goal_steps (
 id uuid primary key default gen_random_uuid(), goal_id uuid not null references public.couple_goals(id) on delete cascade,
 title text not null check(char_length(title) between 2 and 100),
 description text not null default '' check(char_length(description)<=1000),
 position integer not null check(position between 1 and 100),
 status text not null default 'active' check(status in ('active','completed')),
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(goal_id,position) deferrable initially deferred
);
create table public.goal_step_participants (
 step_id uuid not null references public.goal_steps(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, primary key(step_id,user_id)
);
create table public.goal_step_completions (
 step_id uuid not null, user_id uuid not null, completed_at timestamptz not null default clock_timestamp(),
 primary key(step_id,user_id), foreign key(step_id,user_id) references public.goal_step_participants(step_id,user_id) on delete cascade
);
create table public.goal_events (
 id uuid primary key default gen_random_uuid(), goal_id uuid not null references public.couple_goals(id) on delete cascade,
 actor_id uuid references auth.users(id) on delete set null,
 kind text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default clock_timestamp()
);
-- Goal rewards never enter task reward_ledger or the Coins earning trigger.
create table public.goal_reward_ledger (
 goal_id uuid primary key references public.couple_goals(id) on delete cascade,
 space_id uuid not null references public.couple_spaces(id) on delete cascade,
 together_xp integer not null default 50 check(together_xp=50), created_at timestamptz not null default clock_timestamp()
);
-- Defense in depth: client writes are already denied. Never rewrite a bonus;
-- permit only FK cleanup after its parent goal has actually been deleted.
create function public.protect_goal_reward() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' or exists(select 1 from public.couple_goals where id=old.goal_id) then raise exception 'goal_reward_immutable'; end if;
 return old;
end $$;
create trigger goal_reward_immutable before update or delete on public.goal_reward_ledger for each row execute function public.protect_goal_reward();
revoke all on function public.protect_goal_reward() from public,anon,authenticated;
create index goals_space on public.couple_goals(space_id,created_at desc,id);
create index goal_consents_goal on public.goal_consents(goal_id,created_at,id);
create index goal_steps_goal on public.goal_steps(goal_id,position);
create index goal_events_goal on public.goal_events(goal_id,created_at,id);

create function public.can_read_goal(p_goal_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.couple_goals g where g.id=p_goal_id and auth.uid() in (g.creator_id,g.partner_id) and public.is_space_member(g.space_id));
$$;
create function public.can_read_goal_step(p_step_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.goal_steps s where s.id=p_step_id and public.can_read_goal(s.goal_id));
$$;
-- Internal lock/authorization contract shared by all mutations: user -> space -> goal.
create function public.lock_couple_goal(p_goal_id uuid) returns public.couple_goals
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); g public.couple_goals;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
 select * into g from public.couple_goals where id=p_goal_id;
 if not found or not public.can_read_goal(g.id) then raise exception 'goal_unavailable'; end if;
 perform 1 from public.couple_spaces where id=g.space_id for update;
 select * into g from public.couple_goals where id=p_goal_id for update;
 if not public.can_read_goal(g.id) then raise exception 'goal_unavailable'; end if;
 if g.status in ('pending','active','paused') and (select count(*) from public.couple_members where space_id=g.space_id and left_at is null and user_id in (g.creator_id,g.partner_id))<>2 then raise exception 'goal_unavailable'; end if;
 return g;
end $$;
create function public.create_couple_goal(p_request_id uuid,p_title text,p_description text,p_category text,p_emoji text,p_target_date date,p_expected_goals integer default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_space uuid; v_partner uuid; g public.couple_goals;
 v_title text:=btrim(p_title); v_description text:=btrim(coalesce(p_description,''));
begin
 if p_request_id is null or v_title is null or char_length(v_title) not between 2 and 100 or char_length(v_description)>1000
 or p_category is null or p_category not in ('travel','home','relationship','health','learning','other')
 or p_emoji is null or p_emoji not in ('🏔️','🏡','❤️','🌿','📚','✨')
 or (p_target_date is not null and p_target_date not between date '1900-01-01' and date '2200-12-31') then raise exception 'invalid_goal'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
 select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
 if v_space is null then raise exception 'space_required'; end if;
 perform 1 from public.couple_spaces where id=v_space for update;
 select * into g from public.couple_goals where creator_id=v_uid and request_id=p_request_id;
 if found then
  if g.space_id<>v_space or (g.title,g.description,g.category,g.emoji,g.target_date) is distinct from (v_title,v_description,p_category,p_emoji,p_target_date) then raise exception 'goal_request_conflict'; end if;
  return g.id;
 end if;
 if p_expected_goals is null or p_expected_goals<0 or p_expected_goals<>(select count(*) from public.couple_goals where creator_id=v_uid and space_id=v_space) then raise exception 'goal_history_changed'; end if;
 select user_id into v_partner from public.couple_members where space_id=v_space and user_id<>v_uid and left_at is null;
 if v_partner is null then raise exception 'partner_required'; end if;
 insert into public.couple_goals(request_id,space_id,creator_id,partner_id,title,description,category,emoji,target_date)
 values(p_request_id,v_space,v_uid,v_partner,v_title,v_description,p_category,p_emoji,p_target_date) returning * into g;
 insert into public.goal_consents(goal_id,request_id,requester_id,kind) values(g.id,p_request_id,v_uid,'activate');
 insert into public.goal_events(goal_id,actor_id,kind) values(g.id,v_uid,'proposed');
 return g.id;
end $$;

-- Client payload has a small fixed vocabulary. No arbitrary user IDs, XP or
-- trusted percentages. Assignment is relative to the requester's identity.
create function public.propose_goal_change(p_goal_id uuid,p_request_id uuid,p_kind text,p_payload jsonb,p_expected_changes integer default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); g public.couple_goals; c public.goal_consents; s public.goal_steps;
 v_title text; v_description text; v_id uuid; v_ids uuid[];
begin
 g:=public.lock_couple_goal(p_goal_id);
 if p_request_id is null or p_kind is null or p_kind not in ('step_add','step_edit','reorder','pause','resume','close','complete')
 or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>20000 then raise exception 'invalid_goal_change'; end if;
 select * into c from public.goal_consents where requester_id=v_uid and request_id=p_request_id;
 if found then
  if c.goal_id<>g.id or c.kind<>p_kind or c.payload<>p_payload then raise exception 'goal_request_conflict'; end if;
  return c.id;
 end if;
 if p_expected_changes is null or p_expected_changes<0 or p_expected_changes<>(select count(*) from public.goal_consents where goal_id=g.id and requester_id=v_uid) then raise exception 'goal_history_changed'; end if;
 if g.status not in ('active','paused') then raise exception 'goal_transition_denied'; end if;
 if exists(select 1 from public.goal_consents where goal_id=g.id and status='pending') then raise exception 'goal_consent_pending'; end if;
 if p_kind='resume' and g.status<>'paused' or p_kind in ('pause','step_add','step_edit','reorder','complete') and g.status<>'active' then raise exception 'goal_transition_denied'; end if;
 if p_kind in ('step_add','step_edit') then
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('title','description','assignment','step_id')) then raise exception 'invalid_goal_change'; end if;
  if jsonb_typeof(p_payload->'title') is distinct from 'string' or (p_payload ? 'description' and jsonb_typeof(p_payload->'description') is distinct from 'string') or jsonb_typeof(p_payload->'assignment') is distinct from 'string' then raise exception 'invalid_goal_change'; end if;
  v_title:=btrim(p_payload->>'title');v_description:=btrim(coalesce(p_payload->>'description',''));
  if v_title is null or char_length(v_title) not between 2 and 100 or char_length(v_description)>1000
    or p_payload->>'assignment' is null or p_payload->>'assignment' not in ('me','partner','both') then raise exception 'invalid_goal_change'; end if;
  if p_kind='step_edit' then
   if jsonb_typeof(p_payload->'step_id') is distinct from 'string' then raise exception 'invalid_goal_change'; end if;
   begin v_id:=(p_payload->>'step_id')::uuid; exception when invalid_text_representation then raise exception 'invalid_goal_change'; end;
   select * into s from public.goal_steps where id=v_id and goal_id=g.id;
   if not found or s.status<>'active' or exists(select 1 from public.goal_step_completions where step_id=s.id) then raise exception 'goal_step_locked'; end if;
  elsif (select count(*) from public.goal_steps where goal_id=g.id)>=100 or p_payload ? 'step_id' then raise exception 'invalid_goal_change'; end if;
 elsif p_kind='reorder' then
  if (p_payload-'step_ids')<>'{}'::jsonb or jsonb_typeof(p_payload->'step_ids') is distinct from 'array' then raise exception 'invalid_goal_change'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'step_ids') v where jsonb_typeof(v)<>'string') then raise exception 'invalid_goal_change'; end if;
  begin select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(p_payload->'step_ids'); exception when invalid_text_representation then raise exception 'invalid_goal_change'; end;
  if coalesce(cardinality(v_ids),0)=0 or cardinality(v_ids)<>(select count(*) from public.goal_steps where goal_id=g.id)
  or (select count(distinct x) from unnest(v_ids) x)<>cardinality(v_ids)
  or exists(select 1 from unnest(v_ids) x where not exists(select 1 from public.goal_steps where id=x and goal_id=g.id)) then raise exception 'invalid_goal_change'; end if;
 else
  if p_payload<>'{}'::jsonb then raise exception 'invalid_goal_change'; end if;
 end if;
 if p_kind='complete' and (not exists(select 1 from public.goal_steps where goal_id=g.id) or exists(select 1 from public.goal_steps where goal_id=g.id and status<>'completed')) then raise exception 'goal_not_ready'; end if;
 insert into public.goal_consents(goal_id,request_id,requester_id,kind,payload) values(g.id,p_request_id,v_uid,p_kind,p_payload) returning id into v_id;
 insert into public.goal_events(goal_id,actor_id,kind,details) values(g.id,v_uid,'change_proposed',jsonb_build_object('kind',p_kind,'consent_id',v_id));
 return v_id;
end $$;

create function public.resolve_goal_consent(p_consent_id uuid,p_decision text) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); g public.couple_goals; c public.goal_consents; v_goal uuid; v_other uuid;
 v_step uuid; v_position integer; v_expected text;
begin
 select goal_id into v_goal from public.goal_consents where id=p_consent_id;
 g:=public.lock_couple_goal(v_goal);
 select * into c from public.goal_consents where id=p_consent_id for update;
 if p_decision is null or p_decision not in ('accept','decline','withdraw') then raise exception 'goal_transition_denied'; end if;
 if (p_decision='withdraw' and v_uid<>c.requester_id) or (p_decision<>'withdraw' and v_uid=c.requester_id) then raise exception 'goal_transition_denied'; end if;
 v_expected:=case p_decision when 'accept' then 'accepted' when 'decline' then 'declined' else 'withdrawn' end;
 if c.status=v_expected then return; end if;
 if c.status<>'pending' or g.status in ('completed','closed','declined') then raise exception 'goal_transition_denied'; end if;
 -- Both original people must still be members. A new partner cannot inherit consent.
 if (select count(*) from public.couple_members where space_id=g.space_id and left_at is null and user_id in (g.creator_id,g.partner_id))<>2 then raise exception 'goal_unavailable'; end if;
 if p_decision='accept' then
  if c.kind='activate' then
   if g.status<>'pending' then raise exception 'goal_transition_denied'; end if;
   update public.couple_goals set status='active' where id=g.id;
  elsif c.kind in ('step_add','step_edit') then
   if g.status<>'active' then raise exception 'goal_transition_denied'; end if;
   if c.kind='step_add' then
    select coalesce(max(position),0)+1 into v_position from public.goal_steps where goal_id=g.id;
    insert into public.goal_steps(goal_id,title,description,position) values(g.id,btrim(c.payload->>'title'),btrim(coalesce(c.payload->>'description','')),v_position) returning id into v_step;
   else
    v_step:=(c.payload->>'step_id')::uuid;
    if exists(select 1 from public.goal_step_completions where step_id=v_step) then raise exception 'goal_step_locked'; end if;
    update public.goal_steps set title=btrim(c.payload->>'title'),description=btrim(coalesce(c.payload->>'description','')) where id=v_step and goal_id=g.id and status='active';
    if not found then raise exception 'goal_step_locked'; end if;
    delete from public.goal_step_participants where step_id=v_step;
   end if;
   v_other:=case when c.requester_id=g.creator_id then g.partner_id else g.creator_id end;
   if c.payload->>'assignment' in ('me','both') then insert into public.goal_step_participants values(v_step,c.requester_id); end if;
   if c.payload->>'assignment' in ('partner','both') then insert into public.goal_step_participants values(v_step,v_other); end if;
  elsif c.kind='reorder' then
   if g.status<>'active' then raise exception 'goal_transition_denied'; end if;
   update public.goal_steps s set position=x.position::integer from jsonb_array_elements_text(c.payload->'step_ids') with ordinality x(id,position) where s.id=x.id::uuid and s.goal_id=g.id;
  elsif c.kind='complete' then
   if g.status<>'active' or not exists(select 1 from public.goal_steps where goal_id=g.id) or exists(select 1 from public.goal_steps where goal_id=g.id and status<>'completed') then raise exception 'goal_not_ready'; end if;
   insert into public.goal_reward_ledger(goal_id,space_id) values(g.id,g.space_id);
   insert into public.space_progress values(g.space_id,50) on conflict(space_id) do update set together_xp=public.space_progress.together_xp+50;
   update public.couple_goals set status='completed',completed_at=clock_timestamp() where id=g.id;
  else
   if c.kind='pause' and g.status<>'active' or c.kind='resume' and g.status<>'paused' or c.kind='close' and g.status not in ('active','paused') then raise exception 'goal_transition_denied'; end if;
   update public.couple_goals set status=case c.kind when 'pause' then 'paused' when 'resume' then 'active' else 'closed' end where id=g.id;
  end if;
 elsif c.kind='activate' then
  update public.couple_goals set status=case when p_decision='decline' then 'declined' else 'closed' end where id=g.id;
 end if;
 update public.goal_consents set status=v_expected,responded_at=clock_timestamp() where id=c.id;
 insert into public.goal_events(goal_id,actor_id,kind,details) values(g.id,v_uid,'change_'||v_expected,jsonb_build_object('kind',c.kind,'consent_id',c.id));
end $$;
-- Recovery is a SELECT-only lookup, never a deferred write disguised as a check.
create function public.inspect_goal_request(p_request_id uuid,p_goal_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_result jsonb;
begin
 if p_goal_id is null then
  select jsonb_build_object('id',g.id,'status',g.status,'kind','create') into v_result from public.couple_goals g
   where g.creator_id=v_uid and g.request_id=p_request_id and public.can_read_goal(g.id);
 else
  select jsonb_build_object('id',c.id,'status',c.status,'kind',c.kind) into v_result from public.goal_consents c
   where c.requester_id=v_uid and c.request_id=p_request_id and c.goal_id=p_goal_id and public.can_read_goal(c.goal_id);
 end if;
 return v_result;
end $$;
revoke all on function public.inspect_goal_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.inspect_goal_request(uuid,uuid) to authenticated;
create function public.complete_goal_step(p_step_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); g public.couple_goals; v_goal uuid; s public.goal_steps;
begin
 select goal_id into v_goal from public.goal_steps where id=p_step_id;
 g:=public.lock_couple_goal(v_goal);
 select * into s from public.goal_steps where id=p_step_id for update;
 if not exists(select 1 from public.goal_step_participants where step_id=s.id and user_id=v_uid) then raise exception 'goal_transition_denied'; end if;
 if exists(select 1 from public.goal_step_completions where step_id=s.id and user_id=v_uid) then return; end if;
 if g.status<>'active' or s.status<>'active' then raise exception 'goal_transition_denied'; end if;
 if exists(select 1 from public.goal_consents where goal_id=g.id and status='pending') then raise exception 'goal_consent_pending'; end if;
 insert into public.goal_step_completions values(s.id,v_uid,clock_timestamp());
 if (select count(*) from public.goal_step_completions where step_id=s.id)=(select count(*) from public.goal_step_participants where step_id=s.id) then
  update public.goal_steps set status='completed',completed_at=clock_timestamp() where id=s.id;
 end if;
 insert into public.goal_events(goal_id,actor_id,kind,details) values(g.id,v_uid,'step_completed',jsonb_build_object('step_id',s.id,'title',s.title));
end $$;
create function public.close_goals_on_departure() returns trigger
language plpgsql security definer set search_path='' as $$
declare g record;
begin
 if old.left_at is null and new.left_at is not null then
  perform 1 from public.couple_spaces where id=old.space_id for update;
  for g in select id from public.couple_goals where space_id=old.space_id and old.user_id in (creator_id,partner_id) and status in ('pending','active','paused') order by id for update loop
   update public.couple_goals set status='closed' where id=g.id;
   update public.goal_consents set status='void',responded_at=clock_timestamp() where goal_id=g.id and status='pending';
   insert into public.goal_events(goal_id,actor_id,kind) values(g.id,old.user_id,'closed_on_departure');
  end loop;
 end if;
 return new;
end $$;
create trigger goals_member_departure after update of left_at on public.couple_members for each row execute function public.close_goals_on_departure();

alter table public.couple_goals enable row level security;
alter table public.goal_consents enable row level security;
alter table public.goal_steps enable row level security;
alter table public.goal_step_participants enable row level security;
alter table public.goal_step_completions enable row level security;
alter table public.goal_events enable row level security;
alter table public.goal_reward_ledger enable row level security;
create policy goals_read on public.couple_goals for select to authenticated using(public.can_read_goal(id));
create policy goal_consents_read on public.goal_consents for select to authenticated using(public.can_read_goal(goal_id));
create policy goal_steps_read on public.goal_steps for select to authenticated using(public.can_read_goal(goal_id));
create policy goal_participants_read on public.goal_step_participants for select to authenticated using(public.can_read_goal_step(step_id));
create policy goal_completions_read on public.goal_step_completions for select to authenticated using(public.can_read_goal_step(step_id));
create policy goal_events_read on public.goal_events for select to authenticated using(public.can_read_goal(goal_id));
create policy goal_rewards_read on public.goal_reward_ledger for select to authenticated using(public.can_read_goal(goal_id));
create view public.goal_progress with (security_invoker=true) as
 select g.id as goal_id,count(s.id)::integer as total_steps,
 count(s.id) filter(where s.status='completed')::integer as completed_steps,
 case when count(s.id)=0 then 0 else (count(s.id) filter(where s.status='completed')*100/count(s.id))::integer end as percent
 from public.couple_goals g left join public.goal_steps s on s.goal_id=g.id group by g.id;
revoke all on public.goal_progress from public,anon,authenticated;
grant select on public.goal_progress to authenticated;
revoke all on public.couple_goals,public.goal_consents,public.goal_steps,public.goal_step_participants,public.goal_step_completions,public.goal_events,public.goal_reward_ledger from public,anon,authenticated;
grant select on public.couple_goals,public.goal_consents,public.goal_steps,public.goal_step_participants,public.goal_step_completions,public.goal_events,public.goal_reward_ledger to authenticated;
revoke all on function public.can_read_goal(uuid),public.can_read_goal_step(uuid),public.lock_couple_goal(uuid),public.create_couple_goal(uuid,text,text,text,text,date,integer),public.propose_goal_change(uuid,uuid,text,jsonb,integer),public.resolve_goal_consent(uuid,text),public.complete_goal_step(uuid),public.close_goals_on_departure() from public,anon,authenticated;
grant execute on function public.can_read_goal(uuid),public.can_read_goal_step(uuid),public.create_couple_goal(uuid,text,text,text,text,date,integer),public.propose_goal_change(uuid,uuid,text,jsonb,integer),public.resolve_goal_consent(uuid,text),public.complete_goal_step(uuid) to authenticated;
commit;
