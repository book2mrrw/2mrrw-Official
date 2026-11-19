-- Leases for the two video lanes of hls_transcode_jobs: job_type 'video'
-- (Audio Visualz: music videos, short films, documentaries) and 'vault_video'.
--
-- Before this, both lanes claimed through hls_claim_next_job without a lease
-- token, renewed by job id alone and published with plain writes. A worker
-- whose job had been rescued and handed to another worker could still publish
-- over it; vault jobs were never rescued at all (the website cron only covers
-- audio and video); and a rescue never counted an attempt, so a source that
-- killed its worker was retried forever. Recovery also depended on a website
-- cron instead of on the lanes themselves.
--
-- Now each claim issues a fresh lease token and counts the attempt; the claim
-- itself retries any lease nobody renewed for five minutes (or fails it after
-- three attempts); every write a worker makes — heartbeat, progress,
-- publication, failure, release — names its worker, token and generation and
-- is refused once the job has moved on; and a music video's publication
-- (renditions, ready, promotion, job complete) is one transaction.
--
-- Untouched: hls_claim_next_job (the audio lane's contract ships separately),
-- hls_commit_transcode_job (the vault lane publishes through it as is) and the
-- trigger trg_hls_prepare_job_generation, which already gives every retry a
-- new generation and prefix and clears the token.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.hls_commit_transcode_job(uuid,text,uuid,bigint,jsonb)') IS NULL
     OR to_regprocedure('public.promote_audio_visual_version(uuid,uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hls_prepare_job_generation') THEN
    RAISE EXCEPTION 'the versioned HLS job contract must be installed first';
  END IF;
END;
$$;

-- Claim the next job of one video lane. Returns NULL when there is none.
CREATE OR REPLACE FUNCTION public.hls_claim_media_job(p_worker_id text, p_job_type text)
RETURNS public.hls_transcode_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_lease CONSTANT interval := interval '5 minutes';
  c_max_attempts CONSTANT integer := 3;
  v_job public.hls_transcode_jobs;
BEGIN
  IF p_job_type IS NULL OR p_job_type NOT IN ('video', 'vault_video') THEN
    RAISE EXCEPTION 'invalid media job_type: %', p_job_type;
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'worker identity required';
  END IF;

  -- A lease nobody renewed for five minutes: its worker is gone. The job goes
  -- back to pending under a new generation, or fails after three attempts.
  WITH expired AS (
    SELECT id FROM public.hls_transcode_jobs
     WHERE job_type = p_job_type AND status = 'processing'
       AND coalesce(heartbeat_at, started_at, updated_at) < now() - c_lease
       FOR UPDATE SKIP LOCKED
  ), lost AS (
    UPDATE public.hls_transcode_jobs j
       SET status = CASE WHEN j.attempt_count >= c_max_attempts THEN 'failed' ELSE 'pending' END,
           error_message = 'lease expired: ' || coalesce(j.worker_id, 'a worker') || ' stopped renewing it',
           failure_category = 'LEASE_LOST',
           worker_id = NULL, started_at = NULL, heartbeat_at = NULL,
           completed_at = CASE WHEN j.attempt_count >= c_max_attempts THEN now() ELSE NULL END
      FROM expired
     WHERE j.id = expired.id
    RETURNING j.asset_version_id, j.status
  )
  UPDATE public.audio_visual_asset_versions v
     SET status = 'failed'
    FROM lost
   WHERE lost.status = 'failed' AND v.id = lost.asset_version_id AND v.status <> 'ready';

  SELECT * INTO v_job
    FROM public.hls_transcode_jobs
   WHERE status = 'pending' AND job_type = p_job_type
   ORDER BY priority ASC, created_at ASC, id ASC
   LIMIT 1
     FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.hls_transcode_jobs
     SET status = 'processing', worker_id = p_worker_id,
         started_at = now(), heartbeat_at = now(),
         claim_token = gen_random_uuid(),
         attempt_count = coalesce(attempt_count, 0) + 1
   WHERE id = v_job.id
   RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

-- Renew a lease. False: the job is no longer this worker's.
CREATE OR REPLACE FUNCTION public.hls_heartbeat_media_job(
  p_job_id uuid, p_worker_id text, p_claim_token uuid, p_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.hls_transcode_jobs
     SET heartbeat_at = now()
   WHERE id = p_job_id AND status = 'processing' AND job_type IN ('video', 'vault_video')
     AND worker_id = p_worker_id AND claim_token = p_claim_token AND generation = p_generation;
  RETURN FOUND;
END;
$$;

-- The lease row if p_* still holds it (locked until the caller's transaction ends).
CREATE OR REPLACE FUNCTION public.hls_held_media_job(
  p_job_id uuid, p_worker_id text, p_claim_token uuid, p_generation bigint
)
RETURNS public.hls_transcode_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.hls_transcode_jobs;
BEGIN
  SELECT * INTO v_job FROM public.hls_transcode_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND
     OR v_job.job_type NOT IN ('video', 'vault_video')
     OR v_job.status <> 'processing'
     OR v_job.worker_id IS DISTINCT FROM p_worker_id
     OR v_job.claim_token IS DISTINCT FROM p_claim_token
     OR v_job.generation IS DISTINCT FROM p_generation THEN
    RETURN NULL;
  END IF;
  RETURN v_job;
END;
$$;

-- A music video's analysis, recorded once its master passed the checks.
CREATE OR REPLACE FUNCTION public.hls_video_job_encoding(
  p_job_id uuid, p_worker_id text, p_claim_token uuid, p_generation bigint, p_analysis jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.hls_transcode_jobs;
BEGIN
  v_job := public.hls_held_media_job(p_job_id, p_worker_id, p_claim_token, p_generation);
  IF v_job.id IS NULL OR v_job.job_type <> 'video' THEN
    RETURN false;
  END IF;
  UPDATE public.audio_visual_asset_versions
     SET status = 'encoding',
         source_analysis = p_analysis->'source_analysis',
         complexity_analysis = p_analysis->'complexity_analysis',
         storage_preflight = p_analysis->'storage_preflight',
         hdr_mode = coalesce(nullif(p_analysis->>'hdr_mode', ''), 'sdr')
   WHERE id = v_job.asset_version_id;
  UPDATE public.hls_transcode_jobs SET heartbeat_at = now() WHERE id = v_job.id;
  RETURN true;
END;
$$;

-- Publish a music video in one transaction: its renditions, ready, promotion
-- (the version every page plays) and the job complete. Only the lease holder,
-- and only files under this generation's folder (.../<version>/g<generation>/).
CREATE OR REPLACE FUNCTION public.hls_commit_video_job(
  p_job_id uuid, p_worker_id text, p_claim_token uuid, p_generation bigint,
  p_renditions jsonb, p_peek_r2_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.hls_transcode_jobs;
  v_audio_visual_id uuid;
  v_folder text;
BEGIN
  v_job := public.hls_held_media_job(p_job_id, p_worker_id, p_claim_token, p_generation);
  IF v_job.id IS NULL OR v_job.job_type <> 'video' THEN
    RETURN jsonb_build_object('committed', false, 'reason', 'superseded');
  END IF;

  IF jsonb_typeof(p_renditions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_renditions) NOT BETWEEN 1 AND 16 THEN
    RAISE EXCEPTION 'a video publishes 1 to 16 renditions';
  END IF;
  v_folder := '%/' || v_job.asset_version_id::text || '/g' || v_job.generation::text || '/%';
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_renditions) r
     WHERE coalesce(r->>'hls_prefix', '') NOT LIKE v_folder
        OR coalesce(r->>'hls_prefix', '') LIKE '%..%'
        OR right(r->>'hls_prefix', 1) <> '/'
  ) OR (p_peek_r2_key IS NOT NULL AND (p_peek_r2_key NOT LIKE v_folder OR p_peek_r2_key LIKE '%..%')) THEN
    RAISE EXCEPTION 'renditions must be this generation''s files';
  END IF;

  SELECT audio_visual_id INTO v_audio_visual_id
    FROM public.audio_visual_asset_versions
   WHERE id = v_job.asset_version_id
     FOR UPDATE;
  IF v_audio_visual_id IS NULL THEN
    RAISE EXCEPTION 'asset version % does not exist', v_job.asset_version_id;
  END IF;

  DELETE FROM public.audio_visual_renditions WHERE asset_version_id = v_job.asset_version_id;
  INSERT INTO public.audio_visual_renditions (
    asset_version_id, codec_family, resolution_label, bit_depth, hdr_mode,
    hls_prefix, vmaf_score, cambi_score, ssim_score
  )
  SELECT v_job.asset_version_id, r->>'codec_family', r->>'resolution_label',
         coalesce((r->>'bit_depth')::integer, 8), coalesce(nullif(r->>'hdr_mode', ''), 'sdr'),
         r->>'hls_prefix', (r->>'vmaf_score')::numeric, (r->>'cambi_score')::numeric, (r->>'ssim_score')::numeric
    FROM jsonb_array_elements(p_renditions) r;

  UPDATE public.audio_visual_asset_versions
     SET status = 'ready', peek_r2_key = p_peek_r2_key
   WHERE id = v_job.asset_version_id;
  PERFORM public.promote_audio_visual_version(v_audio_visual_id, v_job.asset_version_id);

  UPDATE public.hls_transcode_jobs
     SET status = 'complete', completed_at = now(), error_message = NULL, failure_category = NULL
   WHERE id = v_job.id;

  RETURN jsonb_build_object('committed', true, 'generation', v_job.generation,
                            'asset_version_id', v_job.asset_version_id, 'audio_visual_id', v_audio_visual_id);
END;
$$;

-- A failed attempt: retried under a new generation while attempts remain and
-- the failure is retryable, otherwise failed for good (a music video's version
-- with it, unless it is already serving).
CREATE OR REPLACE FUNCTION public.hls_fail_media_job(
  p_job_id uuid, p_worker_id text, p_claim_token uuid, p_generation bigint,
  p_error_message text, p_failure_category text, p_retryable boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_max_attempts CONSTANT integer := 3;
  v_job public.hls_transcode_jobs;
  v_final boolean;
BEGIN
  v_job := public.hls_held_media_job(p_job_id, p_worker_id, p_claim_token, p_generation);
  IF v_job.id IS NULL THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'superseded');
  END IF;

  v_final := NOT coalesce(p_retryable, true) OR v_job.attempt_count >= c_max_attempts;
  UPDATE public.hls_transcode_jobs
     SET status = CASE WHEN v_final THEN 'failed' ELSE 'pending' END,
         error_message = left(coalesce(nullif(p_error_message, ''), 'transcode failed'), 4000),
         failure_category = CASE
           WHEN p_failure_category IN ('VALIDATION_FAILURE', 'INPUT_NOT_FOUND', 'PROBE_FAILURE', 'FFMPEG_FAILURE',
                                       'RESOURCE_EXHAUSTION', 'OUTPUT_VALIDATION_FAILURE', 'UPLOAD_FAILURE',
                                       'LEASE_LOST', 'CANCELED', 'UNKNOWN')
           THEN p_failure_category ELSE 'UNKNOWN' END,
         worker_id = NULL, started_at = NULL, heartbeat_at = NULL,
         completed_at = CASE WHEN v_final THEN now() ELSE NULL END
   WHERE id = v_job.id
   RETURNING * INTO v_job;

  IF v_final AND v_job.asset_version_id IS NOT NULL THEN
    UPDATE public.audio_visual_asset_versions
       SET status = 'failed'
     WHERE id = v_job.asset_version_id AND status <> 'ready';
  END IF;

  RETURN jsonb_build_object('updated', true, 'status', v_job.status,
                            'attempt_count', v_job.attempt_count, 'generation', v_job.generation);
END;
$$;

-- A worker shutting down hands its job straight back (no five-minute wait),
-- without spending the attempt: moving a lane between hosts costs nothing.
CREATE OR REPLACE FUNCTION public.hls_release_media_job(
  p_job_id uuid, p_worker_id text, p_claim_token uuid, p_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.hls_transcode_jobs;
BEGIN
  v_job := public.hls_held_media_job(p_job_id, p_worker_id, p_claim_token, p_generation);
  IF v_job.id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.hls_transcode_jobs
     SET status = 'pending',
         attempt_count = greatest(attempt_count - 1, 0),
         error_message = 'released by ' || p_worker_id || ' (shutdown)',
         worker_id = NULL, started_at = NULL, heartbeat_at = NULL, completed_at = NULL
   WHERE id = v_job.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.hls_claim_media_job(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hls_heartbeat_media_job(uuid, text, uuid, bigint) FROM PUBLIC, anon, authenticated;
-- Internal: only the lane functions above call it (as their owner).
REVOKE ALL ON FUNCTION public.hls_held_media_job(uuid, text, uuid, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.hls_video_job_encoding(uuid, text, uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hls_commit_video_job(uuid, text, uuid, bigint, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hls_fail_media_job(uuid, text, uuid, bigint, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hls_release_media_job(uuid, text, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hls_claim_media_job(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hls_heartbeat_media_job(uuid, text, uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.hls_video_job_encoding(uuid, text, uuid, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.hls_commit_video_job(uuid, text, uuid, bigint, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hls_fail_media_job(uuid, text, uuid, bigint, text, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.hls_release_media_job(uuid, text, uuid, bigint) TO service_role;

COMMIT;
