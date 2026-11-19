-- The audio lane joins the video lanes' leases (20261119120000), so it can
-- leave Fly keyless like them: hls_claim_media_job now also hands out
-- job_type 'audio' — a fresh lease token per claim, the attempt counted, a
-- lease nobody renewed for five minutes retried (or failed after three) by
-- the claim itself — and every fenced lane function accepts an audio lease.
-- Audio publishes through hls_commit_transcode_job, the fenced commit that
-- was built for it.
--
-- Untouched: hls_claim_next_job. The legacy audio worker still on Fly keeps
-- claiming through it (no token, legacy completion) until it is stopped; both
-- claims lock with SKIP LOCKED, so each job goes to exactly one of them, and
-- a legacy job keeps renewing heartbeat_at, so the lane claim never takes it.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.hls_claim_media_job(text,text)') IS NULL
     OR to_regprocedure('public.hls_commit_transcode_job(uuid,text,uuid,bigint,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'the media lane leases must be installed first';
  END IF;
END;
$$;

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
  IF p_job_type IS NULL OR p_job_type NOT IN ('audio', 'video', 'vault_video') THEN
    RAISE EXCEPTION 'invalid media job_type: %', p_job_type;
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'worker identity required';
  END IF;

  -- A lease nobody renewed for five minutes: its worker is gone. The job goes
  -- back to pending under a new generation, or fails after three attempts.
  -- Only leased jobs (a claim token): a legacy claim is never taken over.
  WITH expired AS (
    SELECT id FROM public.hls_transcode_jobs
     WHERE job_type = p_job_type AND status = 'processing' AND claim_token IS NOT NULL
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
   WHERE id = p_job_id AND status = 'processing' AND job_type IN ('audio', 'video', 'vault_video')
     AND worker_id = p_worker_id AND claim_token = p_claim_token AND generation = p_generation;
  RETURN FOUND;
END;
$$;

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
     OR v_job.job_type NOT IN ('audio', 'video', 'vault_video')
     OR v_job.status <> 'processing'
     OR v_job.worker_id IS DISTINCT FROM p_worker_id
     OR v_job.claim_token IS DISTINCT FROM p_claim_token
     OR v_job.generation IS DISTINCT FROM p_generation THEN
    RETURN NULL;
  END IF;
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.hls_media_lease_live(p_job_id uuid, p_claim_token uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hls_transcode_jobs
     WHERE id = p_job_id AND status = 'processing' AND claim_token = p_claim_token
       AND job_type IN ('audio', 'video', 'vault_video')
  );
$$;

COMMIT;
