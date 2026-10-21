-- Voluntary rituals only. No reward/XP/Coins tables or previous migrations change.
begin;
create table public.couple_rituals (
 id uuid primary key default gen_random_uuid(),
 space_id uuid not null references public.couple_spaces(id) on delete cascade,
 creator_id uuid not null references auth.users(id) on delete cascade,
 partner_id uuid not null references auth.users(id) on delete cascade,
 request_id uuid not null, terms jsonb not null,
 status text not null check(status in ('pending','active','paused','closed','declined')),
 version integer not null default 1 check(version>0), starts_on date not null,
 created_at timestamptz not null default clock_timestamp(), closed_at timestamptz,
 unique(creator_id,request_id), unique(id,space_id), check(creator_id<>partner_id)
);
create index rituals_space_state on public.couple_rituals(space_id,status,created_at desc,id desc);
create table public.ritual_consents (
 id uuid primary key default gen_random_uuid(), ritual_id uuid not null references public.couple_rituals(id) on delete cascade,
 requester_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 kind text not null check(kind in ('activate','edit','pause','resume','close')), terms jsonb not null default '{}',
 status text not null default 'pending' check(status in ('pending','accepted','declined','withdrawn','void')),
 created_at timestamptz not null default clock_timestamp(), responded_at timestamptz,
 unique(requester_id,request_id)
);
create unique index one_pending_ritual_consent on public.ritual_consents(ritual_id) where status='pending';
create index ritual_consents_history on public.ritual_consents(ritual_id,requester_id);
create table public.ritual_instances (
 id uuid primary key default gen_random_uuid(), ritual_id uuid not null, space_id uuid not null,
 foreign key(ritual_id,space_id) references public.couple_rituals(id,space_id) on delete cascade,
 period_key text not null, scheduled_on date not null, version integer not null, terms jsonb not null,
 status text not null default 'waiting' check(status in ('waiting','partial','completed','missed')),
 reason text check(reason in ('period_ended','edit','pause','close','withdraw','departure')),
 created_at timestamptz not null default clock_timestamp(), completed_at timestamptz,
 unique(ritual_id,period_key), unique(ritual_id,scheduled_on)
);
create index ritual_instances_history on public.ritual_instances(space_id,scheduled_on desc,id desc);
create index ritual_instances_owner on public.ritual_instances(ritual_id,status,scheduled_on desc);
create table public.ritual_completions (
 instance_id uuid not null references public.ritual_instances(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 completed_at timestamptz not null default clock_timestamp(), primary key(instance_id,user_id)
);
create function public.ritual_clock() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$;
create function public.validate_ritual_terms(p_terms jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare v_title text; v_description text; v_days jsonb; v_n integer;
begin
 if p_terms is null or jsonb_typeof(p_terms)<>'object' or octet_length(p_terms::text)>10000
 or (select count(*) from jsonb_object_keys(p_terms))<>5
 or not(p_terms ?& array['title','description','emoji','cadence','days'])
 or jsonb_typeof(p_terms->'title')<>'string' or jsonb_typeof(p_terms->'description')<>'string'
 or jsonb_typeof(p_terms->'emoji')<>'string' or jsonb_typeof(p_terms->'cadence')<>'string'
 or jsonb_typeof(p_terms->'days')<>'array' then raise exception 'invalid_ritual'; end if;
 v_title:=btrim(p_terms->>'title');v_description:=btrim(p_terms->>'description');
 if char_length(v_title) not between 2 and 100 or char_length(v_description)>1000
 or p_terms->>'emoji' not in ('🌅','📵','💜','🌙','☕','🎁','🌿','🤗','🗓️')
 or p_terms->>'cadence' not in ('daily','weekdays','weekly') then raise exception 'invalid_ritual'; end if;
 v_n:=jsonb_array_length(p_terms->'days');
 if v_n not between 1 and 7 or exists(select 1 from jsonb_array_elements(p_terms->'days') d
   where jsonb_typeof(d)<>'number' or d::text not in ('1','2','3','4','5','6','7'))
 or (select count(distinct d) from jsonb_array_elements(p_terms->'days') d)<>v_n
 or (p_terms->>'cadence'='daily' and v_n<>7) or (p_terms->>'cadence'='weekly' and v_n<>1) then raise exception 'invalid_ritual'; end if;
 select jsonb_agg(d::integer order by d::integer) into v_days from jsonb_array_elements_text(p_terms->'days') d;
 return jsonb_build_object('title',v_title,'description',v_description,'emoji',p_terms->>'emoji','cadence',p_terms->>'cadence','days',v_days);
end $$;
create function public.can_read_ritual(p_ritual_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.couple_rituals r where r.id=p_ritual_id and auth.uid() in (r.creator_id,r.partner_id)
 and public.is_space_member(r.space_id)
 and exists(select 1 from public.couple_members where space_id=r.space_id and user_id=r.creator_id and left_at is null)
 and exists(select 1 from public.couple_members where space_id=r.space_id and user_id=r.partner_id and left_at is null));
$$;
create function public.ritual_context() returns text language sql stable security invoker set search_path='' as $$
 select coalesce(string_agg(id::text,':' order by id),'solo') from public.couple_members where left_at is null and public.is_space_member(space_id);
$$;
create function public.lock_couple_ritual(p_ritual_id uuid) returns public.couple_rituals
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); r public.couple_rituals;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
 select * into r from public.couple_rituals where id=p_ritual_id;
 if not found or not public.can_read_ritual(r.id) then raise exception 'ritual_unavailable'; end if;
 perform 1 from public.couple_spaces where id=r.space_id for update;
 select * into r from public.couple_rituals where id=p_ritual_id for update;
 if not public.can_read_ritual(r.id) then raise exception 'ritual_unavailable'; end if;
 return r;
end $$;
-- Caller holds user -> space -> ritual locks. Only TODAY is inserted, never catch-up.
create function public.materialize_ritual(p_ritual_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.couple_rituals; v_day date:=(public.ritual_clock() at time zone 'UTC')::date; v_key text;
begin
 select * into r from public.couple_rituals where id=p_ritual_id;
 update public.ritual_instances set status='missed',reason='period_ended' where ritual_id=r.id and scheduled_on<v_day and status in ('waiting','partial');
 if r.status<>'active' or r.starts_on>v_day or not public.can_read_ritual(r.id)
 or exists(select 1 from public.ritual_consents where ritual_id=r.id and status='pending')
 or not (r.terms->'days' @> to_jsonb(extract(isodow from v_day)::integer)) then return; end if;
 v_key:=case when r.terms->>'cadence'='weekly' then 'w:'||to_char(date_trunc('week',v_day::timestamp),'YYYY-MM-DD') else 'd:'||to_char(v_day,'YYYY-MM-DD') end;
 insert into public.ritual_instances(ritual_id,space_id,period_key,scheduled_on,version,terms) values(r.id,r.space_id,v_key,v_day,r.version,r.terms) on conflict do nothing;
end $$;
create function public.refresh_ritual_instances() returns date
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_space uuid; r record;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
 select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
 if v_space is not null then
  perform 1 from public.couple_spaces where id=v_space for update;
  for r in select id from public.couple_rituals where space_id=v_space and status in ('active','paused') and public.can_read_ritual(id) order by id for update loop
   perform public.materialize_ritual(r.id);
  end loop;
 end if;
 return (public.ritual_clock() at time zone 'UTC')::date;
end $$;
create function public.create_couple_ritual(p_request_id uuid,p_terms jsonb,p_expected_creations integer default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_terms jsonb:=public.validate_ritual_terms(p_terms); v_space uuid; v_partner uuid; r public.couple_rituals;
begin
 if p_request_id is null then raise exception 'invalid_ritual'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
 select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
 if v_space is null then raise exception 'space_required'; end if;
 perform 1 from public.couple_spaces where id=v_space for update;
 select * into r from public.couple_rituals where creator_id=v_uid and request_id=p_request_id;
 if found then
  -- Compare the original activation payload; editable current terms are not the request identity.
  if r.space_id<>v_space or not public.can_read_ritual(r.id) or not exists(select 1 from public.ritual_consents where ritual_id=r.id and kind='activate' and terms=v_terms) then raise exception 'ritual_request_conflict'; end if;
  return r.id;
 end if;
 if p_expected_creations is null or p_expected_creations<0 or p_expected_creations<>(select count(*) from public.couple_rituals where creator_id=v_uid and space_id=v_space) then raise exception 'ritual_history_changed'; end if;
 select user_id into v_partner from public.couple_members where space_id=v_space and user_id<>v_uid and left_at is null;
 if v_partner is null then raise exception 'partner_required'; end if;
 if (select count(*) from public.couple_rituals where space_id=v_space and status in ('pending','active','paused'))>=50 then raise exception 'ritual_limit'; end if;
 insert into public.couple_rituals(space_id,creator_id,partner_id,request_id,terms,status,starts_on) values(v_space,v_uid,v_partner,p_request_id,v_terms,'pending',(public.ritual_clock() at time zone 'UTC')::date) returning * into r;
 insert into public.ritual_consents(ritual_id,requester_id,request_id,kind,terms) values(r.id,v_uid,p_request_id,'activate',v_terms);
 return r.id;
end $$;
create function public.propose_ritual_change(p_ritual_id uuid,p_request_id uuid,p_kind text,p_terms jsonb default '{}',p_expected_changes integer default 0) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); r public.couple_rituals:=public.lock_couple_ritual(p_ritual_id); c public.ritual_consents; v_terms jsonb;
begin
 if p_request_id is null or p_kind is null or p_kind not in ('edit','pause','resume','close') then raise exception 'invalid_ritual'; end if;
 v_terms:=case when p_kind='edit' then public.validate_ritual_terms(p_terms) else '{}'::jsonb end;
 if p_kind<>'edit' and p_terms is distinct from '{}'::jsonb then raise exception 'invalid_ritual'; end if;
 select * into c from public.ritual_consents where requester_id=v_uid and request_id=p_request_id;
 if found then
  if c.ritual_id<>r.id or c.kind<>p_kind or c.terms<>v_terms then raise exception 'ritual_request_conflict'; end if;
  return c.id;
 end if;
 if p_expected_changes is null or p_expected_changes<0 or p_expected_changes<>(select count(*) from public.ritual_consents where requester_id=v_uid and ritual_id=r.id) then raise exception 'ritual_history_changed'; end if;
 if r.status not in ('active','paused') or (p_kind='pause' and r.status<>'active') or (p_kind='resume' and r.status<>'paused') then raise exception 'ritual_transition_denied'; end if;
 if exists(select 1 from public.ritual_consents where ritual_id=r.id and status='pending') then raise exception 'ritual_consent_pending'; end if;
 insert into public.ritual_consents(ritual_id,requester_id,request_id,kind,terms) values(r.id,v_uid,p_request_id,p_kind,v_terms) returning id into c.id;
 return c.id;
end $$;
create function public.resolve_ritual_consent(p_consent_id uuid,p_decision text) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); r public.couple_rituals; c public.ritual_consents; v_ritual uuid; v_status text; v_day date;
begin
 select ritual_id into v_ritual from public.ritual_consents where id=p_consent_id;
 r:=public.lock_couple_ritual(v_ritual);
 select * into c from public.ritual_consents where id=p_consent_id for update;
 if p_decision is null or p_decision not in ('accept','decline','withdraw') or (p_decision='withdraw')<>(c.requester_id=v_uid) then raise exception 'ritual_transition_denied'; end if;
 v_status:=case p_decision when 'accept' then 'accepted' when 'decline' then 'declined' else 'withdrawn' end;
 if c.status=v_status then return; end if;
 if c.status<>'pending' or r.status in ('closed','declined') then raise exception 'ritual_transition_denied'; end if;
 v_day:=(public.ritual_clock() at time zone 'UTC')::date;
 update public.ritual_consents set status=v_status,responded_at=public.ritual_clock() where id=c.id;
 if c.kind='activate' then
  update public.couple_rituals set status=case p_decision when 'accept' then 'active' when 'decline' then 'declined' else 'closed' end,
    starts_on=v_day,closed_at=case when p_decision<>'accept' then public.ritual_clock() end where id=r.id;
 elsif p_decision='accept' then
  update public.couple_rituals set terms=case when c.kind='edit' then c.terms else terms end,
    version=version+case when c.kind='edit' then 1 else 0 end,
    starts_on=case when c.kind in ('edit','resume') then v_day+1 else starts_on end,
    status=case c.kind when 'pause' then 'paused' when 'resume' then 'active' when 'close' then 'closed' else status end,
    closed_at=case when c.kind='close' then public.ritual_clock() else closed_at end where id=r.id;
  update public.ritual_instances set status='missed',reason=c.kind where ritual_id=r.id and status in ('waiting','partial') and c.kind in ('edit','pause','close');
 end if;
 perform public.materialize_ritual(r.id);
end $$;
create function public.withdraw_couple_ritual(p_ritual_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r public.couple_rituals:=public.lock_couple_ritual(p_ritual_id);
begin
 if r.status in ('closed','declined') then return; end if;
 update public.couple_rituals set status='closed',closed_at=public.ritual_clock() where id=r.id;
 update public.ritual_consents set status='void',responded_at=public.ritual_clock() where ritual_id=r.id and status='pending';
 update public.ritual_instances set status='missed',reason='withdraw' where ritual_id=r.id and status in ('waiting','partial');
end $$;
create function public.complete_ritual_instance(p_instance_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_ritual uuid; r public.couple_rituals; i public.ritual_instances; v_day date;
begin
 select ritual_id into v_ritual from public.ritual_instances where id=p_instance_id;
 r:=public.lock_couple_ritual(v_ritual);
 select * into i from public.ritual_instances where id=p_instance_id for update;
 -- Existing marks may be acknowledged after a terminal transition; never write.
 if exists(select 1 from public.ritual_completions where instance_id=i.id and user_id=v_uid) then return; end if;
 v_day:=(public.ritual_clock() at time zone 'UTC')::date;
 if r.status<>'active' or i.status not in ('waiting','partial') or i.scheduled_on<>v_day or i.version<>r.version
   or exists(select 1 from public.ritual_consents where ritual_id=r.id and status='pending') then raise exception 'ritual_period_unavailable'; end if;
 insert into public.ritual_completions(instance_id,user_id) values(i.id,v_uid);
 update public.ritual_instances set status=case when (select count(*) from public.ritual_completions where instance_id=i.id)=2 then 'completed' else 'partial' end,
 completed_at=case when (select count(*) from public.ritual_completions where instance_id=i.id)=2 then public.ritual_clock() end where id=i.id;
end $$;
create function public.close_rituals_on_departure() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.left_at is null and new.left_at is not null then
  perform 1 from public.couple_spaces where id=old.space_id for update;
  update public.couple_rituals set status='closed',closed_at=clock_timestamp() where space_id=old.space_id and old.user_id in (creator_id,partner_id) and status in ('pending','active','paused');
  update public.ritual_consents c set status='void',responded_at=clock_timestamp() from public.couple_rituals r where c.ritual_id=r.id and r.space_id=old.space_id and r.status='closed' and c.status='pending';
  update public.ritual_instances i set status='missed',reason='departure' from public.couple_rituals r where i.ritual_id=r.id and r.space_id=old.space_id and r.status='closed' and i.status in ('waiting','partial');
 end if;
 return new;
end $$;
create trigger rituals_member_departure after update of left_at on public.couple_members for each row execute function public.close_rituals_on_departure();
create function public.inspect_ritual_request(p_request_id uuid,p_ritual_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_result jsonb;
begin
 if p_ritual_id is null then
  select jsonb_build_object('id',r.id,'status',r.status) into v_result from public.couple_rituals r where creator_id=v_uid and request_id=p_request_id and public.can_read_ritual(r.id);
 else
  select jsonb_build_object('id',c.id,'status',c.status) into v_result from public.ritual_consents c where ritual_id=p_ritual_id and requester_id=v_uid and request_id=p_request_id and public.can_read_ritual(c.ritual_id);
 end if;
 return v_result;
end $$;
-- Both lists use bounded live keyset pages; cursors never grant access.
create function public.list_couple_rituals(p_filter text default 'active',p_cursor jsonb default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user(); v_context text:=public.ritual_context(); v_day date:=(public.ritual_clock() at time zone 'UTC')::date;
 v_space uuid; v_until timestamptz:=statement_timestamp(); v_at timestamptz; v_id uuid; v_rows jsonb; v_last jsonb; v_next jsonb;
begin
 if p_filter is null or p_filter not in ('active','pending','paused','closed','today') or p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid_ritual_cursor'; end if;
 select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
 if p_cursor is not null then
  begin
   if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or not(p_cursor ?& array['actor','context','filter','at','id','until'])
   or (select count(*) from jsonb_object_keys(p_cursor))<>6 or p_cursor->>'actor' is distinct from v_uid::text
   or p_cursor->>'context' is distinct from v_context or p_cursor->>'filter' is distinct from p_filter
   or jsonb_typeof(p_cursor->'at')<>'string' or jsonb_typeof(p_cursor->'id')<>'string' or jsonb_typeof(p_cursor->'until')<>'string' then raise exception 'invalid_ritual_cursor'; end if;
   v_at:=(p_cursor->>'at')::timestamptz;v_id:=(p_cursor->>'id')::uuid;v_until:=(p_cursor->>'until')::timestamptz;
   if not isfinite(v_at) or not isfinite(v_until) or v_at>v_until or v_until>statement_timestamp() then raise exception 'invalid_ritual_cursor'; end if;
  exception when others then raise exception 'invalid_ritual_cursor'; end;
 end if;
 with page as (
  select r.* from public.couple_rituals r where r.space_id=v_space and public.can_read_ritual(r.id) and r.created_at<=v_until
   and (v_at is null or (r.created_at,r.id)<(v_at,v_id)) and
   case p_filter when 'pending' then exists(select 1 from public.ritual_consents where ritual_id=r.id and status='pending')
    when 'closed' then r.status in ('closed','declined')
    when 'today' then r.status='active' and exists(select 1 from public.ritual_instances where ritual_id=r.id and scheduled_on=v_day)
    else r.status=p_filter end order by r.created_at desc,r.id desc limit p_limit+1
 ), projected as (
  select to_jsonb(r)||jsonb_build_object(
   'pending',(select to_jsonb(c) from public.ritual_consents c where ritual_id=r.id and c.status='pending'),
   'request_version',(select count(*) from public.ritual_consents where ritual_id=r.id and requester_id=v_uid),
   'instance',(select to_jsonb(i)||jsonb_build_object('marks',coalesce((select jsonb_agg(user_id order by user_id) from public.ritual_completions where instance_id=i.id),'[]'::jsonb)) from public.ritual_instances i where ritual_id=r.id and scheduled_on=v_day)
  ) as value,r.created_at,r.id from page r
 ) select coalesce(jsonb_agg(value order by created_at desc,id desc),'[]'::jsonb) into v_rows from projected;
 if jsonb_array_length(v_rows)>p_limit then
  v_rows:=v_rows-p_limit;v_last:=v_rows->(p_limit-1);
  v_next:=jsonb_build_object('actor',v_uid,'context',v_context,'filter',p_filter,'at',v_last->>'created_at','id',v_last->>'id','until',v_until);
 end if;
 return jsonb_build_object('rituals',v_rows,'next_cursor',v_next,'context',v_context,'today',v_day,'space_id',v_space,
  'partner_connected',(select count(*)=2 from public.couple_members where space_id=v_space and left_at is null),
  'create_version',(select count(*) from public.couple_rituals where space_id=v_space and creator_id=v_uid));
end $$;
create function public.list_ritual_history(p_cursor jsonb default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user();v_context text:=public.ritual_context();v_until timestamptz:=statement_timestamp();v_space uuid;v_day date;v_id uuid;v_rows jsonb;v_last jsonb;v_next jsonb;
begin
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'invalid_ritual_cursor'; end if;
 select space_id into v_space from public.couple_members where user_id=v_uid and left_at is null;
 if p_cursor is not null then
  begin
   if jsonb_typeof(p_cursor)<>'object' or octet_length(p_cursor::text)>2048 or not(p_cursor ?& array['actor','context','day','id','until'])
    or (select count(*) from jsonb_object_keys(p_cursor))<>5 or p_cursor->>'actor' is distinct from v_uid::text or p_cursor->>'context' is distinct from v_context
    or jsonb_typeof(p_cursor->'day')<>'string' or jsonb_typeof(p_cursor->'id')<>'string' or jsonb_typeof(p_cursor->'until')<>'string' then raise exception 'invalid_ritual_cursor'; end if;
   v_day:=(p_cursor->>'day')::date;v_id:=(p_cursor->>'id')::uuid;v_until:=(p_cursor->>'until')::timestamptz;
   if not isfinite(v_day) or not isfinite(v_until) or v_until>statement_timestamp() then raise exception 'invalid_ritual_cursor'; end if;
  exception when others then raise exception 'invalid_ritual_cursor'; end;
 end if;
 with page as (
  select i.* from public.ritual_instances i where i.space_id=v_space and public.can_read_ritual(i.ritual_id) and i.status in ('completed','missed') and i.created_at<=v_until
   and (v_day is null or (i.scheduled_on,i.id)<(v_day,v_id)) order by i.scheduled_on desc,i.id desc limit p_limit+1
 ) select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('marks',(select count(*) from public.ritual_completions where instance_id=i.id)) order by scheduled_on desc,id desc),'[]'::jsonb) into v_rows from page i;
 if jsonb_array_length(v_rows)>p_limit then
  v_rows:=v_rows-p_limit;v_last:=v_rows->(p_limit-1);
  v_next:=jsonb_build_object('actor',v_uid,'context',v_context,'day',v_last->>'scheduled_on','id',v_last->>'id','until',v_until);
 end if;
 return jsonb_build_object('items',v_rows,'next_cursor',v_next,'context',v_context);
end $$;
create function public.get_ritual_summary() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_uid uuid:=public.require_verified_user();v_day date:=(public.ritual_clock() at time zone 'UTC')::date;v_result jsonb;
begin
 with days as(select v_day-i as day from generate_series(0,29) i), facts as materialized (
  select i.scheduled_on,i.status from public.ritual_instances i where i.space_id=(select space_id from public.couple_members where user_id=v_uid and left_at is null) and public.can_read_ritual(i.ritual_id)
 ) select jsonb_build_object('context',public.ritual_context(),'timezone','UTC',
  'completed',(select count(*) from facts where status='completed'),
  'calendar',(select jsonb_agg(jsonb_build_object('day',d.day,'completed',(select count(*) from facts f where f.scheduled_on=d.day and f.status='completed')) order by d.day) from days d)) into v_result;
 return v_result;
end $$;

alter table public.couple_rituals enable row level security;
alter table public.ritual_consents enable row level security;
alter table public.ritual_instances enable row level security;
alter table public.ritual_completions enable row level security;
create policy rituals_read on public.couple_rituals for select to authenticated using(public.can_read_ritual(id));
create policy ritual_consents_read on public.ritual_consents for select to authenticated using(public.can_read_ritual(ritual_id));
create policy ritual_instances_read on public.ritual_instances for select to authenticated using(public.can_read_ritual(ritual_id));
create policy ritual_completions_read on public.ritual_completions for select to authenticated using(exists(select 1 from public.ritual_instances i where i.id=instance_id and public.can_read_ritual(i.ritual_id)));
revoke all on public.couple_rituals,public.ritual_consents,public.ritual_instances,public.ritual_completions from public,anon,authenticated;
grant select on public.couple_rituals,public.ritual_consents,public.ritual_instances,public.ritual_completions to authenticated;
revoke all on function public.ritual_clock(),public.validate_ritual_terms(jsonb),public.can_read_ritual(uuid),public.ritual_context(),public.lock_couple_ritual(uuid),public.materialize_ritual(uuid),
 public.refresh_ritual_instances(),public.create_couple_ritual(uuid,jsonb,integer),public.propose_ritual_change(uuid,uuid,text,jsonb,integer),public.resolve_ritual_consent(uuid,text),
 public.withdraw_couple_ritual(uuid),public.complete_ritual_instance(uuid),public.close_rituals_on_departure(),public.inspect_ritual_request(uuid,uuid),public.list_couple_rituals(text,jsonb,integer),public.list_ritual_history(jsonb,integer),public.get_ritual_summary() from public,anon,authenticated;
grant execute on function public.can_read_ritual(uuid),public.refresh_ritual_instances(),public.create_couple_ritual(uuid,jsonb,integer),public.propose_ritual_change(uuid,uuid,text,jsonb,integer),
 public.resolve_ritual_consent(uuid,text),public.withdraw_couple_ritual(uuid),public.complete_ritual_instance(uuid),public.inspect_ritual_request(uuid,uuid),public.list_couple_rituals(text,jsonb,integer),public.list_ritual_history(jsonb,integer),public.get_ritual_summary() to authenticated;
commit;
