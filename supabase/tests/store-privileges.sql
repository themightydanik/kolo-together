do $$
declare sig text; fn oid; internal boolean; tab text;
begin
  foreach sig in array array['public.get_coin_summary()','public.record_coin_earning()','public.check_coin_refund_capacity()',
    'public.can_read_reward_offer(uuid)','public.create_reward_offer(uuid,text,text,text,text,text,integer,boolean)',
    'public.respond_reward_offer(uuid,boolean)','public.set_reward_offer_published(uuid,boolean)',
    'public.buy_reward_offer(uuid,uuid)','public.refund_reward_purchase(uuid)',
    'public.act_reward_purchase(uuid,text)','public.close_rewards_on_departure()'] loop
    fn:=sig::regprocedure;
    internal:=sig in ('public.record_coin_earning()','public.check_coin_refund_capacity()',
      'public.refund_reward_purchase(uuid)','public.close_rewards_on_departure()');
    if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE')=internal then raise exception 'invalid store grants: %',sig; end if;
    if exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=fn and a.grantee=0 and a.privilege_type='EXECUTE') then raise exception 'PUBLIC store grants: %',sig; end if;
    if not exists(select 1 from pg_proc where oid=fn and proconfig @> array['search_path=""']) then raise exception 'unsafe store path: %',sig; end if;
  end loop;
  foreach tab in array array['reward_offers','reward_offer_consents','reward_purchases','coin_transactions'] loop
    if not (select relrowsecurity from pg_class where oid=('public.'||tab)::regclass) then raise exception 'missing RLS: %',tab; end if;
    if has_table_privilege('authenticated','public.'||tab,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_table_privilege('anon','public.'||tab,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'excess store grants: %',tab; end if;
  end loop;
end $$;
