-- The video lanes' own database login, so the hosts that encode music videos,
-- vault videos and track visuals hold no service-role key: hls_media_worker
-- can call the lane functions (claim, renew, record, publish, fail, hand back)
-- and nothing else — no table, no other function. Storage links and content
-- keys come from the website per lease (/api/hls/lane-transfers), so a host's
-- only secret is this role's password: set outside migrations (ALTER ROLE ...
-- LOGIN PASSWORD '<SCRAM verifier>') and kept in that host's private settings
-- file. The same pattern as cover_art_worker (20261118190000_cover_art_lane).

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.hls_claim_media_job(text,text)') IS NULL
     OR to_regprocedure('public.claim_track_visual_job(text)') IS NULL
     OR to_regprocedure('public.complete_track_visual_job(uuid,uuid,jsonb,text)') IS NULL THEN
    RAISE EXCEPTION 'the video-lane lease functions must be installed first';
  END IF;
END;
$$;

-- Renew a track visual's lease (its worker used to write the table directly).
-- False: the job is no longer this worker's.
CREATE OR REPLACE FUNCTION public.heartbeat_track_visual_job(p_job_id uuid, p_worker_id text, p_lease_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.track_visual_jobs
     SET heartbeat_at = now()
   WHERE id = p_job_id AND status = 'processing' AND worker_id = p_worker_id AND lease_token = p_lease_token;
  RETURN FOUND;
END;
$$;

-- Whether a video-lane lease is still held: a booting host keeps the scratch
-- of a live lease (another worker sharing its volume) and removes the rest.
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
       AND job_type IN ('video', 'vault_video')
  );
$$;

REVOKE ALL ON FUNCTION public.heartbeat_track_visual_job(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hls_media_lease_live(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_track_visual_job(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hls_media_lease_live(uuid, uuid) TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hls_media_worker') THEN
    CREATE ROLE hls_media_worker NOLOGIN NOINHERIT;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA public TO hls_media_worker;
GRANT EXECUTE ON FUNCTION
  public.hls_claim_media_job(text, text),
  public.hls_heartbeat_media_job(uuid, text, uuid, bigint),
  public.hls_video_job_encoding(uuid, text, uuid, bigint, jsonb),
  public.hls_commit_video_job(uuid, text, uuid, bigint, jsonb, text),
  public.hls_fail_media_job(uuid, text, uuid, bigint, text, text, boolean),
  public.hls_release_media_job(uuid, text, uuid, bigint),
  public.hls_media_lease_live(uuid, uuid),
  public.hls_commit_transcode_job(uuid, text, uuid, bigint, jsonb),
  public.claim_track_visual_job(text),
  public.heartbeat_track_visual_job(uuid, text, uuid),
  public.complete_track_visual_job(uuid, uuid, jsonb, text)
  TO hls_media_worker;

COMMIT;
