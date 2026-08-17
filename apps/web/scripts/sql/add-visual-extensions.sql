-- Batch 2 Final Closeout — visual extensions
-- Run in Supabase SQL editor (Dashboard → SQL editor → New query)
--
-- Adds:
--   hls_manifests.poster_key    — R2 key of extracted static poster frame
--   hls_manifests.poster_status — "ready" | "needs_poster" | null (not yet extracted)
--   hls_manifests.vtt_key       — R2 key of WebVTT subtitle/caption file (nullable)
--
-- None of these columns block existing queries — all default to NULL.

ALTER TABLE hls_manifests
  ADD COLUMN IF NOT EXISTS poster_key    TEXT,
  ADD COLUMN IF NOT EXISTS poster_status TEXT CHECK (poster_status IN ('ready', 'needs_poster')),
  ADD COLUMN IF NOT EXISTS vtt_key       TEXT;

COMMENT ON COLUMN hls_manifests.poster_key    IS 'R2 key for the extracted static poster JPEG. Registered by /api/admin/media/extract-poster after ingest.';
COMMENT ON COLUMN hls_manifests.poster_status IS 'ready = poster extracted and uploaded. needs_poster = extraction attempted but failed or ffmpeg unavailable.';
COMMENT ON COLUMN hls_manifests.vtt_key       IS 'R2 key for the WebVTT subtitle/caption file. NULL = no captions available yet.';
