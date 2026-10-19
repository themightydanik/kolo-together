do $$
declare sig text; fn oid; internal boolean; tab text;
begin
 foreach sig in array array['public.inspect_goal_request(uuid,uuid)','public.can_read_goal(uuid)','public.can_read_goal_step(uuid)','public.lock_couple_goal(uuid)','public.protect_goal_reward()',
 'public.create_couple_goal(uuid,text,text,text,text,date,integer)','public.propose_goal_change(uuid,uuid,text,jsonb,integer)',
 'public.resolve_goal_consent(uuid,text)','public.complete_goal_step(uuid)','public.close_goals_on_departure()'] loop
  fn:=sig::regprocedure; internal:=sig in ('public.protect_goal_reward()','public.lock_couple_goal(uuid)','public.close_goals_on_departure()');
  if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')=internal then raise exception 'invalid goal grants: %',sig; end if;
  if exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=fn and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC goal grant: %',sig; end if;
  if not exists(select 1 from pg_proc where oid=fn and proconfig @> array['search_path=""']) then raise exception 'unsafe goal path: %',sig; end if;
 end loop;
 foreach tab in array array['couple_goals','goal_consents','goal_steps','goal_step_participants','goal_step_completions','goal_events','goal_reward_ledger'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||tab)::regclass) then raise exception 'missing goal RLS: %',tab; end if;
  if has_table_privilege('authenticated','public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('anon','public.'||tab,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'excess goal grants: %',tab; end if;
 end loop;
 if not exists(select 1 from pg_class where oid='public.goal_progress'::regclass and reloptions @> array['security_invoker=true']) then raise exception 'unsafe progress view'; end if;
 if has_table_privilege('anon','public.goal_progress','SELECT') or has_table_privilege('authenticated','public.goal_progress','INSERT,UPDATE,DELETE') then raise exception 'excess progress grants'; end if;
end $$;
