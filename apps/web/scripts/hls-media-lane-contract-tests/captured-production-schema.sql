-- Production schema that 20261119120000_hls_media_lane_leases.sql builds on,
-- captured read-only from production on 2026-11-19 (information_schema,
-- pg_indexes, pg_constraint, pg_trigger and pg_get_functiondef). A test
-- fixture only: never applied anywhere. Tables keep the columns, defaults and
-- checks these functions touch; functions and triggers are verbatim.

CREATE TABLE public.audio_visuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT 'fixture',
  video_type text NOT NULL DEFAULT 'music_video',
  current_version_id uuid,
  publication_state text NOT NULL DEFAULT 'draft',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audio_visual_asset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audio_visual_id uuid NOT NULL REFERENCES public.audio_visuals(id) ON DELETE CASCADE,
  master_r2_key text NOT NULL,
  source_analysis jsonb,
  complexity_analysis jsonb,
  quality_policy_version text,
  hdr_mode text CHECK ((hdr_mode = ANY (ARRAY['sdr'::text, 'hdr10'::text, 'hlg'::text])) OR (hdr_mode IS NULL)),
  peek_r2_key text,
  is_immediate_playable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'uploaded' CHECK (status = ANY (ARRAY['uploaded'::text, 'probing'::text, 'qc_failed'::text, 'analyzing'::text, 'planning'::text, 'encoding'::text, 'evaluating_quality'::text, 'packaging'::text, 'validating'::text, 'ready'::text, 'failed'::text])),
  storage_preflight jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz
);

CREATE TABLE public.audio_visual_renditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_version_id uuid NOT NULL REFERENCES public.audio_visual_asset_versions(id) ON DELETE CASCADE,
  codec_family text NOT NULL CHECK (codec_family = ANY (ARRAY['avc'::text, 'av1'::text])),
  resolution_label text NOT NULL,
  bit_depth integer NOT NULL DEFAULT 8 CHECK (bit_depth = ANY (ARRAY[8, 10])),
  hdr_mode text NOT NULL DEFAULT 'sdr' CHECK (hdr_mode = ANY (ARRAY['sdr'::text, 'hdr10'::text, 'hlg'::text])),
  hls_prefix text NOT NULL,
  vmaf_score numeric,
  cambi_score numeric,
  ssim_score numeric,
  encode_settings_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_version_id, codec_family, resolution_label, hdr_mode)
);

CREATE TABLE public.hls_transcode_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  track_slug text,
  release_type text NOT NULL DEFAULT 'singles',
  source_key text NOT NULL,
  hls_prefix text,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'complete'::text, 'failed'::text, 'cancelled'::text])),
  priority integer NOT NULL DEFAULT 5,
  bitrates text[] NOT NULL DEFAULT ARRAY['320k'::text, '160k'::text, '96k'::text, '64k'::text],
  segment_duration_secs integer NOT NULL DEFAULT 6,
  error_message text,
  attempt_count integer NOT NULL DEFAULT 0,
  worker_id text,
  queued_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  base_hls_prefix text NOT NULL,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  claim_token uuid,
  target_profile_version integer NOT NULL DEFAULT 3 CHECK (target_profile_version >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  job_type text NOT NULL DEFAULT 'audio' CHECK (job_type = ANY (ARRAY['audio'::text, 'video'::text, 'vault_video'::text])),
  asset_version_id uuid,
  heartbeat_at timestamptz,
  failure_category text CHECK ((failure_category IS NULL) OR (failure_category = ANY (ARRAY['VALIDATION_FAILURE'::text, 'INPUT_NOT_FOUND'::text, 'PROBE_FAILURE'::text, 'FFMPEG_FAILURE'::text, 'RESOURCE_EXHAUSTION'::text, 'OUTPUT_VALIDATION_FAILURE'::text, 'UPLOAD_FAILURE'::text, 'LEASE_LOST'::text, 'CANCELED'::text, 'UNKNOWN'::text]))),
  CONSTRAINT hls_transcode_jobs_identity_by_type_check CHECK (((job_type = 'audio'::text) AND (slug IS NOT NULL)) OR ((job_type = 'video'::text) AND (asset_version_id IS NOT NULL)) OR ((job_type = 'vault_video'::text) AND (slug IS NOT NULL)))
);
CREATE UNIQUE INDEX idx_hls_transcode_jobs_unique_track ON public.hls_transcode_jobs USING btree (slug, COALESCE(track_slug, ''::text));

CREATE TABLE public.hls_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  track_slug text,
  release_type text NOT NULL DEFAULT 'singles',
  hls_prefix text NOT NULL,
  bitrates text[] NOT NULL DEFAULT ARRAY['320k'::text, '160k'::text, '96k'::text],
  segment_duration_secs integer NOT NULL DEFAULT 6,
  duration_seconds numeric,
  segment_counts jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  poster_key text,
  poster_status text CHECK (poster_status = ANY (ARRAY['ready'::text, 'needs_poster'::text])),
  vtt_key text,
  media_kind text NOT NULL DEFAULT 'audio' CHECK (media_kind = ANY (ARRAY['audio'::text, 'video'::text])),
  segment_durations jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(segment_durations) = 'object'::text),
  rendition_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rendition_metadata) = 'object'::text),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'::text),
  transcode_profile_version integer NOT NULL DEFAULT 1 CHECK (transcode_profile_version >= 1),
  active_generation bigint NOT NULL DEFAULT 0 CHECK (active_generation >= 0),
  activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_hls_manifests_unique_track ON public.hls_manifests USING btree (slug, COALESCE(track_slug, ''::text));

CREATE TABLE public.hls_retired_prefixes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  track_slug text,
  hls_prefix text NOT NULL UNIQUE,
  generation bigint NOT NULL CHECK (generation >= 0),
  retired_at timestamptz NOT NULL DEFAULT now(),
  delete_after timestamptz NOT NULL DEFAULT (now() + '48:00:00'::interval),
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'deleting'::text, 'deleted'::text, 'failed'::text])),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error text,
  deleted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.hls_base_prefix(p_prefix text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.hls_prepare_job_generation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.hls_retire_deleted_job_prefix()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.hls_commit_transcode_job(p_job_id uuid, p_worker_id text, p_claim_token uuid, p_generation bigint, p_manifest jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.hls_fail_transcode_job(p_job_id uuid, p_worker_id text, p_claim_token uuid, p_generation bigint, p_error_message text, p_max_attempts integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.promote_audio_visual_version(p_audio_visual_id uuid, p_asset_version_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_status text;
  v_owner_id uuid;
begin
  select status, audio_visual_id into v_status, v_owner_id
  from audio_visual_asset_versions
  where id = p_asset_version_id
  for update;

  if v_owner_id is null then
    raise exception 'promote_audio_visual_version: asset version % does not exist', p_asset_version_id;
  end if;

  if v_owner_id != p_audio_visual_id then
    raise exception 'promote_audio_visual_version: asset version % does not belong to audio_visual %', p_asset_version_id, p_audio_visual_id;
  end if;

  if v_status != 'ready' then
    raise exception 'promote_audio_visual_version: asset version % has status % — only a version with status ''ready'' may be promoted', p_asset_version_id, v_status;
  end if;

  update audio_visual_asset_versions
  set promoted_at = now()
  where id = p_asset_version_id;

  update audio_visuals
  set current_version_id = p_asset_version_id,
      publication_state = case when publication_state in ('draft', 'processing') then 'ready' else publication_state end,
      updated_at = now()
  where id = p_audio_visual_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.hls_claim_next_job(p_worker_id text, p_job_type text)
 RETURNS hls_transcode_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_job hls_transcode_jobs;
begin
  if p_job_type not in ('audio', 'video', 'vault_video') then
    raise exception 'invalid job_type: %', p_job_type;
  end if;

  select * into v_job from hls_transcode_jobs
   where status = 'pending' and job_type = p_job_type
   order by priority asc, created_at asc
   limit 1 for update skip locked;

  if not found then return null; end if;

  update hls_transcode_jobs
     set status = 'processing', worker_id = p_worker_id,
         started_at = now(), heartbeat_at = now()
   where id = v_job.id;

  v_job.status := 'processing';
  v_job.worker_id := p_worker_id;
  v_job.started_at := now();
  v_job.heartbeat_at := now();
  return v_job;
end;
$function$;

CREATE TRIGGER trg_hls_prepare_job_generation BEFORE INSERT OR UPDATE ON public.hls_transcode_jobs FOR EACH ROW EXECUTE FUNCTION hls_prepare_job_generation();
CREATE TRIGGER trg_hls_retire_deleted_job_prefix BEFORE DELETE ON public.hls_transcode_jobs FOR EACH ROW EXECUTE FUNCTION hls_retire_deleted_job_prefix();
