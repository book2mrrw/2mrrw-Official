-- Apply before deploying the audio worker that publishes measured metadata.
-- Existing manifests remain NULL and retain the existing playlist fallback.
alter table public.hls_manifests
  add column if not exists rendition_metadata jsonb;
