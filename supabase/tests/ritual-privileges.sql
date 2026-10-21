do $$
declare sig text;fn oid;internal boolean;tab text;
begin
 foreach sig in array array['public.ritual_clock()','public.validate_ritual_terms(jsonb)','public.can_read_ritual(uuid)','public.ritual_context()','public.lock_couple_ritual(uuid)','public.materialize_ritual(uuid)',
 'public.refresh_ritual_instances()','public.create_couple_ritual(uuid,jsonb,integer)','public.propose_ritual_change(uuid,uuid,text,jsonb,integer)','public.resolve_ritual_consent(uuid,text)',
 'public.withdraw_couple_ritual(uuid)','public.complete_ritual_instance(uuid)','public.close_rituals_on_departure()','public.inspect_ritual_request(uuid,uuid)',
 'public.list_couple_rituals(text,jsonb,integer)','public.list_ritual_history(jsonb,integer)','public.get_ritual_summary()'] loop
 fn:=sig::regprocedure;internal:=sig in ('public.ritual_clock()','public.validate_ritual_terms(jsonb)','public.ritual_context()','public.lock_couple_ritual(uuid)','public.materialize_ritual(uuid)','public.close_rituals_on_departure()');
 if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')=internal then raise exception 'invalid ritual grants: %',sig; end if;
 if exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=fn and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC ritual grant'; end if;
 if not exists(select 1 from pg_proc where oid=fn and proconfig @> array['search_path=""']) then raise exception 'unsafe ritual path'; end if;
 if (select prosecdef from pg_proc where oid=fn) <> (sig not in ('public.ritual_clock()','public.validate_ritual_terms(jsonb)','public.ritual_context()')) then raise exception 'wrong ritual security mode'; end if;
 end loop;
 foreach tab in array array['couple_rituals','ritual_consents','ritual_instances','ritual_completions'] loop
 if not(select relrowsecurity from pg_class where oid=('public.'||tab)::regclass)
 or has_table_privilege('authenticated','public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
 or has_table_privilege('anon','public.'||tab,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'unsafe ritual table: %',tab; end if;
 end loop;
end $$;
