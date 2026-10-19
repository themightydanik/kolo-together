-- Local file only: never applied to a remote project by application/setup code.
begin;
-- Serialize the historical backfill with task earning transactions.
lock table public.reward_ledger, public.user_progress in share row exclusive mode;
create table public.reward_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  space_id uuid not null references public.couple_spaces(id) on delete cascade,
  creator_id uuid not null references auth.users(id) on delete cascade,
  partner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check(char_length(title) between 2 and 100),
  description text not null default '' check(char_length(description)<=1000),
  kind text not null check(kind in ('partner','joint')),
  category text not null check(category in ('care','romance','rest','fun','time','other')),
  emoji text not null check(emoji in ('🎁','☕','❤️','🎬','🌿','🎲')),
  price integer not null check(price between 1 and 100000),
  single_use boolean not null,
  status text not null check(status in ('pending','active','paused','declined','closed')),
  created_at timestamptz not null default clock_timestamp(),
  unique(creator_id,request_id), check(creator_id<>partner_id)
);
create table public.reward_offer_consents (
  offer_id uuid not null references public.reward_offers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  consent text not null check(consent in ('pending','accepted','declined')),
  responded_at timestamptz,
  primary key(offer_id,user_id)
);
create table public.reward_purchases (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  offer_id uuid not null references public.reward_offers(id) on delete cascade,
  space_id uuid not null references public.couple_spaces(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  emoji text not null,
  kind text not null check(kind in ('partner','joint')),
  price integer not null check(price between 1 and 100000),
  single_use boolean not null,
  status text not null default 'pending' check(status in ('pending','ready','completed','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  unique(buyer_id,request_id), check(buyer_id<>provider_id)
);
-- Lifetime single use, including refunded purchases. Re-offer via a new consent.
create unique index one_purchase_per_single_offer on public.reward_purchases(offer_id) where single_use;
create index reward_offers_space on public.reward_offers(space_id,created_at desc,id);
create index reward_purchases_offer on public.reward_purchases(offer_id,id);
create index reward_purchases_buyer on public.reward_purchases(buyer_id,status);
create table public.coin_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in ('earn','spend','refund')),
  amount integer not null check(amount>0),
  reward_ledger_id uuid unique references public.reward_ledger(id) on delete cascade,
  purchase_id uuid references public.reward_purchases(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  unique(purchase_id,kind),
  check((kind='earn' and reward_ledger_id is not null and purchase_id is null)
     or (kind in ('spend','refund') and reward_ledger_id is null and purchase_id is not null))
);
create index coin_transactions_owner on public.coin_transactions(user_id,created_at desc,id);
-- No second credit: mirror historical earnings without modifying user_progress.
do $$ begin
  if exists(select 1 from public.reward_ledger where kind='personal' and (coins<0 or user_id is null)) then
    raise exception 'coin_history_mismatch';
  end if;
  if exists(
    select 1 from public.user_progress p full join
      (select user_id,sum(coins) as earned from public.reward_ledger where kind='personal' group by user_id) l
      on l.user_id=p.user_id
    where (p.user_id is null and l.earned<>0) or (p.user_id is not null and p.coins<>coalesce(l.earned,0))
  ) then raise exception 'coin_history_mismatch'; end if;
end $$;
-- Zero-value legacy facts carry no Coins; preserve them in reward_ledger, not
-- as invalid positive-only coin transactions. Together XP never mirrors earn.
insert into public.coin_transactions(user_id,kind,amount,reward_ledger_id,created_at)
  select user_id,'earn',coins,id,created_at from public.reward_ledger where kind='personal' and coins>0;
create function public.record_coin_earning() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.kind='personal' and new.coins>0 then
    insert into public.coin_transactions(user_id,kind,amount,reward_ledger_id)
      values(new.user_id,'earn',new.coins,new.id);
  end if;
  return new;
end $$;
create trigger coin_earning after insert on public.reward_ledger for each row execute function public.record_coin_earning();
-- Reserve refund headroom. Otherwise earning up to the integer ceiling after a
-- spend could make an unconditional refund (including departure) impossible.
create function public.check_coin_refund_capacity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.coins + coalesce((select sum(price) from public.reward_purchases
    where buyer_id=new.user_id and status in ('pending','ready')),0)>9007199254740991 then
    raise exception 'coin_capacity_exceeded';
  end if;
  return new;
end $$;
create trigger coin_refund_capacity before insert or update on public.user_progress
for each row execute function public.check_coin_refund_capacity();

create function public.can_read_reward_offer(p_offer_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.reward_offers o where o.id=p_offer_id
    and public.is_space_member(o.space_id) and auth.uid() in (o.creator_id,o.partner_id));
$$;
create function public.create_reward_offer(p_request_id uuid,p_title text,p_description text,p_kind text,
  p_category text,p_emoji text,p_price integer,p_single_use boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_space uuid; v_partner uuid; v_id uuid; old public.reward_offers;
  v_title text:=btrim(p_title); v_description text:=btrim(coalesce(p_description,''));
begin
  if p_request_id is null or v_title is null or char_length(v_title) not between 2 and 100
    or char_length(v_description)>1000 or p_kind is null or p_kind not in ('partner','joint')
    or p_category is null or p_category not in ('care','romance','rest','fun','time','other')
    or p_emoji is null or p_emoji not in ('🎁','☕','❤️','🎬','🌿','🎲')
    or p_price is null or p_price not between 1 and 100000 or p_single_use is null then raise exception 'invalid_reward_offer'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
  if v_space is null then raise exception 'space_required'; end if;
  perform 1 from public.couple_spaces where id=v_space for update;
  select * into old from public.reward_offers where creator_id=v_uid and request_id=p_request_id;
  if found then
    if old.space_id<>v_space or (old.title,old.description,old.kind,old.category,old.emoji,old.price,old.single_use)
      is distinct from (v_title,v_description,p_kind,p_category,p_emoji,p_price,p_single_use) then raise exception 'reward_request_conflict'; end if;
    return old.id;
  end if;
  select user_id into v_partner from public.couple_members where space_id=v_space and user_id<>v_uid and left_at is null;
  if v_partner is null then raise exception 'partner_required'; end if;
  insert into public.reward_offers(request_id,space_id,creator_id,partner_id,title,description,kind,category,emoji,price,single_use,status)
    values(p_request_id,v_space,v_uid,v_partner,v_title,v_description,p_kind,p_category,p_emoji,p_price,p_single_use,
      case when p_kind='joint' then 'pending' else 'active' end) returning id into v_id;
  insert into public.reward_offer_consents values(v_id,v_uid,'accepted',clock_timestamp());
  if p_kind='joint' then insert into public.reward_offer_consents values(v_id,v_partner,'pending',null); end if;
  return v_id;
end $$;
create function public.respond_reward_offer(p_offer_id uuid,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); o public.reward_offers; v_consent text;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into o from public.reward_offers where id=p_offer_id;
  if not found or not public.can_read_reward_offer(o.id) then raise exception 'reward_unavailable'; end if;
  perform 1 from public.couple_spaces where id=o.space_id for update;
  select * into o from public.reward_offers where id=p_offer_id for update;
  if not public.can_read_reward_offer(o.id) or o.partner_id<>v_uid or o.kind<>'joint' or p_accept is null then raise exception 'reward_transition_denied'; end if;
  select consent into v_consent from public.reward_offer_consents where offer_id=o.id and user_id=v_uid;
  if v_consent=(case when p_accept then 'accepted' else 'declined' end) and o.status in ('active','paused','declined') then return; end if;
  if o.status<>'pending' or v_consent is distinct from 'pending' then raise exception 'reward_transition_denied'; end if;
  update public.reward_offer_consents set consent=case when p_accept then 'accepted' else 'declined' end,responded_at=clock_timestamp() where offer_id=o.id and user_id=v_uid;
  update public.reward_offers set status=case when p_accept then 'active' else 'declined' end where id=o.id;
end $$;
create function public.set_reward_offer_published(p_offer_id uuid,p_published boolean) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); o public.reward_offers;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into o from public.reward_offers where id=p_offer_id;
  if not found or not public.can_read_reward_offer(o.id) then raise exception 'reward_unavailable'; end if;
  perform 1 from public.couple_spaces where id=o.space_id for update;
  select * into o from public.reward_offers where id=p_offer_id for update;
  if not public.can_read_reward_offer(o.id) or o.creator_id<>v_uid or p_published is null or o.status not in ('active','paused') then raise exception 'reward_transition_denied'; end if;
  update public.reward_offers set status=case when p_published then 'active' else 'paused' end where id=o.id;
end $$;
create function public.buy_reward_offer(p_offer_id uuid,p_request_id uuid,p_expected_purchases integer default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); o public.reward_offers; old public.reward_purchases; v_id uuid; v_balance bigint;
begin
  if p_request_id is null then raise exception 'invalid_reward_offer'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into o from public.reward_offers where id=p_offer_id;
  if not found or not public.can_read_reward_offer(o.id) then raise exception 'reward_unavailable'; end if;
  perform 1 from public.couple_spaces where id=o.space_id for update;
  select * into o from public.reward_offers where id=p_offer_id for update;
  if not public.can_read_reward_offer(o.id) then raise exception 'reward_unavailable'; end if;
  select * into old from public.reward_purchases where buyer_id=v_uid and request_id=p_request_id;
  if found then
    if old.offer_id<>o.id then raise exception 'reward_request_conflict'; end if;
    return old.id;
  end if;
  -- A fresh key must acknowledge the current purchase history. This catches
  -- stale tabs, lost storage and retries with a replacement UUID, even if an
  -- earlier purchase has already completed/cancelled. Same-key replay above
  -- remains valid regardless of this optimistic concurrency fence.
  if p_expected_purchases is null or p_expected_purchases<0 or p_expected_purchases<>(
    select count(*) from public.reward_purchases where offer_id=o.id and buyer_id=v_uid
  ) then raise exception 'reward_purchase_changed'; end if;
  if o.status<>'active' or (o.kind='partner' and v_uid=o.creator_id)
    or (select count(*) from public.couple_members where space_id=o.space_id and left_at is null and user_id in (o.creator_id,o.partner_id))<>2
    or (o.kind='joint' and (select count(*) from public.reward_offer_consents where offer_id=o.id and consent='accepted')<>2)
    then raise exception 'reward_unavailable'; end if;
  if o.single_use and exists(select 1 from public.reward_purchases where offer_id=o.id) then raise exception 'reward_sold_out'; end if;
  select coins into v_balance from public.user_progress where user_id=v_uid for update;
  if coalesce(v_balance,0)<o.price then raise exception 'insufficient_coins'; end if;
  insert into public.reward_purchases(request_id,offer_id,space_id,buyer_id,provider_id,title,description,emoji,kind,price,single_use)
    values(p_request_id,o.id,o.space_id,v_uid,case when v_uid=o.creator_id then o.partner_id else o.creator_id end,o.title,o.description,o.emoji,o.kind,o.price,o.single_use)
    returning id into v_id;
  insert into public.coin_transactions(user_id,kind,amount,purchase_id) values(v_uid,'spend',o.price,v_id);
  update public.user_progress set coins=coins-o.price where user_id=v_uid;
  return v_id;
end $$;
-- Internal helper. Caller holds space -> offer -> purchase locks. Never locks
-- another user's advisory lock after a space lock (would deadlock with leave).
create function public.refund_reward_purchase(p_purchase_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.reward_purchases;
begin
  update public.reward_purchases set status='cancelled',resolved_at=clock_timestamp()
    where id=p_purchase_id and status in ('pending','ready') returning * into p;
  if not found then return; end if;
  insert into public.coin_transactions(user_id,kind,amount,purchase_id) values(p.buyer_id,'refund',p.price,p.id);
  update public.user_progress set coins=coins+p.price where user_id=p.buyer_id;
end $$;
create function public.act_reward_purchase(p_purchase_id uuid,p_action text) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); p public.reward_purchases;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select * into p from public.reward_purchases where id=p_purchase_id;
  if not found or not public.is_space_member(p.space_id) or v_uid not in (p.buyer_id,p.provider_id) then raise exception 'reward_unavailable'; end if;
  perform 1 from public.couple_spaces where id=p.space_id for update;
  perform 1 from public.reward_offers where id=p.offer_id for update;
  select * into p from public.reward_purchases where id=p_purchase_id for update;
  if not public.is_space_member(p.space_id) then raise exception 'reward_unavailable'; end if;
  if p_action in ('cancel','confirm') then
    if v_uid<>p.buyer_id then raise exception 'reward_transition_denied'; end if;
  elsif p_action in ('ready','refuse') then
    if v_uid<>p.provider_id then raise exception 'reward_transition_denied'; end if;
  else raise exception 'reward_transition_denied'; end if;
  if p_action in ('cancel','refuse') then
    if p.status='completed' then raise exception 'reward_transition_denied'; end if;
    perform public.refund_reward_purchase(p.id);
  elsif p_action='ready' then
    if p.status='ready' then return; end if;
    if p.status<>'pending' then raise exception 'reward_transition_denied'; end if;
    update public.reward_purchases set status='ready' where id=p.id;
  else
    if p.status='completed' then return; end if;
    if p.status<>'ready' then raise exception 'reward_transition_denied'; end if;
    update public.reward_purchases set status='completed',resolved_at=clock_timestamp() where id=p.id;
  end if;
end $$;
create function public.close_rewards_on_departure() returns trigger
language plpgsql security definer set search_path='' as $$
declare o record; p record;
begin
  if old.left_at is null and new.left_at is not null then
    perform 1 from public.couple_spaces where id=old.space_id for update;
    for o in select id from public.reward_offers where space_id=old.space_id and old.user_id in (creator_id,partner_id) order by id for update loop
      update public.reward_offers set status='closed' where id=o.id and status in ('pending','active','paused');
      for p in select id from public.reward_purchases where offer_id=o.id and status in ('pending','ready') order by id for update loop
        perform public.refund_reward_purchase(p.id);
      end loop;
    end loop;
  end if;
  return new;
end $$;
create trigger rewards_member_departure after update of left_at on public.couple_members
for each row execute function public.close_rewards_on_departure();

create function public.get_coin_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_result jsonb;
begin
  select jsonb_build_object('balance',coalesce((select coins from public.user_progress where user_id=v_uid),0),
    'earned',coalesce(sum(amount) filter(where kind='earn'),0)::text,
    'spent',coalesce(sum(amount) filter(where kind='spend'),0)::text,
    'refunded',coalesce(sum(amount) filter(where kind='refund'),0)::text) into v_result
    from public.coin_transactions where user_id=v_uid;
  return v_result;
end $$;

alter table public.reward_offers enable row level security;
alter table public.reward_offer_consents enable row level security;
alter table public.reward_purchases enable row level security;
alter table public.coin_transactions enable row level security;
create policy offers_read on public.reward_offers for select to authenticated using(public.can_read_reward_offer(id));
create policy offer_consents_read on public.reward_offer_consents for select to authenticated using(public.can_read_reward_offer(offer_id));
create policy purchases_read on public.reward_purchases for select to authenticated
  using(public.is_space_member(space_id) and auth.uid() in (buyer_id,provider_id));
-- Own accounting remains visible after departure. No partner's private history,
-- title or IDs of other actors are included in this journal.
create policy coins_read on public.coin_transactions for select to authenticated using(user_id=auth.uid());
revoke all on public.reward_offers,public.reward_offer_consents,public.reward_purchases,public.coin_transactions from public,anon,authenticated;
grant select on public.reward_offers,public.reward_offer_consents,public.reward_purchases,public.coin_transactions to authenticated;
revoke all on function public.get_coin_summary(),public.record_coin_earning(),public.check_coin_refund_capacity(),public.can_read_reward_offer(uuid),
 public.create_reward_offer(uuid,text,text,text,text,text,integer,boolean),public.respond_reward_offer(uuid,boolean),
 public.set_reward_offer_published(uuid,boolean),public.buy_reward_offer(uuid,uuid,integer),public.refund_reward_purchase(uuid),
 public.act_reward_purchase(uuid,text),public.close_rewards_on_departure() from public,anon,authenticated;
grant execute on function public.get_coin_summary(),public.can_read_reward_offer(uuid),public.create_reward_offer(uuid,text,text,text,text,text,integer,boolean),
 public.respond_reward_offer(uuid,boolean),public.set_reward_offer_published(uuid,boolean),public.buy_reward_offer(uuid,uuid,integer),
 public.act_reward_purchase(uuid,text) to authenticated;
commit;
