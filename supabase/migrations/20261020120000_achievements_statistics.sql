-- Read models only: no change to earning/spending/consent rules. Never auto-run remotely.
begin;
create index statistics_personal_facts_idx on public.reward_ledger(user_id,created_at,id) where kind='personal';
create index statistics_joint_facts_idx on public.reward_ledger(space_id,created_at desc,('task:'||id::text) desc) where kind='together';
create index statistics_goal_facts_idx on public.goal_reward_ledger(space_id,created_at desc,('goal:'||goal_id::text) desc);
create index statistics_purchase_facts_idx on public.reward_purchases(space_id,resolved_at desc,('reward:'||id::text) desc) where status='completed';

-- Owner-only, invoker views. Public RPCs below verify auth.uid() and expose bounded,
-- purpose-specific projections. Views cannot be queried through client REST.
create view public.statistics_joint_facts with(security_invoker=true) as
 select r.space_id,r.created_at as at,'task:'||r.id::text as key,'task'::text as kind,
   r.instance_id as object_id,r.title,r.together_xp,r.xmin as source_xid
 from public.reward_ledger r join public.tasks t on t.id=r.task_id
 where r.space_id=(select space_id from public.couple_members where user_id=auth.uid() and left_at is null) and r.kind='together' and t.kind='joint' and public.can_read_task(t.id)
   and (select count(*) from public.task_participants p where p.task_id=t.id and p.consent='accepted'
     and public.is_partner(p.user_id))=2
 union all
 select r.space_id,r.created_at,'goal:'||r.goal_id::text,'goal',g.id,g.title,r.together_xp,r.xmin
 from public.goal_reward_ledger r join public.couple_goals g on g.id=r.goal_id
 where r.space_id=(select space_id from public.couple_members where user_id=auth.uid() and left_at is null) and public.can_read_goal(g.id) and public.is_partner(g.creator_id) and public.is_partner(g.partner_id)
 union all
 select p.space_id,p.resolved_at,'reward:'||p.id::text,'reward',p.id,p.title,0,p.xmin
 from public.reward_purchases p
 where p.space_id=(select space_id from public.couple_members where user_id=auth.uid() and left_at is null) and p.status='completed' and p.resolved_at is not null and public.is_space_member(p.space_id)
   and auth.uid() in (p.buyer_id,p.provider_id) and public.is_partner(p.buyer_id) and public.is_partner(p.provider_id);
revoke all on public.statistics_joint_facts from public,anon,authenticated;

-- Bounded, fixed catalogue; no client-provided counters or arbitrary filters.
create function public.statistics_context() returns text
language sql stable security invoker set search_path='' as $$
 select coalesce(string_agg(m.id::text,':' order by m.id),'solo')
 from public.couple_members m where m.left_at is null and public.is_space_member(m.space_id);
$$;
create function public.statistics_badges() returns table(code text,scope text,metric text,threshold integer,progress bigint,unlocked_at timestamptz)
language sql stable security invoker set search_path='' as $$
 with personal as (
   select r.created_at,row_number() over(order by r.created_at,r.id) as n
   from public.reward_ledger r where r.kind='personal' and r.user_id=auth.uid()
 ), joint as (
   select f.kind,f.at,row_number() over(partition by f.kind order by f.at,f.key) as n
   from public.statistics_joint_facts f where f.kind in ('task','goal')
 ), catalog(code,scope,metric,threshold) as (values
 ('personal_1','personal','personal',1),('personal_10','personal','personal',10),('personal_25','personal','personal',25),
 ('joint_1','shared','task',1),('joint_5','shared','task',5),('joint_10','shared','task',10),('joint_25','shared','task',25),
 ('goal_1','shared','goal',1),('goal_3','shared','goal',3),('goal_10','shared','goal',10),
 ('together_20','space','xp',20),('together_100','space','xp',100),('together_500','space','xp',500)
 )
 select c.code,c.scope,c.metric,c.threshold,
   case c.metric when 'personal' then (select count(*) from personal)
     when 'xp' then coalesce((select p.together_xp from public.space_progress p where public.is_space_member(p.space_id)),0)
     else (select count(*) from joint j where j.kind=c.metric) end,
   case when c.metric='personal' then (select p.created_at from personal p where p.n=c.threshold)
     when c.metric<>'xp' then (select j.at from joint j where j.kind=c.metric and j.n=c.threshold) end
 from catalog c;
$$;

create function public.get_statistics() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_today date:=(statement_timestamp() at time zone 'UTC')::date; v_result jsonb;
begin
 with own_days as (
   select (r.created_at at time zone 'UTC')::date as day,count(*)::integer as actions
   from public.reward_ledger r where r.kind='personal' and r.user_id=v_uid
   group by 1
 ), islands as (
   select day,day-(row_number() over(order by day))::integer as grp from own_days
 ), runs as (
   select max(day) as last_day,count(*)::integer as length from islands group by grp
 ), days as (
   select v_today-i as day from generate_series(0,29) i
 ), joint_facts as materialized (select * from public.statistics_joint_facts), joint_days as (
   select (f.at at time zone 'UTC')::date as day,sum(f.together_xp)::bigint as xp
   from joint_facts f where f.kind in ('task','goal') group by 1
 ), calendar as (
   select d.day,coalesce(o.actions,0) as actions,coalesce(j.xp,0) as together_xp,
     coalesce((select sum(j2.xp) from joint_days j2 where j2.day<=d.day),0) as cumulative_xp
   from days d left join own_days o using(day) left join joint_days j using(day)
 ), badges as (select * from public.statistics_badges()), totals as (
   select coalesce((select xp from public.user_progress where user_id=v_uid),0) as xp,
     coalesce((select coins from public.user_progress where user_id=v_uid),0) as coins,
     coalesce((select together_xp from public.space_progress where public.is_space_member(space_id)),0) as together_xp
 )
 select jsonb_build_object('as_of',statement_timestamp(),'timezone','UTC','context',public.statistics_context(),
   'personal',jsonb_build_object('xp',t.xp,'coins',t.coins,
     'tasks',(select count(*) from public.reward_ledger where user_id=v_uid and kind='personal'),
     'achievements',(select count(*) from badges where scope='personal' and progress>=threshold)),
   'shared',jsonb_build_object('together_xp',t.together_xp,
     'tasks',(select count(*) from joint_facts where kind='task'),
     'goals',(select count(*) from joint_facts where kind='goal'),
     'achievements',(select count(*) from badges where scope<>'personal' and progress>=threshold),
     'xp_series_complete',t.together_xp=coalesce((select sum(xp) from joint_days),0)),
   'streak',jsonb_build_object('current',coalesce((select length from runs where last_day between v_today-1 and v_today order by last_day desc limit 1),0),
     'best',coalesce((select max(length) from runs),0)),
   'activity',jsonb_build_object('days7', (select count(*) from own_days where day between v_today-6 and v_today),
     'days30',(select count(*) from own_days where day between v_today-29 and v_today)),
   'calendar',(select jsonb_agg(to_jsonb(c) order by day) from calendar c),
   'badges',(select jsonb_agg(to_jsonb(b) order by code) from badges b)) into v_result from totals t;
 return v_result;
end $$;

-- Extend a visible row's 32-bit xmin into the current xid epoch before testing
-- visibility in the first page's saved snapshot. Frozen rows predate that snapshot.
-- This excludes late commits with backdated transaction timestamps and keeps
-- computed threshold dates stable across pages. Never a client-callable RPC.
create function public.statistics_visible(p_xid xid,p_snapshot pg_snapshot) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare current_max bigint:=pg_snapshot_xmax(pg_current_snapshot())::text::bigint;
 extended bigint:=(current_max/4294967296)*4294967296+p_xid::text::bigint;
begin
 if p_xid='2'::xid then return true; end if;
 if extended>current_max then extended:=extended-4294967296; end if;
 return pg_visible_in_snapshot(extended::text::xid8,p_snapshot);
end $$;

-- Opaque server-side snapshot sessions hide cluster transaction IDs. A session
-- belongs to one caller and membership epoch; capped at ten per user, 30 min TTL.
create table public.statistics_history_sessions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 context text not null, snapshot pg_snapshot not null, until_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '30 minutes'
);
create index statistics_history_owner on public.statistics_history_sessions(user_id,created_at desc,id);
alter table public.statistics_history_sessions enable row level security;
revoke all on public.statistics_history_sessions from public,anon,authenticated;
create function public.get_joint_history(p_cursor jsonb default null,p_limit integer default 20) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_context text:=public.statistics_context();
 v_session public.statistics_history_sessions; v_snapshot pg_snapshot; v_until timestamptz; v_at timestamptz;
 v_key text; v_rows jsonb; v_last jsonb; v_next jsonb;
begin
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid_statistics_cursor'; end if;
 if p_cursor is null then
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  v_context:=public.statistics_context();
  delete from public.statistics_history_sessions where user_id=v_uid and expires_at<=clock_timestamp();
  -- Keep at most nine older sessions before inserting a new one.
  delete from public.statistics_history_sessions where user_id=v_uid and id in (
    select id from public.statistics_history_sessions where user_id=v_uid order by created_at desc,id offset 9);
  insert into public.statistics_history_sessions(user_id,context,snapshot,until_at)
   values(v_uid,v_context,pg_current_snapshot(),clock_timestamp()) returning * into v_session;
 else
  begin
   if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>1024
     or not (p_cursor ?& array['session','at','key'])
     or (select count(*) from jsonb_object_keys(p_cursor))<>3
     or jsonb_typeof(p_cursor->'session')<>'string' or jsonb_typeof(p_cursor->'at')<>'string'
     or jsonb_typeof(p_cursor->'key')<>'string' then raise exception 'invalid_statistics_cursor'; end if;
   select * into v_session from public.statistics_history_sessions where id=(p_cursor->>'session')::uuid
     and user_id=v_uid and context=v_context and expires_at>clock_timestamp();
   if not found then raise exception 'invalid_statistics_cursor'; end if;
   v_at:=(p_cursor->>'at')::timestamptz; v_key:=p_cursor->>'key';
   if not isfinite(v_at) or v_at>v_session.until_at then raise exception 'invalid_statistics_cursor'; end if;
  exception when others then raise exception 'invalid_statistics_cursor'; end;
 end if;
 v_until:=v_session.until_at; v_snapshot:=v_session.snapshot;
 -- At most (limit+1) candidates per indexed source, plus the fixed catalogue.
 with task_page as (
  select * from public.statistics_joint_facts f where f.kind='task' and public.statistics_visible(f.source_xid,v_snapshot) and f.at<=v_until
    and (v_at is null or (f.at,f.key)<(v_at,v_key)) order by f.at desc,f.key desc limit p_limit+1
 ), goal_page as (
  select * from public.statistics_joint_facts f where f.kind='goal' and public.statistics_visible(f.source_xid,v_snapshot) and f.at<=v_until
    and (v_at is null or (f.at,f.key)<(v_at,v_key)) order by f.at desc,f.key desc limit p_limit+1
 ), reward_page as (
  select * from public.statistics_joint_facts f where f.kind='reward' and public.statistics_visible(f.source_xid,v_snapshot) and f.at<=v_until
    and (v_at is null or (f.at,f.key)<(v_at,v_key)) order by f.at desc,f.key desc limit p_limit+1
 ), first_tasks as (
  select f.at,f.key from public.statistics_joint_facts f where kind='task' and public.statistics_visible(f.source_xid,v_snapshot) and at<=v_until order by at,key limit 25
 ), first_goals as (
  select f.at,f.key from public.statistics_joint_facts f where kind='goal' and public.statistics_visible(f.source_xid,v_snapshot) and at<=v_until order by at,key limit 10
 ), ranked as (
  select 'joint_'||row_number() over(order by at,key)::text as code,at from first_tasks
  union all select 'goal_'||row_number() over(order by at,key)::text,at from first_goals
 ), badge_page as (
  select at,'achievement:'||code as key,'achievement'::text as kind,null::uuid as object_id,code as title
  from ranked where code in ('joint_1','joint_5','joint_10','joint_25','goal_1','goal_3','goal_10') and at<=v_until
    and (v_at is null or (at,'achievement:'||code)<(v_at,v_key))
 ), candidates as (
  select at,key,kind,object_id,title from task_page union all select at,key,kind,object_id,title from goal_page
  union all select at,key,kind,object_id,title from reward_page union all select * from badge_page
 ), page as (select * from candidates order by at desc,key desc limit p_limit+1)
 select coalesce(jsonb_agg(to_jsonb(p) order by at desc,key desc),'[]'::jsonb) into v_rows from page p;
 if jsonb_array_length(v_rows)>p_limit then
   v_rows:=v_rows-(jsonb_array_length(v_rows)-1); v_last:=v_rows->(p_limit-1);
   v_next:=jsonb_build_object('session',v_session.id,'at',v_last->>'at','key',v_last->>'key');
 end if;
 return jsonb_build_object('items',v_rows,'next_cursor',v_next,'context',v_context);
end $$;

-- Remembers delivery of a congratulations, not an unlock ledger. First visit and
-- membership changes establish a silent historical baseline. Never alters XP.
create table public.statistics_seen (
 user_id uuid primary key references auth.users(id) on delete cascade,
 context text not null,codes text[] not null,updated_at timestamptz not null default clock_timestamp()
);
alter table public.statistics_seen enable row level security;
create policy statistics_seen_read on public.statistics_seen for select to authenticated using(user_id=auth.uid());
revoke all on public.statistics_seen from public,anon,authenticated;
grant select on public.statistics_seen to authenticated;
create function public.acknowledge_statistics() returns text[]
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_context text; v_codes text[]; v_new text[]:='{}'; old public.statistics_seen;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
 perform 1 from public.couple_spaces where id=(select space_id from public.couple_members where user_id=v_uid and left_at is null) for share;
 v_context:=public.statistics_context();
 select coalesce(array_agg(code order by code),'{}') into v_codes from public.statistics_badges() where progress>=threshold;
 select * into old from public.statistics_seen where user_id=v_uid;
 if found then
  -- Personal baselines survive membership changes; shared ones are re-baselined.
  select coalesce(array_agg(c),'{}') into v_new from unnest(v_codes) c
    where not c=any(old.codes) and (old.context=v_context or c like 'personal\_%' escape '\');
 end if;
 insert into public.statistics_seen(user_id,context,codes) values(v_uid,v_context,v_codes)
 on conflict(user_id) do update set context=excluded.context,codes=excluded.codes,updated_at=clock_timestamp();
 return v_new;
end $$;
revoke all on function public.statistics_visible(xid,pg_snapshot),public.statistics_context(),public.statistics_badges(),public.get_statistics(),public.get_joint_history(jsonb,integer),public.acknowledge_statistics() from public,anon,authenticated;
grant execute on function public.get_statistics(),public.get_joint_history(jsonb,integer),public.acknowledge_statistics() to authenticated;
commit;
