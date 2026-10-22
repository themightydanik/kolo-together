-- Couple album, independent of notifications and all economic journals.
begin;
create table public.couple_memories(
 id uuid primary key default gen_random_uuid(),space_id uuid not null references public.couple_spaces on delete cascade,
 author_id uuid not null references auth.users on delete cascade,am uuid not null references public.couple_members on delete cascade,bm uuid not null references public.couple_members on delete cascade,
 title text not null default '' check(char_length(title)<=120),event_date date not null default (clock_timestamp() at time zone 'UTC')::date,
 story text not null default '' check(char_length(story)<=5000),category text check(category in ('date','travel','joy','milestone','other')),
 status text not null default 'draft' check(status in ('draft','published','withdrawn','deleted')),
 version integer not null default 1,source_kind text check(source_kind in ('task','goal','ritual','achievement')),source_key text,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),check(am<>bm),check((source_kind is null)=(source_key is null))
);
create unique index memory_source_once on public.couple_memories(space_id,least(am,bm),greatest(am,bm),source_kind,source_key) where source_kind is not null;
create index memories_album on public.couple_memories(space_id,event_date desc,id desc);
create table public.memory_notes(memory_id uuid references public.couple_memories on delete cascade,user_id uuid references auth.users on delete cascade,
 body text not null check(char_length(body)<=3000),version integer not null default 1,created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(memory_id,user_id));
create table public.memory_photos(
 id uuid primary key default gen_random_uuid(),memory_id uuid not null references public.couple_memories on delete cascade,author_id uuid not null references auth.users on delete cascade,
 path text not null unique default gen_random_uuid()::text||'/'||gen_random_uuid()::text||'.jpg',
 mime text not null check(mime in ('image/jpeg','image/png','image/webp')),bytes integer not null check(bytes between 1 and 5242880),digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 state text not null default 'reserved' check(state in ('reserved','ready','deleting')),position integer check(position between 1 and 5),created_at timestamptz not null default clock_timestamp(),
 check(position is null or state='ready'),unique(memory_id,position) deferrable initially deferred
);
create table public.memory_requests(user_id uuid references auth.users on delete cascade,request_id uuid not null,intent text not null,result jsonb not null,primary key(user_id,request_id));
create table public.memory_cursors(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,context text not null,category text,ceiling timestamptz not null,last_day date not null,last_id uuid not null,expires_at timestamptz not null default clock_timestamp()+interval '30 minutes');
create index memory_photo_cleanup on public.memory_photos(author_id,state,created_at);

create function public.memory_epoch(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.couple_memories m join public.couple_members a on a.id=m.am and a.space_id=m.space_id join public.couple_members b on b.id=m.bm and b.space_id=m.space_id
 where m.id=p_id and a.left_at is null and b.left_at is null and auth.uid() in(a.user_id,b.user_id));
$$;
create function public.memory_visible(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.couple_memories m where m.id=p_id and public.memory_epoch(m.id) and (m.status='published' or m.author_id=auth.uid() or exists(select 1 from public.memory_notes n where n.memory_id=m.id and n.user_id=auth.uid() and n.body<>'')));
$$;
create function public.memory_source(p_kind text,p_key text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare since_at timestamptz; result jsonb; badge record;
begin
 select max(joined_at) into since_at from public.couple_members where left_at is null and public.is_space_member(space_id);
 if (select count(*) from public.couple_members where left_at is null and public.is_space_member(space_id))<>2 then return null; end if;
 if p_kind='task' then
  select jsonb_build_object('title',t.title,'date',(i.completed_at at time zone 'UTC')::date,'path','/tasks?instance='||i.id::text) into result
  from public.task_instances i join public.tasks t on t.id=i.task_id where i.id::text=p_key and t.kind='joint' and i.status='completed' and i.completed_at>=since_at and public.can_read_task(t.id)
  and (select count(*) from public.task_participants p where p.task_id=t.id and p.consent='accepted' and public.is_partner(p.user_id))=2;
 elsif p_kind='goal' then
  select jsonb_build_object('title',g.title,'date',(g.completed_at at time zone 'UTC')::date,'path','/goals/'||g.id::text) into result from public.couple_goals g where g.id::text=p_key and g.status='completed' and g.completed_at>=since_at and public.can_read_goal(g.id);
 elsif p_kind='ritual' then
  select jsonb_build_object('title',i.terms->>'title','date',i.scheduled_on,'path','/us/traditions') into result from public.ritual_instances i where i.id::text=p_key and i.status='completed' and i.completed_at>=since_at and public.can_read_ritual(i.ritual_id);
 elsif p_kind='achievement' then
  select * into badge from public.statistics_badges() where code=p_key and scope='shared' and progress>=threshold and unlocked_at>=since_at;
  if found and (select count(*) from public.statistics_joint_facts f where f.kind=badge.metric and f.at>=since_at)>=badge.threshold then result:=jsonb_build_object('title','Наше спільне досягнення','date',(badge.unlocked_at at time zone 'UTC')::date,'path','/us/progress'); end if;
 end if; return result;
end $$;
-- Owner-only, fixed projection prevents withdrawn rows leaking title/date/source via REST.
-- Raw memory/photo tables are not exposed to authenticated; use projections below.
create function public.memory_lock(p_id uuid) returns public.couple_memories language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();m public.couple_memories;sp uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select space_id into sp from public.couple_memories where id=p_id;
 perform 1 from public.couple_spaces where id=sp for update;
 select * into m from public.couple_memories where id=p_id for update;
 if not found or not public.memory_epoch(p_id) then raise exception 'memory_unavailable'; end if;return m;
end $$;
create function public.memory_action(p_action text,p_id uuid,p_expected integer,p_payload jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();m public.couple_memories;n public.memory_notes;sp uuid;a uuid;b uuid;h text;old public.memory_requests;result jsonb;ids uuid[];source jsonb;
begin
 if p_request is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>40000 or p_expected is null or p_expected<0 then raise exception 'memory_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select space_id,id into sp,a from public.couple_members where user_id=u and left_at is null;
 perform 1 from public.couple_spaces where id=sp for update;
 select id into b from public.couple_members where space_id=sp and user_id<>u and left_at is null;
 if b is null then raise exception 'partner_required'; end if;
 h:=encode(sha256(convert_to(jsonb_build_array(p_action,p_id,p_expected,p_payload)::text,'UTF8')),'hex');
 select * into old from public.memory_requests where user_id=u and request_id=p_request;
 if found then
  if old.intent<>h then raise exception 'memory_request_conflict'; end if;
  if not public.memory_epoch((old.result->>'id')::uuid) then raise exception 'memory_unavailable'; end if; return old.result;
 end if;
 if p_action='create' then
  if p_expected<>(select count(*) from public.couple_memories where author_id=u and space_id=sp) then raise exception 'memory_changed'; end if;
  if p_payload ? 'source_kind' then
    source:=public.memory_source(p_payload->>'source_kind',p_payload->>'source_key');
    if source is null then raise exception 'memory_source_unavailable'; end if;
    select * into m from public.couple_memories where space_id=sp and least(am,bm)=least(a,b) and greatest(am,bm)=greatest(a,b) and source_kind=p_payload->>'source_kind' and source_key=p_payload->>'source_key';
    if found then if m.author_id<>u and m.status<>'published' then raise exception 'memory_source_unavailable';end if;result:=jsonb_build_object('id',m.id,'version',m.version); end if;
  end if;
  if result is null then
   insert into public.couple_memories(space_id,author_id,am,bm,source_kind,source_key) values(sp,u,a,b,p_payload->>'source_kind',p_payload->>'source_key') returning * into m;
   result:=jsonb_build_object('id',m.id,'version',m.version);
  end if;
 else
  m:=public.memory_lock(p_id);
  if p_action='note' then
   if m.status<>'published' then raise exception 'memory_unavailable'; end if;
   select * into n from public.memory_notes where memory_id=m.id and user_id=u;
   if coalesce(n.version,0)<>p_expected then raise exception 'memory_changed'; end if;
   if jsonb_typeof(p_payload->'body') is distinct from 'string' or char_length(p_payload->>'body')>3000 then raise exception 'memory_invalid'; end if;
   insert into public.memory_notes(memory_id,user_id,body,version) values(m.id,u,p_payload->>'body',p_expected+1) on conflict(memory_id,user_id) do update set body=excluded.body,version=excluded.version,updated_at=clock_timestamp();
  elsif p_action='delete_note' then
   select * into n from public.memory_notes where memory_id=m.id and user_id=u;
   if not found or n.version<>p_expected then raise exception 'memory_changed'; end if;
   update public.memory_notes set body='',version=version+1,updated_at=clock_timestamp() where memory_id=m.id and user_id=u;
  else
   if m.author_id<>u or m.version<>p_expected then raise exception 'memory_changed'; end if;
   if p_action='save' then
    if m.status not in ('draft','published') or jsonb_typeof(p_payload->'title') is distinct from 'string' or char_length(btrim(p_payload->>'title')) not between 1 and 120 or jsonb_typeof(p_payload->'story') is distinct from 'string' or char_length(p_payload->>'story')>5000
     or coalesce(p_payload->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or (p_payload->>'date')::date not between '1900-01-01'::date and '2200-12-31'::date
     or (p_payload->>'category' is not null and p_payload->>'category' not in ('date','travel','joy','milestone','other'))
     or jsonb_typeof(p_payload->'photos') is distinct from 'array' or jsonb_array_length(p_payload->'photos')>5
     or (m.status='published' or p_payload->>'publish'='true') and p_payload->'confirmed' is distinct from 'true'::jsonb then raise exception 'memory_invalid'; end if;
    select coalesce(array_agg(x::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(p_payload->'photos') x;
    -- Serialize attachment validation with service-side staging garbage collection.
    perform 1 from public.memory_photos where memory_id=m.id order by id for update;
    if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) or cardinality(ids)<>(select count(*) from public.memory_photos where id=any(ids) and memory_id=m.id and author_id=u and state='ready') then raise exception 'memory_invalid'; end if;
    update public.memory_photos set position=null where memory_id=m.id;
    update public.memory_photos set state='deleting' where memory_id=m.id and state='ready' and not id=any(ids);
    update public.memory_photos set position=array_position(ids,id) where memory_id=m.id and id=any(ids);
    update public.couple_memories set title=btrim(p_payload->>'title'),story=p_payload->>'story',event_date=(p_payload->>'date')::date,category=p_payload->>'category',status=case when status='published' or p_payload->>'publish'='true' then 'published' else 'draft' end,version=version+1,updated_at=clock_timestamp() where id=m.id returning * into m;
   elsif p_action in ('withdraw','delete') then
    update public.couple_memories set status=case p_action when 'withdraw' then 'withdrawn' else 'deleted' end,title=case p_action when 'delete' then '' else title end,story=case p_action when 'delete' then '' else story end,source_kind=null,source_key=null,version=version+1,updated_at=clock_timestamp() where id=m.id returning * into m;
    update public.memory_photos set position=null,state='deleting' where memory_id=m.id;
   else raise exception 'memory_invalid'; end if;
  end if;
  result:=jsonb_build_object('id',m.id,'version',m.version);
 end if;
 insert into public.memory_requests values(u,p_request,h,result);return result;
exception when invalid_text_representation or datetime_field_overflow or check_violation or not_null_violation then raise exception 'memory_invalid';
end $$;
create function public.memory_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();m public.couple_memories;result jsonb;
begin
 select * into m from public.couple_memories where id=p_id;
 if not found or not public.memory_visible(m.id) then raise exception 'memory_unavailable'; end if;
 if (m.status='deleted' or m.status='withdrawn' and m.author_id<>u) then
  return jsonb_build_object('context',public.ritual_context(),'memory',jsonb_build_object('id',m.id,'status','private_note'),'notes',(select jsonb_agg(to_jsonb(n)) from public.memory_notes n where memory_id=m.id and user_id=u and body<>''),'photos','[]'::jsonb);
 end if;
 return jsonb_build_object('context',public.ritual_context(),'memory',to_jsonb(m)-'source_kind'-'source_key','source',case when m.status in ('draft','published') then public.memory_source(m.source_kind,m.source_key) end,
 'notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.memory_notes n where memory_id=m.id and (body<>'' or user_id=u) and (user_id=u or m.status='published')),'[]'),
 'photos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'position',p.position,'state',p.state,'mime',p.mime,'bytes',p.bytes) order by p.position,p.created_at) from public.memory_photos p where p.memory_id=m.id and p.state='ready' and (p.position is not null or m.author_id=u) and m.status in ('draft','published')),'[]'));
end $$;
create function public.memory_feed(p_cursor uuid default null,p_category text default null,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();ctx text:=public.ritual_context();c public.memory_cursors;rows jsonb;last jsonb;token uuid;upper_at timestamptz:=clock_timestamp();
begin
 if p_limit is null or p_limit not between 1 and 40 or (p_category is not null and p_category not in ('date','travel','joy','milestone','other')) then raise exception 'memory_invalid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 if p_cursor is not null then select * into c from public.memory_cursors where id=p_cursor and user_id=u and context=ctx and category is not distinct from p_category and expires_at>clock_timestamp();if not found then raise exception 'memory_cursor_invalid'; end if;upper_at:=c.ceiling;end if;
 with visible as (
  select m.id,case when (m.status='deleted' or m.status='withdrawn' and m.author_id<>u) then (select (n.created_at at time zone 'UTC')::date from public.memory_notes n where memory_id=m.id and user_id=u) else m.event_date end as day,
  case when (m.status='deleted' or m.status='withdrawn' and m.author_id<>u) then 'Твоя особиста нотатка' else coalesce(nullif(m.title,''),'Новий спогад') end as title,
  case when (m.status='deleted' or m.status='withdrawn' and m.author_id<>u) then null else m.category end as category,
  case when (m.status='deleted' or m.status='withdrawn' and m.author_id<>u) then 'private_note' else m.status end as status,
  case when m.status in ('draft','published') then (select p.id from public.memory_photos p where p.memory_id=m.id and state='ready' and position=1) end as cover
  from public.couple_memories m where m.space_id=(select space_id from public.couple_members where user_id=u and left_at is null) and m.created_at<=upper_at and m.updated_at<=upper_at and public.memory_visible(m.id) and (m.status<>'deleted' or exists(select 1 from public.memory_notes n where n.memory_id=m.id and n.user_id=u and n.body<>''))
 ) select coalesce(jsonb_agg(to_jsonb(q) order by q.day desc,q.id desc),'[]') into rows from (select * from visible v where (p_category is null or v.category=p_category) and (p_cursor is null or (v.day,v.id)<(c.last_day,c.last_id)) order by day desc,id desc limit p_limit+1) q;
 if jsonb_array_length(rows)>p_limit then rows:=rows-p_limit;last:=rows->(p_limit-1);
 delete from public.memory_cursors where user_id=u and (expires_at<=clock_timestamp() or id in(select id from public.memory_cursors where user_id=u order by expires_at desc offset 99));
 insert into public.memory_cursors(user_id,context,category,ceiling,last_day,last_id) values(u,ctx,p_category,upper_at,(last->>'day')::date,(last->>'id')::uuid) returning id into token;end if;
 return jsonb_build_object('context',ctx,'items',rows,'next_cursor',token,'create_version',(select count(*) from public.couple_memories where author_id=u and space_id=(select space_id from public.couple_members where user_id=u and left_at is null)));
end $$;
create function public.memory_inspect(p_request uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();r jsonb;
begin select result into r from public.memory_requests where user_id=u and request_id=p_request;
 if r is not null and not public.memory_epoch((r->>'id')::uuid) then raise exception 'memory_unavailable';end if;return r;end $$;
create function public.memory_file(p_action text,p_id uuid,p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();m public.couple_memories;p public.memory_photos;meta jsonb;result jsonb;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>2000 then raise exception 'memory_invalid';end if;
 if p_action='cleanup' then
  perform pg_advisory_xact_lock(hashtextextended(u::text,0));
  with candidates as(select x.id from public.memory_photos x join public.couple_memories mm on mm.id=x.memory_id where x.author_id=u and (x.state='deleting' or mm.status in ('withdrawn','deleted') or not public.memory_epoch(mm.id) or x.position is null and x.created_at<clock_timestamp()-interval '15 minutes') order by x.created_at limit 20 for update of x),changed as(update public.memory_photos set position=null,state='deleting' where id in(select id from candidates) returning id,path)
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into result from changed c;return result;

 elsif p_action='reserve' then
  m:=public.memory_lock(p_id);
  if m.author_id<>u or m.status not in ('draft','published') then raise exception 'memory_unavailable';end if;
  select * into p from public.memory_photos where id=(p_payload->>'id')::uuid;
  if found then
   if p.author_id<>u or p.memory_id<>m.id or p.digest is distinct from p_payload->>'digest' or p.bytes is distinct from (p_payload->>'bytes')::integer or p.mime is distinct from p_payload->>'mime' then raise exception 'memory_invalid';end if;
  else
   if (select count(*) from public.memory_photos where memory_id=m.id and state in ('reserved','ready') and position is null)>=5 then raise exception 'memory_photo_limit';end if;
   insert into public.memory_photos(id,memory_id,author_id,mime,bytes,digest) values((p_payload->>'id')::uuid,m.id,u,p_payload->>'mime',(p_payload->>'bytes')::integer,p_payload->>'digest') returning * into p;
  end if;
  return jsonb_build_object('id',p.id,'state',p.state);
 else
  select * into p from public.memory_photos where id=p_id;
  if not found then raise exception 'memory_unavailable';end if;
  if p_action='read' then
   select * into m from public.couple_memories where id=p.memory_id;
   if p.state<>'ready' or not public.memory_epoch(m.id) or m.status not in ('draft','published') or (m.author_id<>u and (m.status<>'published' or p.position is null)) then raise exception 'memory_unavailable';end if;
  else
   m:=public.memory_lock(p.memory_id);
   select * into p from public.memory_photos where id=p_id for update;
   if p.author_id<>u or m.status not in ('draft','published') then raise exception 'memory_unavailable';end if;
   if p_action='discard' then
    if p.position is not null then raise exception 'memory_changed';end if;
    update public.memory_photos set state='deleting' where id=p.id;return '{}'::jsonb;
   elsif p_action in ('upload','commit') then
    if p.state not in ('reserved','ready') or p.state='reserved' and p.created_at<clock_timestamp()-interval '15 minutes' then raise exception 'memory_unavailable';end if;
    if p_action='commit' and p.state='reserved' then
     select metadata into meta from storage.objects where bucket_id='couple-memories' and name=p.path;
     if meta is null or coalesce((meta->>'size')::bigint,0)<>p.bytes or meta->>'mimetype' is distinct from p.mime then raise exception 'memory_invalid';end if;
     update public.memory_photos set state='ready' where id=p.id returning * into p;
    end if;
   else raise exception 'memory_invalid';end if;
  end if;
  return jsonb_build_object('id',p.id,'path',p.path,'state',p.state,'mime',p.mime,'bytes',p.bytes,'digest',p.digest);
 end if;
exception when invalid_text_representation or check_violation or not_null_violation then raise exception 'memory_invalid';end $$;
-- Called only by the file service after physical deletion; never erase the manifest first.
create function public.memory_prune_photo(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin delete from public.memory_photos p where p.id=p_id and p.state='deleting' and not exists(select 1 from storage.objects o where o.bucket_id='couple-memories' and o.name=p.path);end $$;
revoke all on function public.memory_prune_photo(uuid) from public,anon,authenticated;
grant execute on function public.memory_prune_photo(uuid) to service_role;
-- Private maintenance: catches expired staging, lost original membership and Auth-cascade orphans.
create function public.memory_gc_candidates() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update public.memory_photos p set position=null,state='deleting' where p.id in(
  select x.id from public.memory_photos x join public.couple_memories m on m.id=x.memory_id
  where x.state='deleting' or m.status in ('withdrawn','deleted') or not exists(select 1 from public.couple_members a join public.couple_members b on b.space_id=a.space_id where a.id=m.am and b.id=m.bm and a.left_at is null and b.left_at is null)
   or x.position is null and x.created_at<clock_timestamp()-interval '15 minutes' order by x.created_at limit 100 for update of x skip locked);
 with dead as(select p.id,p.path from public.memory_photos p where p.state='deleting' order by p.created_at limit 100),orphans as(select null::uuid id,o.name path from storage.objects o where o.bucket_id='couple-memories' and not exists(select 1 from public.memory_photos p where p.path=o.name) limit 100)
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from(select * from dead union all select * from orphans limit 100)x;
 return result;
end $$;
revoke all on function public.memory_gc_candidates() from public,anon,authenticated;
grant execute on function public.memory_gc_candidates() to service_role;
-- Bounded, read-only source picker: no private responses/mood, no old-composition XP.
create function public.memory_sources() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=public.require_verified_user();result jsonb;
begin
 with candidates as(
  select 'task'::text kind,i.id::text key,i.completed_at at from public.task_instances i join public.tasks t on t.id=i.task_id where t.kind='joint' and i.status='completed' and public.can_read_task(t.id) order by i.completed_at desc limit 20
 ), goals as(select 'goal'::text kind,id::text key,completed_at at from public.couple_goals where status='completed' and public.can_read_goal(id) order by completed_at desc limit 20),rituals as(select 'ritual'::text kind,id::text key,completed_at at from public.ritual_instances where status='completed' and public.can_read_ritual(ritual_id) order by completed_at desc limit 20),badges as(select 'achievement'::text kind,code key,unlocked_at at from public.statistics_badges() where scope='shared' and progress>=threshold),all_sources as(select * from candidates union all select * from goals union all select * from rituals union all select * from badges)
 select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc,x.key),'[]') into result from(select s.*,public.memory_source(s.kind,s.key) source from all_sources s where public.memory_source(s.kind,s.key) is not null order by s.at desc,s.key limit 40)x;
 return jsonb_build_object('context',public.ritual_context(),'items',result);end $$;

alter table public.couple_memories enable row level security;
alter table public.memory_notes enable row level security;
alter table public.memory_photos enable row level security;
alter table public.memory_requests enable row level security;
alter table public.memory_cursors enable row level security;
revoke all on public.couple_memories,public.memory_notes,public.memory_photos,public.memory_requests,public.memory_cursors from public,anon,authenticated;
-- Notes expose only self text or mutually published content; memory raw metadata stays RPC-only.
grant select on public.memory_notes to authenticated;
create policy memory_note_read on public.memory_notes for select to authenticated using(public.memory_epoch(memory_id) and (user_id=auth.uid() or exists(select 1 from public.couple_memories m where m.id=memory_id and m.status='published')));
-- Use a predicate wrapper because authenticated intentionally cannot SELECT the parent table.
create function public.memory_note_visible(p_id uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.memory_epoch(p_id) and (p_user=auth.uid() or exists(select 1 from public.couple_memories where id=p_id and status='published'));
$$;
drop policy memory_note_read on public.memory_notes;
create policy memory_note_read on public.memory_notes for select to authenticated using(public.memory_note_visible(memory_id,user_id));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('couple-memories','couple-memories',false,5242880,array['image/jpeg','image/png','image/webp']);
-- Restrictive guard also blocks pre-existing broad permissive policies on other buckets.
create policy memory_storage_guard on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'couple-memories') with check(bucket_id<>'couple-memories');
revoke all on function public.memory_epoch(uuid),public.memory_visible(uuid),public.memory_source(text,text),public.memory_lock(uuid),public.memory_note_visible(uuid,uuid),public.memory_action(text,uuid,integer,jsonb,uuid),public.memory_detail(uuid),public.memory_feed(uuid,text,integer),public.memory_inspect(uuid),public.memory_file(text,uuid,jsonb),public.memory_sources() from public,anon,authenticated;
grant execute on function public.memory_note_visible(uuid,uuid),public.memory_action(text,uuid,integer,jsonb,uuid),public.memory_detail(uuid),public.memory_feed(uuid,text,integer),public.memory_inspect(uuid),public.memory_file(text,uuid,jsonb),public.memory_sources() to authenticated;
commit;
