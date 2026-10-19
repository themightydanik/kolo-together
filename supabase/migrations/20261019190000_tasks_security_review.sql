-- Explicit task authorization; do not depend exclusively on another table's RLS.
begin;
drop policy if exists completions_read on public.task_completions;
create policy completions_read on public.task_completions for select to authenticated
using (exists (select 1 from public.task_instances i
  where i.id = task_completions.instance_id and public.can_read_task(i.task_id)));

-- Sample wall-clock time AFTER acquiring business locks. A transaction may have
-- started before midnight and waited for a newer-period request to finish.
-- Internal clock seam also allows deterministic rollover tests without exposing
-- a client-selected timestamp. This function is never a callable client RPC.
create or replace function public.task_clock() returns timestamptz
language sql volatile set search_path='' as $$ select clock_timestamp(); $$;

create or replace function public.task_period(p_recurrence text,p_anchor date) returns date
language sql volatile set search_path='' as $$
  select case p_recurrence when 'daily' then (public.task_clock() at time zone 'UTC')::date
    when 'weekly' then date_trunc('week',public.task_clock() at time zone 'UTC')::date else p_anchor end;
$$;

create or replace function public.materialize_task(p_task_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.tasks; v_period date; v_today date; v_id uuid; r public.task_reward_rules; v_joint integer;
begin
  select * into t from public.tasks where id=p_task_id;
  if t.status<>'active' then return null; end if;
  v_today:=public.task_period('daily',t.anchor_date);
  v_period:=case t.recurrence when 'daily' then v_today when 'weekly' then date_trunc('week',v_today::timestamp)::date else t.anchor_date end;
  if t.recurrence<>'once' then
    update public.task_instances set status='expired' where task_id=t.id and status='active' and period_start<v_period;
  end if;
  if v_today < t.anchor_date then return null; end if;
  select * into strict r from public.task_reward_rules where difficulty=t.difficulty;
  select together_xp into strict v_joint from public.task_economy_settings where id;
  insert into public.task_instances(task_id,period_start,xp,coins,together_xp)
    values(t.id,v_period,r.xp,r.coins,case when t.kind='joint' then v_joint else 0 end)
    on conflict(task_id,period_start) do nothing;
  select id into v_id from public.task_instances where task_id=t.id and period_start=v_period;
  return v_id;
end;
$$;

create or replace function public.complete_task_instance(p_instance_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); t public.tasks; i public.task_instances; c public.task_completions;
  v_task uuid; v_today date; v_together integer:=0;
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
  v_today:=public.task_period('daily',t.anchor_date);
  if t.status<>'active' or i.status<>'active' or v_today<t.anchor_date then raise exception 'task_unavailable'; end if;
  if t.recurrence<>'once' and i.period_start<>(case t.recurrence when 'weekly' then date_trunc('week',v_today::timestamp)::date else v_today end) then raise exception 'task_period_expired'; end if;
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

create or replace function public.refresh_task_instances() returns date
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_space uuid; t record;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
  if v_space is null then return public.task_period('daily',null); end if;
  perform 1 from public.couple_spaces where id=v_space for update;
  for t in select id from public.tasks where space_id=v_space and status='active' and public.can_read_task(id) order by id for update loop
    perform public.materialize_task(t.id);
  end loop;
  return public.task_period('daily',null);
end;
$$;

-- CREATE OR REPLACE preserves ACLs; explicitly retain the least-privilege contract.
revoke all on function public.task_clock(), public.task_period(text,date), public.materialize_task(uuid),
  public.complete_task_instance(uuid), public.refresh_task_instances() from public,anon,authenticated;
grant execute on function public.complete_task_instance(uuid), public.refresh_task_instances() to authenticated;
commit;
