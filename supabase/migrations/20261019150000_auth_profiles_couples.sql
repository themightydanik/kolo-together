-- No remote execution is performed by this migration file.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  avatar_url text check (avatar_url is null or (char_length(avatar_url) <= 2048 and avatar_url ~ '^https://')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.couple_spaces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.couple_members (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.couple_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seat smallint not null check (seat in (1, 2)),
  joined_at timestamptz not null default now(),
  left_at timestamptz
);
-- These constraints also protect against races independently of application code.
create unique index one_active_space_per_user on public.couple_members(user_id) where left_at is null;
create unique index two_active_seats_per_space on public.couple_members(space_id, seat) where left_at is null;
create index active_space_members on public.couple_members(space_id) where left_at is null;
create table public.couple_invitations (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.couple_spaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  recipient_email text not null check (recipient_email = lower(btrim(recipient_email)) and char_length(recipient_email) between 3 and 254),
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  consumed_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  declined_at timestamptz,
  revoked_at timestamptz,
  check (expires_at > created_at),
  check (num_nonnulls(consumed_at, declined_at, revoked_at) <= 1)
);
create index invitations_by_space on public.couple_invitations(space_id);

alter table public.profiles enable row level security;
alter table public.couple_spaces enable row level security;
alter table public.couple_members enable row level security;
alter table public.couple_invitations enable row level security;

create function public.is_space_member(p_space_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.couple_members where space_id = p_space_id and user_id = auth.uid() and left_at is null);
$$;
create function public.is_partner(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.couple_members me join public.couple_members partner on partner.space_id = me.space_id
    where me.user_id = auth.uid() and partner.user_id = p_user_id and me.left_at is null and partner.left_at is null);
$$;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_partner(id));
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy spaces_read on public.couple_spaces for select to authenticated using (public.is_space_member(id));
create policy members_read on public.couple_members for select to authenticated using (left_at is null and public.is_space_member(space_id));
create policy invitations_read on public.couple_invitations for select to authenticated using (created_by = auth.uid() and public.is_space_member(space_id));

create function public.initialize_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.initialize_profile();
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;
create function public.touch_profile() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := clock_timestamp(); return new; end;
$$;
create trigger profiles_updated before update on public.profiles for each row execute function public.touch_profile();

-- Internal helper: never callable by browser roles.
create function public.require_verified_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    raise exception 'verified_account_required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
create function public.create_couple_space() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user(); v_space uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if exists(select 1 from public.couple_members where user_id = v_uid and left_at is null) then
    raise exception 'already_in_space';
  end if;
  insert into public.couple_spaces default values returning id into v_space;
  insert into public.couple_members(space_id, user_id, seat) values (v_space, v_uid, 1);
  return v_space;
end;
$$;
create function public.create_couple_invitation(p_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user(); v_space uuid; v_token text; v_email text := lower(btrim(p_email));
begin
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'invalid_email'; end if;
  if exists(select 1 from auth.users where id = v_uid and lower(email) = v_email) then raise exception 'cannot_invite_self'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select space_id into v_space from public.couple_members where user_id = v_uid and left_at is null;
  if v_space is null then raise exception 'space_required'; end if;
  perform 1 from public.couple_spaces where id = v_space for update;
  if (select count(*) from public.couple_members where space_id = v_space and left_at is null) >= 2 then raise exception 'space_full'; end if;
  update public.couple_invitations set revoked_at = clock_timestamp() where space_id = v_space and consumed_at is null and declined_at is null and revoked_at is null;
  -- Two independently generated UUIDs provide 244 random bits; only SHA-256 is persisted.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.couple_invitations(space_id, created_by, recipient_email, token_hash)
    values(v_space, v_uid, v_email, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));
  return v_token;
end;
$$;
create function public.inspect_couple_invitation(p_token text)
returns table(space_id uuid, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user();
begin
  if p_token is null or char_length(p_token) <> 64 then return; end if;
  return query select i.space_id, i.expires_at from public.couple_invitations i join auth.users u on u.id = v_uid
    where i.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and lower(u.email) = i.recipient_email
      and i.expires_at > now() and i.consumed_at is null and i.declined_at is null and i.revoked_at is null;
end;
$$;
-- One implementation for accept/decline keeps authorization and lock order identical.
create function public.resolve_couple_invitation(p_token text, p_accept boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user(); v_inv public.couple_invitations; v_space uuid; v_seat smallint;
begin
  if p_token is null or char_length(p_token) <> 64 or p_accept is null then raise exception 'invitation_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select space_id into v_space from public.couple_invitations where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_space is null then raise exception 'invitation_unavailable'; end if;
  perform 1 from public.couple_spaces where id = v_space for update;
  select * into v_inv from public.couple_invitations where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if not found or v_inv.expires_at <= clock_timestamp() or v_inv.consumed_at is not null or v_inv.declined_at is not null or v_inv.revoked_at is not null
     or not exists(select 1 from auth.users where id = v_uid and lower(email) = v_inv.recipient_email) then raise exception 'invitation_unavailable'; end if;
  if not p_accept then
    update public.couple_invitations set declined_at = clock_timestamp() where id = v_inv.id;
    return v_space;
  end if;
  if exists(select 1 from public.couple_members where user_id = v_uid and left_at is null) then raise exception 'already_in_space'; end if;
  if exists(select 1 from public.couple_spaces where id = v_space and archived_at is not null) then raise exception 'invitation_unavailable'; end if;
  select s::smallint into v_seat from generate_series(1, 2) s where not exists(
    select 1 from public.couple_members m where m.space_id = v_space and m.seat = s and m.left_at is null) order by s limit 1;
  if v_seat is null then raise exception 'space_full'; end if;
  insert into public.couple_members(space_id, user_id, seat) values(v_space, v_uid, v_seat);
  update public.couple_invitations set consumed_at = clock_timestamp(), accepted_by = v_uid where id = v_inv.id;
  update public.couple_invitations set revoked_at = clock_timestamp() where space_id = v_space and id <> v_inv.id and consumed_at is null and declined_at is null and revoked_at is null;
  return v_space;
end;
$$;
create function public.leave_couple_space() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_verified_user(); v_space uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select space_id into v_space from public.couple_members where user_id = v_uid and left_at is null;
  if v_space is null then raise exception 'space_required'; end if;
  perform 1 from public.couple_spaces where id = v_space for update;
  update public.couple_members set left_at = clock_timestamp() where user_id = v_uid and space_id = v_space and left_at is null;
  update public.couple_invitations set revoked_at = clock_timestamp() where space_id = v_space and consumed_at is null and declined_at is null and revoked_at is null;
  if not exists(select 1 from public.couple_members where space_id = v_space and left_at is null) then
    update public.couple_spaces set archived_at = clock_timestamp() where id = v_space;
  end if;
end;
$$;

-- No direct INSERT/DELETE and no membership or invitation UPDATE for client roles.
revoke all on public.profiles, public.couple_spaces, public.couple_members, public.couple_invitations from public, anon, authenticated;
grant select on public.profiles, public.couple_spaces, public.couple_members to authenticated;
grant update(display_name, avatar_url) on public.profiles to authenticated;
grant select(id, space_id, created_by, recipient_email, created_at, expires_at, consumed_at, accepted_by, declined_at, revoked_at) on public.couple_invitations to authenticated;
revoke all on function public.is_space_member(uuid), public.is_partner(uuid), public.initialize_profile(), public.touch_profile(), public.require_verified_user(), public.create_couple_space(), public.create_couple_invitation(text), public.inspect_couple_invitation(text), public.resolve_couple_invitation(text, boolean), public.leave_couple_space() from public, anon, authenticated;
grant execute on function public.is_space_member(uuid), public.is_partner(uuid), public.create_couple_space(), public.create_couple_invitation(text), public.inspect_couple_invitation(text), public.resolve_couple_invitation(text, boolean), public.leave_couple_space() to authenticated;
