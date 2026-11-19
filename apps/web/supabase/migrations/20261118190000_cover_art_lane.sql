-- Cover art lane: silent, phone-sized looping versions of every animated cover,
-- made by the cover-art worker (apps/web/workers/cover-art) and served by
-- /api/media/visual in place of the original upload. Originals are never
-- modified; a cover without a ready version keeps serving its original.
--
-- One row per version of a cover video (its R2 key and ETag). Queueing a new
-- ETag for a key supersedes every older version of that key, so a replaced
-- cover falls back to its new original until its own versions are ready.

create table public.cover_art_versions (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  source_etag text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'ready', 'failed', 'superseded')),
  -- [{ "id": "square-720", "key": "cover-art/...", "width": 720, "height": 720, "bytes": 123 }]
  renditions jsonb,
  worker_id text,
  lease_token uuid,
  heartbeat_at timestamptz,
  attempt_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  unique (source_key, source_etag)
);

create index cover_art_versions_ready_idx
  on public.cover_art_versions (source_key, ready_at desc) where status = 'ready';
create index cover_art_versions_queue_idx
  on public.cover_art_versions (created_at) where status in ('queued', 'processing');

alter table public.cover_art_versions enable row level security;
revoke all on public.cover_art_versions from anon, authenticated;
grant all on public.cover_art_versions to service_role;

-- Queue a cover video version. An unchanged cover is a no-op (a failed one is
-- retried); a new version supersedes the key's older versions.
create function public.queue_cover_art(p_source_key text, p_source_etag text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  insert into public.cover_art_versions (source_key, source_etag)
  values (p_source_key, p_source_etag)
  on conflict (source_key, source_etag) do nothing
  returning id into v_id;

  if v_id is null then
    update public.cover_art_versions
      set status = 'queued', attempt_count = 0, error_message = null, worker_id = null, lease_token = null
      where source_key = p_source_key and source_etag = p_source_etag and status = 'failed'
      returning id into v_id;
    if v_id is null then
      select id into v_id from public.cover_art_versions
        where source_key = p_source_key and source_etag = p_source_etag;
    end if;
    return v_id;
  end if;

  update public.cover_art_versions set status = 'superseded', lease_token = null
    where source_key = p_source_key and id <> v_id and status <> 'superseded';
  return v_id;
end $$;

-- Claim the oldest queued version (or one whose worker went silent for five
-- minutes). After three attempts an abandoned version fails.
create function public.claim_cover_art_job(p_worker_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.cover_art_versions;
begin
  update public.cover_art_versions
    set status = 'failed', error_message = 'Worker lease expired after three attempts', lease_token = null
    where status = 'processing' and heartbeat_at < now() - interval '5 minutes' and attempt_count >= 3;

  select * into v from public.cover_art_versions
    where status = 'queued'
       or (status = 'processing' and heartbeat_at < now() - interval '5 minutes')
    order by created_at
    for update skip locked
    limit 1;
  if not found then
    return null;
  end if;

  update public.cover_art_versions
    set status = 'processing', worker_id = p_worker_id, lease_token = gen_random_uuid(),
        heartbeat_at = now(), attempt_count = attempt_count + 1, error_message = null
    where id = v.id
    returning * into v;

  return jsonb_build_object(
    'id', v.id, 'source_key', v.source_key, 'source_etag', v.source_etag,
    'lease_token', v.lease_token, 'attempt', v.attempt_count
  );
end $$;

-- Keep a claimed version's lease alive during a long encode.
create function public.heartbeat_cover_art_job(p_id uuid, p_lease_token uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.cover_art_versions set heartbeat_at = now()
    where id = p_id and lease_token = p_lease_token and status = 'processing';
  return found;
end $$;

-- Finish a claimed version: ready with its renditions, or an error (retried
-- up to three attempts). Only the current lease holder can finish it.
create function public.complete_cover_art_job(
  p_id uuid, p_lease_token uuid, p_renditions jsonb default null, p_error text default null
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v public.cover_art_versions;
begin
  select * into v from public.cover_art_versions
    where id = p_id and lease_token = p_lease_token and status = 'processing'
    for update;
  if not found then
    return false;
  end if;

  if p_error is null and jsonb_typeof(p_renditions) = 'array' and jsonb_array_length(p_renditions) > 0 then
    update public.cover_art_versions
      set status = 'ready', renditions = p_renditions, ready_at = now(), lease_token = null, error_message = null
      where id = p_id;
  else
    update public.cover_art_versions
      set status = case when v.attempt_count >= 3 then 'failed' else 'queued' end,
          error_message = coalesce(p_error, 'No renditions'), lease_token = null
      where id = p_id;
  end if;
  return true;
end $$;

revoke all on function
  public.queue_cover_art(text, text),
  public.claim_cover_art_job(text),
  public.heartbeat_cover_art_job(uuid, uuid),
  public.complete_cover_art_job(uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function
  public.queue_cover_art(text, text),
  public.claim_cover_art_job(text),
  public.heartbeat_cover_art_job(uuid, uuid),
  public.complete_cover_art_job(uuid, uuid, jsonb, text)
  to service_role;

-- The lane's own database login. It can claim, heartbeat and finish cover-art
-- jobs and nothing else: no table access (the functions run as their owner),
-- not even queueing (the website queues). It is created without a password;
-- the host operator sets one (as a SCRAM verifier) when the lane is deployed,
-- so no credential is ever written into a migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cover_art_worker') then
    create role cover_art_worker nologin noinherit;
  end if;
end $$;
grant usage on schema public to cover_art_worker;
grant execute on function
  public.claim_cover_art_job(text),
  public.heartbeat_cover_art_job(uuid, uuid),
  public.complete_cover_art_job(uuid, uuid, jsonb, text)
  to cover_art_worker;
