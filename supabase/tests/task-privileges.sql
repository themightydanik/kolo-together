do $$
declare sig text; fn oid; allow_auth boolean; tab text;
begin
  foreach sig in array array['public.task_clock()','public.can_read_task(uuid)','public.task_period(text,date)','public.materialize_task(uuid)',
    'public.create_task(uuid,text,text,text,text,text,date,text)','public.respond_task(uuid,boolean)',
    'public.refresh_task_instances()','public.complete_task_instance(uuid)','public.cancel_task(uuid)','public.close_tasks_on_departure()'] loop
    fn:=sig::regprocedure;
    allow_auth:=sig not in ('public.task_clock()','public.task_period(text,date)','public.materialize_task(uuid)','public.close_tasks_on_departure()');
    if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')<>allow_auth then raise exception 'invalid task function privilege: %',sig; end if;
    if exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=fn and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC task function privilege: %',sig; end if;
    if not exists(select 1 from pg_proc where oid=fn and proconfig @> array['search_path=""']) then raise exception 'unsafe task search_path: %',sig; end if;
  end loop;
  foreach tab in array array['task_reward_rules','task_economy_settings','tasks','task_participants','task_instances','task_completions','user_progress','space_progress','reward_ledger'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||tab)::regclass) then raise exception 'RLS disabled: %',tab; end if;
    if has_table_privilege('authenticated','public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('anon','public.'||tab,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'excessive table grant: %',tab; end if;
  end loop;
end;
$$;
