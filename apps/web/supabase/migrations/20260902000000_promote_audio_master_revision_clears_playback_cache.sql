-- Root-cause fix: replacing a track's master audio silently didn't change what
-- played. promote_audio_master_revision() (20260901000000) already flips the
-- real pointers (tracks.audio_r2_key / catalog_tracks.storage_path /
-- products.storage_path) atomically. But resolvePlaybackKeyUncached()
-- (src/lib/playback/resolve-playback-key.js) checks a DURABLE, TTL-less cache
-- table — public.playback_key_resolution_cache — before ever looking at those
-- columns again, and that row was only ever cleared by a best-effort HTTP
-- webhook the transcoder worker fires after this function returns
-- (workers/hls-transcoder/src/db.js: markJobComplete). That webhook is skipped
-- entirely when APP_URL/HLS_WORKER_API_TOKEN aren't configured, and its
-- failure is only console.warn'd, never retried — so a stale row could shadow
-- a perfectly correct promotion forever, with nothing in the admin UI able to
-- detect it.
--
-- Fix: clear the cache entry inside this same atomic transaction, so the
-- pointer flip and the cache invalidation can never disagree. The worker's
-- webhook is left in place (it also invalidates the separate HLS manifest
-- cache and triggers storefront revalidation) but is no longer the only thing
-- standing between a promoted revision and it actually being audible.

begin;

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

  -- THE FIX: clear the durable playback-key cache in the SAME transaction as
  -- the pointer flip above. Without this, a fan who has ever streamed this
  -- track has a row in playback_key_resolution_cache that permanently shadows
  -- every future correct promotion, independent of whether the worker's
  -- best-effort completion webhook (workers/hls-transcoder/src/db.js) fires.
  DELETE FROM public.playback_key_resolution_cache
   WHERE cache_key = CASE
     WHEN v_revision.track_slug IS NULL THEN v_revision.release_slug
     ELSE v_revision.release_slug || ':' || v_revision.track_slug
   END;

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

commit;

-- ── Rollback (manual; not auto-run) ───────────────────────────────────────────
-- Re-apply 20260901000000_audio_master_revision_authority.sql's original
-- CREATE OR REPLACE FUNCTION public.promote_audio_master_revision(...) body
-- (without the playback_key_resolution_cache DELETE) to revert.
