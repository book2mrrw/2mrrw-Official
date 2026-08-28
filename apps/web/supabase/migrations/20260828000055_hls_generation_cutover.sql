-- HLS generation-fenced, zero-downtime rendition cutover.
--
-- A transcode never writes into the active prefix. Queue generations write to
-- immutable prefixes, and a fenced database transaction atomically promotes a
-- completed generation. Superseded workers cannot publish or mutate queue state.

alter table public.hls_transcode_jobs
  add column if not exists base_hls_prefix text,
  add column if not exists generation bigint not null default 0,
  add column if not exists claim_token uuid,
  add column if not exists target_profile_version integer not null default 3,
  add column if not exists updated_at timestamptz not null default now();

alter table public.hls_manifests
  add column if not exists active_generation bigint not null default 0,
  add column if not exists activated_at timestamptz not null default now();

create or replace function public.hls_base_prefix(p_prefix text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
begin
  v_prefix := regexp_replace(trim(coalesce(p_prefix, '')), '^/+', '');
  v_prefix := regexp_replace(v_prefix, 'versions/g[0-9]+/?$', '');
  v_prefix := regexp_replace(v_prefix, '/+$', '') || '/';

  if v_prefix !~ '^hls/[a-zA-Z0-9._/-]+/$' or v_prefix like '%..%' then
    raise exception 'invalid HLS prefix';
  end if;

  return v_prefix;
end;
$$;

update public.hls_transcode_jobs
   set base_hls_prefix = public.hls_base_prefix(coalesce(
     nullif(hls_prefix, ''),
     'hls/'
       || regexp_replace(lower(coalesce(release_type, 'singles')), '[^a-z0-9-]', '', 'g')
       || '/' || regexp_replace(lower(slug), '[^a-z0-9_-]', '', 'g')
       || case
            when nullif(track_slug, '') is null then '/'
            else '/' || regexp_replace(lower(track_slug), '[^a-z0-9_-]', '', 'g') || '/'
          end
   ))
 where base_hls_prefix is null;

-- Pending work has not written an active generation yet and can safely move to
-- its first immutable destination. Processing legacy work is left untouched so
-- an already-running pre-migration worker can drain normally.
update public.hls_transcode_jobs
   set generation = greatest(generation, 1),
       hls_prefix = base_hls_prefix
                    || 'versions/g' || greatest(generation, 1)::text || '/',
       updated_at = now()
 where status = 'pending';

alter table public.hls_transcode_jobs
  alter column base_hls_prefix set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_transcode_jobs'::regclass
       and conname = 'hls_transcode_jobs_generation_check'
  ) then
    alter table public.hls_transcode_jobs
      add constraint hls_transcode_jobs_generation_check check (generation >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_transcode_jobs'::regclass
       and conname = 'hls_transcode_jobs_target_profile_check'
  ) then
    alter table public.hls_transcode_jobs
      add constraint hls_transcode_jobs_target_profile_check
      check (target_profile_version >= 1);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_manifests'::regclass
       and conname = 'hls_manifests_active_generation_check'
  ) then
    alter table public.hls_manifests
      add constraint hls_manifests_active_generation_check
      check (active_generation >= 0);
  end if;
end
$$;

create table if not exists public.hls_retired_prefixes (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  track_slug text,
  hls_prefix text not null unique,
  generation bigint not null check (generation >= 0),
  retired_at timestamptz not null default now(),
  delete_after timestamptz not null default (now() + interval '48 hours'),
  status text not null default 'pending'
    check (status in ('pending', 'deleting', 'deleted', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_hls_retired_prefixes_gc
  on public.hls_retired_prefixes (delete_after, retired_at)
  where status in ('pending', 'failed');

alter table public.hls_retired_prefixes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'hls_retired_prefixes'
       and policyname = 'no_public_access'
  ) then
    create policy no_public_access
      on public.hls_retired_prefixes for all to public using (false);
  end if;
end
$$;

create or replace function public.hls_prepare_job_generation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_new_generation boolean;
begin
  v_base := public.hls_base_prefix(
    coalesce(nullif(new.base_hls_prefix, ''), new.hls_prefix)
  );

  if tg_op = 'INSERT' then
    new.base_hls_prefix := v_base;
    new.generation := greatest(coalesce(new.generation, 0), 1);
    new.hls_prefix := v_base || 'versions/g' || new.generation::text || '/';
    new.claim_token := null;
    new.updated_at := now();
    return new;
  end if;

  v_new_generation := new.status = 'pending' and (
    old.status is distinct from 'pending'
    or new.source_key is distinct from old.source_key
    or v_base is distinct from old.base_hls_prefix
    or new.generation > old.generation
    or new.target_profile_version is distinct from old.target_profile_version
    or new.bitrates is distinct from old.bitrates
    or new.segment_duration_secs is distinct from old.segment_duration_secs
  );

  if v_new_generation then
    if not exists (
      select 1 from public.hls_manifests manifest
       where manifest.slug = old.slug
         and coalesce(manifest.track_slug, '') = coalesce(old.track_slug, '')
         and manifest.hls_prefix = old.hls_prefix
    ) then
      insert into public.hls_retired_prefixes (
        slug, track_slug, hls_prefix, generation, delete_after
      ) values (
        old.slug, old.track_slug, old.hls_prefix, old.generation,
        now() + interval '48 hours'
      )
      on conflict (hls_prefix) do update
        set delete_after = greatest(public.hls_retired_prefixes.delete_after, excluded.delete_after),
            status = 'pending',
            last_error = null,
            deleted_at = null,
            updated_at = now();
    end if;

    new.base_hls_prefix := v_base;
    new.generation := greatest(old.generation, 0) + 1;
    new.hls_prefix := v_base || 'versions/g' || new.generation::text || '/';
    new.claim_token := null;
    new.worker_id := null;
  else
    new.base_hls_prefix := old.base_hls_prefix;
    new.generation := old.generation;
    new.hls_prefix := old.hls_prefix;
    if new.status <> 'processing' then
      new.claim_token := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.hls_retire_deleted_job_prefix()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.hls_manifests manifest
     where manifest.slug = old.slug
       and coalesce(manifest.track_slug, '') = coalesce(old.track_slug, '')
       and manifest.hls_prefix = old.hls_prefix
  ) then
    insert into public.hls_retired_prefixes (
      slug, track_slug, hls_prefix, generation, delete_after
    ) values (
      old.slug, old.track_slug, old.hls_prefix, old.generation,
      now() + interval '48 hours'
    )
    on conflict (hls_prefix) do update
      set delete_after = greatest(public.hls_retired_prefixes.delete_after, excluded.delete_after),
          status = 'pending',
          last_error = null,
          deleted_at = null,
          updated_at = now();
  end if;
  return old;
end;
$$;

drop trigger if exists trg_hls_prepare_job_generation
  on public.hls_transcode_jobs;
create trigger trg_hls_prepare_job_generation
before insert or update on public.hls_transcode_jobs
for each row execute function public.hls_prepare_job_generation();

drop trigger if exists trg_hls_retire_deleted_job_prefix
  on public.hls_transcode_jobs;
create trigger trg_hls_retire_deleted_job_prefix
before delete on public.hls_transcode_jobs
for each row execute function public.hls_retire_deleted_job_prefix();

create or replace function public.hls_enqueue_transcode_job(
  p_slug text,
  p_track_slug text,
  p_release_type text,
  p_source_key text,
  p_base_hls_prefix text,
  p_priority integer default 5,
  p_bitrates text[] default array['320k', '160k', '96k']::text[],
  p_segment_duration_secs integer default 2,
  p_queued_by text default 'system',
  p_target_profile_version integer default 3,
  p_force boolean default false
)
returns public.hls_transcode_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.hls_transcode_jobs;
  v_base text;
begin
  if nullif(trim(p_slug), '') is null or nullif(trim(p_source_key), '') is null then
    raise exception 'slug and source key are required';
  end if;
  if p_priority not between 1 and 10 then
    raise exception 'priority must be between 1 and 10';
  end if;
  if p_segment_duration_secs not between 1 and 30 then
    raise exception 'invalid segment duration';
  end if;
  if p_target_profile_version < 1 then
    raise exception 'invalid target profile version';
  end if;

  v_base := public.hls_base_prefix(p_base_hls_prefix);

  -- Serialize the no-row insert case as well as updates for this logical track.
  perform pg_advisory_xact_lock(
    hashtextextended(trim(p_slug) || ':' || coalesce(nullif(trim(p_track_slug), ''), ''), 0)
  );

  select * into v_job
    from public.hls_transcode_jobs
   where slug = trim(p_slug)
     and coalesce(track_slug, '') = coalesce(nullif(trim(p_track_slug), ''), '')
   for update;

  if found then
    if not p_force
       and v_job.status in ('pending', 'processing')
       and v_job.source_key = trim(p_source_key)
       and v_job.base_hls_prefix = v_base
       and v_job.target_profile_version >= p_target_profile_version then
      return v_job;
    end if;

    update public.hls_transcode_jobs
       set release_type = trim(p_release_type),
           source_key = trim(p_source_key),
           base_hls_prefix = v_base,
           hls_prefix = v_base,
           status = 'pending',
           priority = p_priority,
           bitrates = p_bitrates,
           segment_duration_secs = p_segment_duration_secs,
           target_profile_version = p_target_profile_version,
           generation = v_job.generation + 1,
           error_message = null,
           attempt_count = 0,
           worker_id = null,
           claim_token = null,
           queued_by = p_queued_by,
           started_at = null,
           completed_at = null
     where id = v_job.id
     returning * into v_job;
  else
    insert into public.hls_transcode_jobs (
      slug, track_slug, release_type, source_key, base_hls_prefix, hls_prefix,
      status, priority, bitrates, segment_duration_secs, target_profile_version,
      queued_by
    ) values (
      trim(p_slug), nullif(trim(p_track_slug), ''), trim(p_release_type),
      trim(p_source_key), v_base, v_base, 'pending', p_priority, p_bitrates,
      p_segment_duration_secs, p_target_profile_version, p_queued_by
    ) returning * into v_job;
  end if;

  return v_job;
end;
$$;

create or replace function public.hls_claim_next_job(p_worker_id text)
returns public.hls_transcode_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.hls_transcode_jobs;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id is required';
  end if;

  select * into v_job
    from public.hls_transcode_jobs
   where status = 'pending'
   order by priority asc, created_at asc
   limit 1
   for update skip locked;

  if not found then
    return null;
  end if;

  update public.hls_transcode_jobs
     set status = 'processing',
         worker_id = trim(p_worker_id),
         claim_token = gen_random_uuid(),
         started_at = now(),
         completed_at = null,
         attempt_count = attempt_count + 1
   where id = v_job.id
   returning * into v_job;

  return v_job;
end;
$$;

create or replace function public.hls_enqueue_profile_upgrades(
  p_limit integer default 10,
  p_queued_by text default 'system',
  p_target_profile_version integer default 3
)
returns setof public.hls_transcode_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_candidate record;
  v_job public.hls_transcode_jobs;
begin
  if p_target_profile_version < 1 then
    raise exception 'invalid target profile version';
  end if;

  -- One bounded rollout coordinator at a time. Per-track enqueue still takes
  -- its own advisory lock, preserving one global->track lock order.
  perform pg_advisory_xact_lock(hashtextextended('hls-profile-upgrade', 0));

  for v_candidate in
    select job.*
      from public.hls_transcode_jobs job
      join public.hls_manifests manifest
        on manifest.slug = job.slug
       and coalesce(manifest.track_slug, '') = coalesce(job.track_slug, '')
     where manifest.transcode_profile_version < p_target_profile_version
       and not (
         job.status in ('pending', 'processing')
         and job.target_profile_version >= p_target_profile_version
       )
     order by manifest.updated_at asc, job.created_at asc
     limit greatest(least(p_limit, 50), 1)
  loop
    v_job := public.hls_enqueue_transcode_job(
      v_candidate.slug,
      v_candidate.track_slug,
      v_candidate.release_type,
      v_candidate.source_key,
      v_candidate.base_hls_prefix,
      4,
      v_candidate.bitrates,
      case when v_candidate.release_type = 'vault' then 4 else 2 end,
      p_queued_by,
      p_target_profile_version,
      false
    );
    return next v_job;
  end loop;
  return;
end;
$$;

create or replace function public.hls_commit_transcode_job(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_generation bigint,
  p_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.hls_transcode_jobs;
  v_old public.hls_manifests;
  v_bitrates text[];
  v_manifest_id uuid;
begin
  select * into v_job
    from public.hls_transcode_jobs
   where id = p_job_id
   for update;

  if not found
     or v_job.status <> 'processing'
     or v_job.worker_id is distinct from p_worker_id
     or v_job.claim_token is distinct from p_claim_token
     or v_job.generation is distinct from p_generation then
    return jsonb_build_object('committed', false, 'reason', 'superseded');
  end if;

  if p_manifest is null
     or p_manifest->>'slug' is distinct from v_job.slug
     or coalesce(p_manifest->>'track_slug', '') is distinct from coalesce(v_job.track_slug, '')
     or p_manifest->>'hls_prefix' is distinct from v_job.hls_prefix
     or jsonb_typeof(p_manifest->'bitrates') <> 'array'
     or jsonb_typeof(coalesce(p_manifest->'segment_counts', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_manifest->'segment_durations', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_manifest->'rendition_metadata', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_manifest->'source_metadata', '{}'::jsonb)) <> 'object'
     or coalesce((p_manifest->>'transcode_profile_version')::integer, 0) < v_job.target_profile_version
     or coalesce((p_manifest->>'segment_duration_secs')::integer, 0) < 1
     or coalesce((p_manifest->>'duration_seconds')::numeric, 0) <= 0 then
    raise exception 'manifest does not match claimed HLS job';
  end if;

  select array_agg(value order by ordinality) into v_bitrates
    from jsonb_array_elements_text(p_manifest->'bitrates') with ordinality;
  if coalesce(array_length(v_bitrates, 1), 0) = 0 then
    raise exception 'manifest requires at least one rendition';
  end if;

  select * into v_old
    from public.hls_manifests
   where slug = v_job.slug
     and coalesce(track_slug, '') = coalesce(v_job.track_slug, '')
   for update;

  if found then
    v_manifest_id := v_old.id;
    if v_old.hls_prefix is distinct from v_job.hls_prefix then
      insert into public.hls_retired_prefixes (
        slug, track_slug, hls_prefix, generation, delete_after
      ) values (
        v_old.slug, v_old.track_slug, v_old.hls_prefix,
        v_old.active_generation, now() + interval '48 hours'
      )
      on conflict (hls_prefix) do update
        set delete_after = greatest(public.hls_retired_prefixes.delete_after, excluded.delete_after),
            status = 'pending',
            last_error = null,
            deleted_at = null,
            updated_at = now();
    end if;

    update public.hls_manifests
       set release_type = v_job.release_type,
           hls_prefix = v_job.hls_prefix,
           bitrates = v_bitrates,
           segment_duration_secs = (p_manifest->>'segment_duration_secs')::integer,
           duration_seconds = (p_manifest->>'duration_seconds')::numeric,
           segment_counts = coalesce(p_manifest->'segment_counts', '{}'::jsonb),
           segment_durations = coalesce(p_manifest->'segment_durations', '{}'::jsonb),
           media_kind = coalesce(nullif(p_manifest->>'media_kind', ''), 'audio'),
           rendition_metadata = coalesce(p_manifest->'rendition_metadata', '{}'::jsonb),
           source_metadata = coalesce(p_manifest->'source_metadata', '{}'::jsonb),
           transcode_profile_version = (p_manifest->>'transcode_profile_version')::integer,
           active_generation = v_job.generation,
           activated_at = now(),
           updated_at = now()
     where id = v_old.id;
  else
    insert into public.hls_manifests (
      slug, track_slug, release_type, hls_prefix, bitrates,
      segment_duration_secs, duration_seconds, segment_counts,
      segment_durations, media_kind, rendition_metadata, source_metadata,
      transcode_profile_version, active_generation, activated_at
    ) values (
      v_job.slug, v_job.track_slug, v_job.release_type, v_job.hls_prefix,
      v_bitrates, (p_manifest->>'segment_duration_secs')::integer,
      (p_manifest->>'duration_seconds')::numeric,
      coalesce(p_manifest->'segment_counts', '{}'::jsonb),
      coalesce(p_manifest->'segment_durations', '{}'::jsonb),
      coalesce(nullif(p_manifest->>'media_kind', ''), 'audio'),
      coalesce(p_manifest->'rendition_metadata', '{}'::jsonb),
      coalesce(p_manifest->'source_metadata', '{}'::jsonb),
      (p_manifest->>'transcode_profile_version')::integer,
      v_job.generation, now()
    ) returning id into v_manifest_id;
  end if;

  delete from public.hls_retired_prefixes
   where hls_prefix = v_job.hls_prefix;

  update public.hls_transcode_jobs
     set status = 'complete',
         completed_at = now(),
         error_message = null
   where id = v_job.id;

  return jsonb_build_object(
    'committed', true,
    'manifest_id', v_manifest_id,
    'generation', v_job.generation,
    'hls_prefix', v_job.hls_prefix
  );
end;
$$;

create or replace function public.hls_fail_transcode_job(
  p_job_id uuid,
  p_worker_id text,
  p_claim_token uuid,
  p_generation bigint,
  p_error_message text,
  p_max_attempts integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.hls_transcode_jobs;
  v_next_status text;
begin
  select * into v_job
    from public.hls_transcode_jobs
   where id = p_job_id
   for update;

  if not found
     or v_job.status <> 'processing'
     or v_job.worker_id is distinct from p_worker_id
     or v_job.claim_token is distinct from p_claim_token
     or v_job.generation is distinct from p_generation then
    return jsonb_build_object('updated', false, 'reason', 'superseded');
  end if;

  v_next_status := case
    when v_job.attempt_count >= greatest(p_max_attempts, 1) then 'failed'
    else 'pending'
  end;

  update public.hls_transcode_jobs
     set status = v_next_status,
         error_message = left(coalesce(p_error_message, 'transcode failed'), 4000),
         worker_id = null,
         claim_token = null,
         started_at = null,
         completed_at = case when v_next_status = 'failed' then now() else null end
   where id = v_job.id
   returning * into v_job;

  return jsonb_build_object(
    'updated', true,
    'status', v_job.status,
    'generation', v_job.generation,
    'attempt_count', v_job.attempt_count
  );
end;
$$;

create or replace function public.hls_claim_retired_prefixes(p_limit integer default 10)
returns setof public.hls_retired_prefixes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select id
      from public.hls_retired_prefixes
     where delete_after <= now()
       and attempt_count < 10
       and (
         status in ('pending', 'failed')
         or (status = 'deleting' and updated_at < now() - interval '30 minutes')
       )
     order by delete_after asc, retired_at asc
     limit greatest(least(p_limit, 50), 1)
     for update skip locked
  )
  update public.hls_retired_prefixes retired
     set status = 'deleting',
         attempt_count = retired.attempt_count + 1,
         last_error = null,
         updated_at = now()
    from candidates
   where retired.id = candidates.id
  returning retired.*;
end;
$$;

create or replace function public.hls_finish_retired_prefix(
  p_id uuid,
  p_deleted boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  update public.hls_retired_prefixes
     set status = case when p_deleted then 'deleted' else 'failed' end,
         deleted_at = case when p_deleted then now() else null end,
         last_error = case when p_deleted then null else left(coalesce(p_error, 'R2 deletion failed'), 4000) end,
         updated_at = now()
   where id = p_id
     and status = 'deleting';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

comment on column public.hls_transcode_jobs.generation is
  'Monotonic logical rendition generation used to fence stale workers.';
comment on column public.hls_transcode_jobs.claim_token is
  'Single-attempt capability minted during atomic claim and required for commit/failure.';
comment on column public.hls_transcode_jobs.base_hls_prefix is
  'Canonical logical track prefix; generations are written below versions/gN/.';
comment on table public.hls_retired_prefixes is
  'Immutable HLS generations awaiting delayed, retryable R2 garbage collection.';

revoke all on function public.hls_base_prefix(text) from public;
revoke all on function public.hls_enqueue_transcode_job(text, text, text, text, text, integer, text[], integer, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.hls_claim_next_job(text) from public, anon, authenticated;
revoke all on function public.hls_enqueue_profile_upgrades(integer, text, integer) from public, anon, authenticated;
revoke all on function public.hls_commit_transcode_job(uuid, text, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.hls_fail_transcode_job(uuid, text, uuid, bigint, text, integer) from public, anon, authenticated;
revoke all on function public.hls_claim_retired_prefixes(integer) from public, anon, authenticated;
revoke all on function public.hls_finish_retired_prefix(uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.hls_enqueue_transcode_job(text, text, text, text, text, integer, text[], integer, text, integer, boolean) to service_role;
grant execute on function public.hls_claim_next_job(text) to service_role;
grant execute on function public.hls_enqueue_profile_upgrades(integer, text, integer) to service_role;
grant execute on function public.hls_commit_transcode_job(uuid, text, uuid, bigint, jsonb) to service_role;
grant execute on function public.hls_fail_transcode_job(uuid, text, uuid, bigint, text, integer) to service_role;
grant execute on function public.hls_claim_retired_prefixes(integer) to service_role;
grant execute on function public.hls_finish_retired_prefix(uuid, boolean, text) to service_role;
