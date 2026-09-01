-- Phase 5.2 Stage 2 — Stream asset registration metadata (additive, non-destructive).
-- Masters and existing storage_path / preview_path columns unchanged.
-- Rollback notes at bottom.

begin;

alter table public.products
  add column if not exists stream_path text,
  add column if not exists stream_key text;

alter table public.catalog_tracks
  add column if not exists stream_path text,
  add column if not exists stream_key text;

comment on column public.products.stream_path is
  'Canonical R2 entity folder for AAC stream rendition — streaming/{releaseType}/{entity}/';

comment on column public.products.stream_key is
  'Full R2 object key for stream playback — streaming/…/{slug}.m4a or {slug}_192.m4a (hq tier)';

comment on column public.catalog_tracks.stream_path is
  'Per-track stream entity folder under streaming/{releaseType}/{album}/{track}/';

comment on column public.catalog_tracks.stream_key is
  'Per-track stream object key — streaming/…/{track-slug}.m4a';

-- Document expected metadata keys (products.metadata / catalog sync payloads).
comment on table public.products is
  'Commerce catalog. Stream metadata keys (optional): stream_path, stream_key, stream_path_relative, stream_asset_role (stream_audio), stream_format (aac-lc), stream_container (m4a), stream_quality (standard|hq).';

commit;

-- ── Rollback (manual; not auto-run) ───────────────────────────────────────────
-- alter table public.products drop column if exists stream_path, drop column if exists stream_key;
-- alter table public.catalog_tracks drop column if exists stream_path, drop column if exists stream_key;
-- No data loss for masters — columns are nullable and unused until Stage 3+ backfill.
