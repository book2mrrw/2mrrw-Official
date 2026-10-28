-- Apply before deploying the fenced audio worker. No active job or published
-- manifest is changed; this repairs the lease returned by future audio claims.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.hls_commit_transcode_job(uuid,text,uuid,bigint,jsonb)') IS NULL
     OR to_regprocedure('public.hls_fail_transcode_job(uuid,text,uuid,bigint,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'Versioned HLS commit/failure contracts must be installed first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.hls_claim_next_job(p_worker_id text, p_job_type text)
RETURNS public.hls_transcode_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.hls_transcode_jobs;
BEGIN
  IF p_job_type NOT IN ('audio', 'video', 'vault_video') OR p_job_type IS NULL THEN
    RAISE EXCEPTION 'invalid job_type: %', p_job_type;
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'worker identity required';
  END IF;

  SELECT * INTO v_job
    FROM public.hls_transcode_jobs
   WHERE status = 'pending' AND job_type = p_job_type
   ORDER BY priority ASC, created_at ASC, id ASC
   LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE public.hls_transcode_jobs
     SET status = 'processing', worker_id = p_worker_id,
         started_at = now(), heartbeat_at = now(),
         claim_token = CASE WHEN p_job_type = 'audio' THEN gen_random_uuid() ELSE claim_token END,
         attempt_count = CASE WHEN p_job_type = 'audio' THEN coalesce(attempt_count, 0) + 1 ELSE attempt_count END
   WHERE id = v_job.id
   RETURNING * INTO v_job;

  -- Return the committed token, generation and trigger-updated fields. Returning
  -- the earlier SELECT row discards the lease needed by completion and failure.
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.hls_claim_next_job(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hls_claim_next_job(text,text) TO service_role;
COMMIT;
