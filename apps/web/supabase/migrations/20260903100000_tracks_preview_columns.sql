-- Fixes a real, deterministic bug in the multi-track (album/EP/mixtape)
-- preview pipeline: /api/admin/upload/complete previously wrote every
-- track's browser-derived preview key to the same release-scoped
-- releases.metadata.preview_r2_key field, with no per-track identity at
-- all. Whichever track's preview finished uploading last silently
-- overwrote every earlier track's key in that shared field, and the
-- publish route's top-level canonicalization (meant only for single/
-- feature releases) would then move THAT one track's real preview file to
-- a release-level path and delete the original — destroying it before the
-- per-track canonicalization loop could run, guaranteeing a first-publish
-- failure on any multi-track release that used the per-track preview
-- picker.
--
-- Mirrors the existing audio_r2_key/master_r2_key columns on this same
-- table — a preview is track-scoped data, so it belongs on the track's own
-- row, not borrowed space on the parent release.
alter table public.tracks
  add column if not exists preview_r2_key text,
  add column if not exists preview_start_seconds integer not null default 0;
