-- Atomic audio-master replacement authority.
--
-- A replacement is uploaded and transcoded under immutable revision-scoped
-- object prefixes.  The public master pointer and public HLS manifest move
-- together only after every expected rendition has been produced.

CREATE TABLE IF NOT EXISTS public.audio_master_revisions (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_ref_id             uuid NOT NULL,
  release_source             text NOT NULL CHECK (release_source IN ('releases', 'catalog')),
  entity_kind                text NOT NULL CHECK (entity_kind IN ('track', 'catalog_track', 'product')),
  entity_id                  uuid NOT NULL,
  release_slug               text NOT NULL,
  track_slug                 text,
  release_type               text NOT NULL,
  staged_master_key          text NOT NULL UNIQUE,
  previous_master_key        text,
  previous_storage_path      text,
  hls_prefix                 text NOT NULL,
  previous_hls_prefix        text,
  hls_job_id                 uuid,
  original_filename          text NOT NULL,
  content_type               text NOT NULL,
  byte_size                  bigint NOT NULL CHECK (byte_size > 0),
  status                     text NOT NULL DEFAULT 'uploading'
                             CHECK (status IN (
                               'uploading', 'uploaded', 'processing', 'ready',
                               'promoting', 'active', 'failed', 'cancelled', 'retired'
                             )),
  requested_by               text NOT NULL,
  error_message              text,
  uploaded_at                timestamptz,
  processing_at              timestamptz,
  ready_at                   timestamptz,
  promoted_at                timestamptz,
  failed_at                  timestamptz,
  retire_after               timestamptz,
  previous_assets_retired_at timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hls_transcode_jobs
  ADD COLUMN IF NOT EXISTS master_revision_id uuid
  REFERENCES public.audio_master_revisions(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'audio_master_revisions_hls_job_id_fkey'
  ) THEN
    ALTER TABLE public.audio_master_revisions
      ADD CONSTRAINT audio_master_revisions_hls_job_id_fkey
      FOREIGN KEY (hls_job_id) REFERENCES public.hls_transcode_jobs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- A normal refresh keeps its historical one-job-per-track behavior. Revision
-- jobs are independently immutable, so a replacement never rewrites a job a
-- worker may already be processing.
DROP INDEX IF EXISTS public.idx_hls_transcode_jobs_unique_track;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hls_transcode_jobs_unique_track_standard
  ON public.hls_transcode_jobs (slug, COALESCE(track_slug, ''))
  WHERE master_revision_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_hls_transcode_jobs_unique_revision
  ON public.hls_transcode_jobs (master_revision_id)
  WHERE master_revision_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_master_revisions_one_inflight
  ON public.audio_master_revisions (entity_kind, entity_id)
  WHERE status IN ('uploading', 'uploaded', 'processing', 'ready', 'promoting');
CREATE INDEX IF NOT EXISTS idx_audio_master_revisions_release
  ON public.audio_master_revisions (release_ref_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_master_revisions_retirement
  ON public.audio_master_revisions (retire_after)
  WHERE status IN ('active', 'retired') AND previous_assets_retired_at IS NULL;

DROP TRIGGER IF EXISTS audio_master_revisions_updated_at ON public.audio_master_revisions;
CREATE TRIGGER audio_master_revisions_updated_at
  BEFORE UPDATE ON public.audio_master_revisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.audio_master_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS no_public_access ON public.audio_master_revisions;
CREATE POLICY no_public_access ON public.audio_master_revisions
  FOR ALL TO public USING (false) WITH CHECK (false);

-- Called after the server has verified the uploaded R2 object's exact key,
-- length, and content type. The revision row and immutable HLS job are bound in
-- one database transaction.
CREATE OR REPLACE FUNCTION public.queue_audio_master_revision(
  p_revision_id uuid,
  p_queued_by text
)
RETURNS public.hls_transcode_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revision public.audio_master_revisions;
  v_job public.hls_transcode_jobs;
BEGIN
  SELECT * INTO v_revision
    FROM public.audio_master_revisions
   WHERE id = p_revision_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audio master revision not found';
  END IF;

  IF v_revision.status NOT IN ('uploading', 'uploaded') THEN
    RAISE EXCEPTION 'audio master revision cannot be queued from status %', v_revision.status;
  END IF;

  IF v_revision.hls_job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM public.hls_transcode_jobs WHERE id = v_revision.hls_job_id;
    RETURN v_job;
  END IF;

  UPDATE public.audio_master_revisions
     SET status = 'uploaded', uploaded_at = COALESCE(uploaded_at, now())
   WHERE id = v_revision.id;

  INSERT INTO public.hls_transcode_jobs (
    slug, track_slug, release_type, source_key, hls_prefix, status,
    attempt_count, queued_by, master_revision_id
  ) VALUES (
    v_revision.release_slug, v_revision.track_slug, v_revision.release_type,
    v_revision.staged_master_key, v_revision.hls_prefix, 'pending', 0,
    p_queued_by, v_revision.id
  ) RETURNING * INTO v_job;

  UPDATE public.audio_master_revisions
     SET status = 'processing', processing_at = now(), hls_job_id = v_job.id,
         error_message = NULL
   WHERE id = v_revision.id;

  RETURN v_job;
END;
$$;

-- Worker completion authority. Validation, manifest switch, stable entity
-- pointer update, revision retirement, and job completion commit atomically.
CREATE OR REPLACE FUNCTION public.promote_audio_master_revision(
  p_job_id uuid,
  p_bitrates text[],
  p_segment_duration_secs integer,
  p_duration_seconds numeric,
  p_segment_counts jsonb
)
RETURNS public.audio_master_revisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.hls_transcode_jobs;
  v_revision public.audio_master_revisions;
  v_manifest_id uuid;
  v_previous_hls_prefix text;
  v_bitrate text;
  v_storage_path text;
  v_rows integer;
BEGIN
  SELECT * INTO v_job
    FROM public.hls_transcode_jobs
   WHERE id = p_job_id
   FOR UPDATE;

  IF NOT FOUND OR v_job.master_revision_id IS NULL THEN
    RAISE EXCEPTION 'replacement HLS job not found';
  END IF;

  SELECT * INTO v_revision
    FROM public.audio_master_revisions
   WHERE id = v_job.master_revision_id
   FOR UPDATE;

  IF v_revision.status = 'active' AND v_job.status = 'complete' THEN
    RETURN v_revision;
  END IF;
  IF v_revision.status NOT IN ('processing', 'ready', 'promoting') THEN
    RAISE EXCEPTION 'audio master revision cannot be promoted from status %', v_revision.status;
  END IF;
  IF v_job.status <> 'processing' THEN
    RAISE EXCEPTION 'HLS job cannot promote from status %', v_job.status;
  END IF;
  IF v_job.source_key <> v_revision.staged_master_key
     OR v_job.hls_prefix <> v_revision.hls_prefix THEN
    RAISE EXCEPTION 'replacement job does not match its immutable revision';
  END IF;
  IF p_duration_seconds IS NULL OR p_duration_seconds <= 0
     OR COALESCE(array_length(p_bitrates, 1), 0) = 0
     OR p_segment_counts IS NULL THEN
    RAISE EXCEPTION 'replacement HLS output is incomplete';
  END IF;

  FOREACH v_bitrate IN ARRAY p_bitrates LOOP
    IF COALESCE((p_segment_counts ->> v_bitrate)::integer, 0) <= 0 THEN
      RAISE EXCEPTION 'replacement HLS rendition % has no segments', v_bitrate;
    END IF;
  END LOOP;

  UPDATE public.audio_master_revisions
     SET status = 'promoting', ready_at = COALESCE(ready_at, now())
   WHERE id = v_revision.id;

  SELECT id, hls_prefix INTO v_manifest_id, v_previous_hls_prefix
    FROM public.hls_manifests
   WHERE slug = v_revision.release_slug
     AND track_slug IS NOT DISTINCT FROM v_revision.track_slug
   FOR UPDATE;

  IF v_manifest_id IS NULL THEN
    INSERT INTO public.hls_manifests (
      slug, track_slug, release_type, hls_prefix, bitrates,
      segment_duration_secs, duration_seconds, segment_counts
    ) VALUES (
      v_revision.release_slug, v_revision.track_slug, v_revision.release_type,
      v_revision.hls_prefix, p_bitrates, p_segment_duration_secs,
      p_duration_seconds, p_segment_counts
    );
  ELSE
    UPDATE public.hls_manifests
       SET release_type = v_revision.release_type,
           hls_prefix = v_revision.hls_prefix,
           bitrates = p_bitrates,
           segment_duration_secs = p_segment_duration_secs,
           duration_seconds = p_duration_seconds,
           segment_counts = p_segment_counts,
           updated_at = now()
     WHERE id = v_manifest_id;
  END IF;

  v_storage_path := regexp_replace(v_revision.staged_master_key, '[^/]+$', '');

  IF v_revision.entity_kind = 'track' THEN
    UPDATE public.tracks
       SET audio_r2_key = v_revision.staged_master_key,
           master_r2_key = v_revision.staged_master_key,
           master_history = COALESCE(master_history, '[]'::jsonb) ||
             CASE WHEN v_revision.previous_master_key IS NULL THEN '[]'::jsonb ELSE
               jsonb_build_array(jsonb_build_object(
                 'key', v_revision.previous_master_key,
                 'replaced_at', now(),
                 'revision_id', v_revision.id
               )) END,
           upload_status = 'ready'
     WHERE id = v_revision.entity_id
       AND audio_r2_key IS NOT DISTINCT FROM v_revision.previous_master_key;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'active master changed while replacement was processing';
    END IF;

    -- Published wizard releases are projected into products/catalog_tracks.
    -- Move that resolver authority in the same transaction as the track row.
    IF v_revision.track_slug IS NULL THEN
      UPDATE public.products
         SET storage_path = v_storage_path,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
               'audio_key', v_revision.staged_master_key,
               'audio_revision', v_revision.id,
               'audio_replaced_at', now()
             ),
             updated_at = now()
       WHERE release_id = v_revision.release_ref_id
         AND (
           v_revision.previous_storage_path IS NULL
           OR storage_path IS NOT DISTINCT FROM v_revision.previous_storage_path
         );
      GET DIAGNOSTICS v_rows = ROW_COUNT;
    ELSE
      UPDATE public.catalog_tracks
         SET storage_path = v_storage_path,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
               'audio_key', v_revision.staged_master_key,
               'audio_revision', v_revision.id,
               'audio_replaced_at', now()
             )
       WHERE track_id = v_revision.entity_id
         AND (
           v_revision.previous_storage_path IS NULL
           OR storage_path IS NOT DISTINCT FROM v_revision.previous_storage_path
         );
      GET DIAGNOSTICS v_rows = ROW_COUNT;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.releases
       WHERE id = v_revision.release_ref_id
         AND status <> 'draft'
    ) AND v_rows <> 1 THEN
      RAISE EXCEPTION 'public storefront projection changed while replacement was processing';
    END IF;
  ELSIF v_revision.entity_kind = 'catalog_track' THEN
    UPDATE public.catalog_tracks
       SET storage_path = v_storage_path,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'audio_key', v_revision.staged_master_key,
             'audio_revision', v_revision.id,
             'audio_replaced_at', now()
           )
     WHERE id = v_revision.entity_id
       AND storage_path IS NOT DISTINCT FROM v_revision.previous_storage_path;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'active master changed while replacement was processing';
    END IF;
  ELSIF v_revision.entity_kind = 'product' THEN
    UPDATE public.products
       SET storage_path = v_storage_path,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'audio_key', v_revision.staged_master_key,
             'audio_revision', v_revision.id,
             'audio_replaced_at', now()
           ),
           updated_at = now()
     WHERE id = v_revision.entity_id
       AND storage_path IS NOT DISTINCT FROM v_revision.previous_storage_path;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'active master changed while replacement was processing';
    END IF;
  END IF;

  UPDATE public.audio_master_revisions
     SET status = 'retired', updated_at = now()
   WHERE entity_kind = v_revision.entity_kind
     AND entity_id = v_revision.entity_id
     AND id <> v_revision.id
     AND status = 'active';

  UPDATE public.audio_master_revisions
     SET status = 'active', promoted_at = now(),
         previous_hls_prefix = COALESCE(previous_hls_prefix, v_previous_hls_prefix),
         retire_after = now() + interval '7 days', error_message = NULL
   WHERE id = v_revision.id
   RETURNING * INTO v_revision;

  UPDATE public.hls_transcode_jobs
     SET status = 'complete', completed_at = now(), error_message = NULL
   WHERE id = v_job.id;

  RETURN v_revision;
END;
$$;

REVOKE ALL ON public.audio_master_revisions FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.queue_audio_master_revision(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_audio_master_revision(uuid, text[], integer, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_audio_master_revision(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_audio_master_revision(uuid, text[], integer, numeric, jsonb) TO service_role;
