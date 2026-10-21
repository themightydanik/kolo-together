-- Read-only effective privilege audit; also runs against real Supabase roles.
do $$
declare t text; f record; granted boolean; expected boolean;
begin
 foreach t in array array['connection_catalog','connection_moods','connection_reactions','connection_sessions','connection_answers','connection_deck','connection_draws','connection_events','connection_requests'] loop
  if not(select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS absent: %',t; end if;
  if has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'anon table grant: %',t; end if;
  if has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'client write grant: %',t; end if;
  expected:=t in ('connection_catalog','connection_moods','connection_reactions','connection_sessions','connection_answers','connection_events');
  if has_table_privilege('authenticated','public.'||t,'SELECT')<>expected then raise exception 'unexpected SELECT: %',t; end if;
 end loop;
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'connection_%' loop
  expected:=f.proname in ('connection_action','connection_read','connection_access','connection_mood_access','connection_answer_access');
  if has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')<>expected then raise exception 'unexpected function grant: %',f.proname; end if;
  if not coalesce(f.proconfig @> array['search_path=""'],false) then raise exception 'unsafe search path: %',f.proname; end if;
  if f.prosecdef<>(f.proname<>'connection_clock') then raise exception 'unexpected execution context: %',f.proname; end if;
 end loop;
end $$;
