do $$
declare sig text; fn oid; private boolean;
begin
 foreach sig in array array['public.statistics_visible(xid,pg_snapshot)','public.statistics_context()','public.statistics_badges()','public.get_statistics()','public.get_joint_history(jsonb,integer)','public.acknowledge_statistics()'] loop
  fn:=sig::regprocedure; private:=sig in ('public.statistics_visible(xid,pg_snapshot)','public.statistics_context()','public.statistics_badges()');
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')=private then raise exception 'invalid statistics grants: %',sig; end if;
  if exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=fn and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC statistics grant'; end if;
  if not exists(select 1 from pg_proc where oid=fn and proconfig @> array['search_path=""'] and prosecdef<>private) then raise exception 'unsafe statistics function: %',sig; end if;
 end loop;
 if not (select relrowsecurity from pg_class where oid='public.statistics_seen'::regclass)
  or has_table_privilege('authenticated','public.statistics_seen','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  or has_table_privilege('anon','public.statistics_seen','SELECT,INSERT,UPDATE,DELETE') then raise exception 'unsafe statistics seen grants'; end if;
 if not (select relrowsecurity from pg_class where oid='public.statistics_history_sessions'::regclass)
  or has_table_privilege('authenticated','public.statistics_history_sessions','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  or has_table_privilege('anon','public.statistics_history_sessions','SELECT,INSERT,UPDATE,DELETE') then raise exception 'unsafe history session grants'; end if;
 if has_table_privilege('authenticated','public.statistics_joint_facts','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege('anon','public.statistics_joint_facts','SELECT')
  or not exists(select 1 from pg_class where oid='public.statistics_joint_facts'::regclass and reloptions @> array['security_invoker=true']) then raise exception 'unsafe statistics facts view'; end if;
end $$;
