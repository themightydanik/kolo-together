-- Tasks, consent, UTC calendar instances and append-only earned points. No payments.
create table public.task_reward_rules (
  difficulty text primary key check (difficulty in ('easy','normal','hard')),
  xp integer not null check (xp > 0), coins integer not null check (coins > 0)
);
insert into public.task_reward_rules values ('easy',10,5),('normal',20,10),('hard',35,15);
create table public.task_economy_settings (
  id boolean primary key default true check (id),
  together_xp integer not null check (together_xp > 0)
);
insert into public.task_economy_settings values (true,20);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  space_id uuid not null references public.couple_spaces(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  description text not null default '' check (char_length(description) <= 1000),
  kind text not null check (kind in ('personal','proposal','joint')),
  category text not null check (category in ('care','home','communication','time','growth','other')),
  difficulty text not null references public.task_reward_rules(difficulty),
  due_date date,
  anchor_date date not null default (now() at time zone 'UTC')::date,
  recurrence text not null check (recurrence in ('once','daily','weekly')),
  status text not null check (status in ('pending','active','completed','declined','cancelled')),
  created_at timestamptz not null default now(),
  unique(creator_id,request_id)
);
create index tasks_space_status on public.tasks(space_id,status);
create table public.task_participants (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  consent text not null check (consent in ('pending','accepted','declined')),
  responded_at timestamptz,
  primary key(task_id,user_id)
);
create table public.task_instances (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  period_start date not null,
  status text not null default 'active' check (status in ('active','completed','cancelled','expired')),
  xp integer not null check (xp>0), coins integer not null check (coins>0), together_xp integer not null check (together_xp>=0),
  created_at timestamptz not null default now(), completed_at timestamptz,
  unique(task_id,period_start)
);
create table public.task_completions (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.task_instances(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique(instance_id,user_id)
);
create table public.user_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp bigint not null default 0 check (xp between 0 and 9007199254740991),
  coins bigint not null default 0 check (coins between 0 and 9007199254740991)
);
create table public.space_progress (
  space_id uuid primary key references public.couple_spaces(id) on delete cascade,
  together_xp bigint not null default 0 check (together_xp between 0 and 9007199254740991)
);
create table public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  instance_id uuid not null references public.task_instances(id) on delete cascade,
  completion_id uuid unique references public.task_completions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  space_id uuid not null references public.couple_spaces(id) on delete cascade,
  kind text not null check (kind in ('personal','together')),
  title text not null,
  xp integer not null, coins integer not null, together_xp integer not null,
  created_at timestamptz not null default now(),
  check ((kind='personal' and user_id is not null and completion_id is not null and xp>0 and coins>0 and together_xp=0)
      or (kind='together' and user_id is null and completion_id is null and xp=0 and coins=0 and together_xp>0))
);
create unique index one_personal_grant on public.reward_ledger(instance_id,user_id) where kind='personal';
create unique index one_together_grant on public.reward_ledger(instance_id) where kind='together';
create index ledger_user_time on public.reward_ledger(user_id,created_at desc);

-- Internal helpers are not executable by client roles. Public boolean predicate is required by RLS.
create function public.can_read_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.tasks t where t.id=p_task_id and public.is_space_member(t.space_id)
    and (t.creator_id=auth.uid() or exists(select 1 from public.task_participants p where p.task_id=t.id and p.user_id=auth.uid())));
$$;
create function public.task_period(p_recurrence text,p_anchor date) returns date
language sql stable set search_path='' as $$
  select case p_recurrence when 'daily' then (now() at time zone 'UTC')::date
    when 'weekly' then date_trunc('week',now() at time zone 'UTC')::date else p_anchor end;
$$;
-- Caller must already hold the space and task locks. Never accepts a client-selected period/reward.
create function public.materialize_task(p_task_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.tasks; v_period date; v_id uuid; r public.task_reward_rules; v_joint integer;
begin
  select * into t from public.tasks where id=p_task_id;
  if t.status<>'active' then return null; end if;
  v_period:=public.task_period(t.recurrence,t.anchor_date);
  if t.recurrence<>'once' then
    update public.task_instances set status='expired' where task_id=t.id and status='active' and period_start<v_period;
  end if;
  if (now() at time zone 'UTC')::date < t.anchor_date then return null; end if;
  select * into strict r from public.task_reward_rules where difficulty=t.difficulty;
  select together_xp into strict v_joint from public.task_economy_settings where id;
  insert into public.task_instances(task_id,period_start,xp,coins,together_xp)
    values(t.id,v_period,r.xp,r.coins,case when t.kind='joint' then v_joint else 0 end)
    on conflict(task_id,period_start) do nothing;
  select id into v_id from public.task_instances where task_id=t.id and period_start=v_period;
  return v_id;
end;
$$;
create function public.create_task(p_request_id uuid,p_title text,p_description text,p_kind text,p_category text,p_difficulty text,p_due_date date,p_recurrence text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_space uuid; v_partner uuid; v_id uuid; old public.tasks;
  v_title text:=btrim(p_title); v_description text:=btrim(coalesce(p_description,''));
begin
  if p_request_id is null or v_title is null or char_length(v_title) not between 2 and 100 or char_length(v_description)>1000
    or p_kind is null or p_kind not in ('personal','proposal','joint') or p_category is null or p_category not in ('care','home','communication','time','growth','other')
    or p_difficulty is null or p_difficulty not in ('easy','normal','hard') or p_recurrence is null or p_recurrence not in ('once','daily','weekly')
    or (p_due_date is not null and not isfinite(p_due_date)) then raise exception 'invalid_task'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
  if v_space is null then raise exception 'space_required'; end if;
  perform 1 from public.couple_spaces where id=v_space for update;
  select * into old from public.tasks where creator_id=v_uid and request_id=p_request_id;
  if found then
    if old.space_id=v_space and old.title=v_title and old.description=v_description and old.kind=p_kind and old.category=p_category
      and old.difficulty=p_difficulty and old.due_date is not distinct from p_due_date and old.recurrence=p_recurrence then return old.id;
    end if;
    raise exception 'task_request_conflict';
  end if;
  select user_id into v_partner from public.couple_members where space_id=v_space and user_id<>v_uid and left_at is null;
  if p_kind<>'personal' and v_partner is null then raise exception 'partner_required'; end if;
  insert into public.tasks(request_id,space_id,creator_id,title,description,kind,category,difficulty,due_date,anchor_date,recurrence,status)
    values(p_request_id,v_space,v_uid,v_title,v_description,p_kind,p_category,p_difficulty,p_due_date,coalesce(p_due_date,(now() at time zone 'UTC')::date),p_recurrence,case when p_kind='personal' then 'active' else 'pending' end)
    returning id into v_id;
  if p_kind in ('personal','joint') then
    insert into public.task_participants values(v_id,v_uid,'accepted',now());
  end if;
  if p_kind<>'personal' then insert into public.task_participants values(v_id,v_partner,'pending',null); end if;
  perform public.materialize_task(v_id);
  return v_id;
end;
$$;
create function public.respond_task(p_task_id uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); t public.tasks; v_consent text;
begin
  if p_accept is null then raise exception 'invalid_task'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into t from public.tasks where id=p_task_id;
  if not found or not public.can_read_task(t.id) then raise exception 'task_unavailable'; end if;
  perform 1 from public.couple_spaces where id=t.space_id for update;
  select * into t from public.tasks where id=t.id for update;
  if not public.can_read_task(t.id) then raise exception 'task_unavailable'; end if;
  select consent into v_consent from public.task_participants where task_id=t.id and user_id=v_uid;
  if v_consent=(case when p_accept then 'accepted' else 'declined' end) and t.creator_id<>v_uid
    and t.status in ('active','completed','declined') then return; end if;
  if t.status<>'pending' or v_consent is distinct from 'pending' then raise exception 'task_transition_denied'; end if;
  update public.task_participants set consent=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where task_id=t.id and user_id=v_uid;
  update public.tasks set status=case when p_accept then 'active' else 'declined' end where id=t.id;
  if p_accept then perform public.materialize_task(t.id); end if;
end;
$$;
create function public.refresh_task_instances() returns date
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_space uuid; t record;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
  if v_space is null then return (now() at time zone 'UTC')::date; end if;
  perform 1 from public.couple_spaces where id=v_space for update;
  for t in select id from public.tasks where space_id=v_space and status='active' and public.can_read_task(id) order by id for update loop
    perform public.materialize_task(t.id);
  end loop;
  return (now() at time zone 'UTC')::date;
end;
$$;
create function public.complete_task_instance(p_instance_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); t public.tasks; i public.task_instances; c public.task_completions;
  v_task uuid; v_together integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select task_id into v_task from public.task_instances where id=p_instance_id;
  select * into t from public.tasks where id=v_task;
  if not found or not public.can_read_task(t.id) then raise exception 'task_unavailable'; end if;
  perform 1 from public.couple_spaces where id=t.space_id for update;
  select * into t from public.tasks where id=t.id for update;
  if not public.can_read_task(t.id) or not exists(select 1 from public.task_participants where task_id=t.id and user_id=v_uid and consent='accepted') then raise exception 'task_unavailable'; end if;
  select * into i from public.task_instances where id=p_instance_id for update;
  select * into c from public.task_completions where instance_id=i.id and user_id=v_uid;
  if found then return jsonb_build_object('already_completed',true,'xp',i.xp,'coins',i.coins,'together_xp',0); end if;
  if t.status<>'active' or i.status<>'active' or (now() at time zone 'UTC')::date<t.anchor_date then raise exception 'task_unavailable'; end if;
  if t.recurrence<>'once' and i.period_start<>public.task_period(t.recurrence,t.anchor_date) then raise exception 'task_period_expired'; end if;
  -- Joint completion always requires two accepted, still-active members, not a mutable row count.
  if t.kind='joint' and (select count(*) from public.task_participants p join public.couple_members m on m.user_id=p.user_id and m.space_id=t.space_id and m.left_at is null where p.task_id=t.id and p.consent='accepted')<>2 then raise exception 'task_unavailable'; end if;
  insert into public.task_completions(instance_id,user_id) values(i.id,v_uid) returning * into c;
  insert into public.reward_ledger(task_id,instance_id,completion_id,user_id,space_id,kind,title,xp,coins,together_xp)
    values(t.id,i.id,c.id,v_uid,t.space_id,'personal',t.title,i.xp,i.coins,0);
  insert into public.user_progress values(v_uid,i.xp,i.coins) on conflict(user_id) do update
    set xp=public.user_progress.xp+excluded.xp,coins=public.user_progress.coins+excluded.coins;
  if (select count(*) from public.task_completions where instance_id=i.id)=(case when t.kind='joint' then 2 else 1 end) then
    update public.task_instances set status='completed',completed_at=now() where id=i.id;
    if t.recurrence='once' then update public.tasks set status='completed' where id=t.id; end if;
    if t.kind='joint' then
      insert into public.reward_ledger(task_id,instance_id,space_id,kind,title,xp,coins,together_xp) values(t.id,i.id,t.space_id,'together',t.title,0,0,i.together_xp);
      insert into public.space_progress values(t.space_id,i.together_xp) on conflict(space_id) do update set together_xp=public.space_progress.together_xp+excluded.together_xp;
      v_together:=i.together_xp;
    end if;
  end if;
  return jsonb_build_object('already_completed',false,'xp',i.xp,'coins',i.coins,'together_xp',v_together);
end;
$$;
create function public.cancel_task(p_task_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); t public.tasks;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into t from public.tasks where id=p_task_id;
  if not found or t.creator_id<>v_uid or not public.can_read_task(t.id) then raise exception 'task_unavailable'; end if;
  perform 1 from public.couple_spaces where id=t.space_id for update;
  select * into t from public.tasks where id=t.id for update;
  if not public.can_read_task(t.id) then raise exception 'task_unavailable'; end if;
  if t.status='cancelled' then return; end if;
  if t.status not in ('pending','active') then raise exception 'task_transition_denied'; end if;
  perform public.materialize_task(t.id);
  if exists(select 1 from public.task_instances i join public.task_completions c on c.instance_id=i.id where i.task_id=t.id and i.status='active') then raise exception 'task_has_completions'; end if;
  update public.tasks set status='cancelled' where id=t.id;
  update public.task_instances set status='cancelled' where task_id=t.id and status='active';
end;
$$;
-- Existing leave RPC holds user -> space locks. The trigger adds closure, not a new pair model.
create function public.close_tasks_on_departure() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.left_at is null and new.left_at is not null then
    perform 1 from public.couple_spaces where id=old.space_id for update;
    update public.tasks set status='cancelled' where space_id=old.space_id and status in ('pending','active') and (kind<>'personal' or creator_id=old.user_id);
    update public.task_instances i set status='cancelled' from public.tasks t where i.task_id=t.id and t.space_id=old.space_id and t.status='cancelled' and i.status='active';
  end if;
  return new;
end;
$$;
create trigger close_tasks_on_departure after update of left_at on public.couple_members for each row execute function public.close_tasks_on_departure();

alter table public.task_reward_rules enable row level security;
alter table public.task_economy_settings enable row level security;
alter table public.tasks enable row level security;
alter table public.task_participants enable row level security;
alter table public.task_instances enable row level security;
alter table public.task_completions enable row level security;
alter table public.user_progress enable row level security;
alter table public.space_progress enable row level security;
alter table public.reward_ledger enable row level security;
create policy reward_rules_read on public.task_reward_rules for select to authenticated using(true);
create policy economy_settings_read on public.task_economy_settings for select to authenticated using(true);
create policy tasks_read on public.tasks for select to authenticated using(public.can_read_task(id));
create policy participants_read on public.task_participants for select to authenticated using(public.can_read_task(task_id));
create policy instances_read on public.task_instances for select to authenticated using(public.can_read_task(task_id));
create policy completions_read on public.task_completions for select to authenticated using(exists(select 1 from public.task_instances i where i.id=instance_id));
create policy user_progress_read on public.user_progress for select to authenticated using(user_id=auth.uid());
create policy space_progress_read on public.space_progress for select to authenticated using(public.is_space_member(space_id));
create policy ledger_read on public.reward_ledger for select to authenticated using(user_id=auth.uid() or (kind='together' and public.can_read_task(task_id)));
revoke all on public.task_reward_rules,public.task_economy_settings,public.tasks,public.task_participants,public.task_instances,public.task_completions,public.user_progress,public.space_progress,public.reward_ledger from public,anon,authenticated;
grant select on public.task_reward_rules,public.task_economy_settings,public.tasks,public.task_participants,public.task_instances,public.task_completions,public.user_progress,public.space_progress,public.reward_ledger to authenticated;
revoke all on function public.can_read_task(uuid),public.task_period(text,date),public.materialize_task(uuid),public.create_task(uuid,text,text,text,text,text,date,text),public.respond_task(uuid,boolean),public.refresh_task_instances(),public.complete_task_instance(uuid),public.cancel_task(uuid),public.close_tasks_on_departure() from public,anon,authenticated;
grant execute on function public.can_read_task(uuid),public.create_task(uuid,text,text,text,text,text,date,text),public.respond_task(uuid,boolean),public.refresh_task_instances(),public.complete_task_instance(uuid),public.cancel_task(uuid) to authenticated;
