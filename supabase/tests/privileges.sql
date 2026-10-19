-- Read-only assertions: run after migrations on PostgreSQL OR real local Supabase.
do $$
declare
  v_signature text;
  v_auth boolean;
  v_oid oid;
begin
  foreach v_signature in array array[
    'public.initialize_profile()', 'public.touch_profile()', 'public.require_verified_user()',
    'public.is_space_member(uuid)', 'public.is_partner(uuid)',
    'public.create_couple_space()', 'public.create_couple_invitation(text)',
    'public.inspect_couple_invitation(text)', 'public.resolve_couple_invitation(text,boolean)',
    'public.leave_couple_space()'
  ] loop
    v_oid := v_signature::regprocedure;
    v_auth := v_signature not in ('public.initialize_profile()', 'public.touch_profile()', 'public.require_verified_user()');
    if has_function_privilege('anon',v_oid,'EXECUTE') then raise exception 'anon EXECUTE unexpectedly granted: %',v_signature; end if;
    if has_function_privilege('authenticated',v_oid,'EXECUTE') <> v_auth then raise exception 'incorrect authenticated EXECUTE: %',v_signature; end if;
    if exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
              where p.oid=v_oid and acl.grantee=0 and acl.privilege_type='EXECUTE') then
      raise exception 'PUBLIC EXECUTE unexpectedly granted: %',v_signature;
    end if;
    if not exists(select 1 from pg_proc where oid=v_oid and proconfig @> array['search_path=""']) then
      raise exception 'search_path not fixed: %',v_signature;
    end if;
    if v_signature <> 'public.touch_profile()' and not (select prosecdef from pg_proc where oid=v_oid) then
      raise exception 'expected SECURITY DEFINER: %',v_signature;
    end if;
  end loop;
  if exists(select 1 from pg_roles where rolname in ('anon','authenticated') and (rolsuper or rolbypassrls)) then
    raise exception 'client role bypasses RLS';
  end if;
  foreach v_signature in array array['profiles','couple_spaces','couple_members','couple_invitations'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||v_signature)::regclass) then
      raise exception 'RLS disabled: %',v_signature;
    end if;
    if has_table_privilege('authenticated','public.'||v_signature,'INSERT,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception 'excessive authenticated table grants: %',v_signature;
    end if;
  end loop;
end;
$$;
