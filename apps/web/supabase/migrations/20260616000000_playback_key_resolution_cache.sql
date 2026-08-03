-- Persistent cache for resolvePlaybackKey's discovered R2 object key (additive, non-destructive).
-- Today, every cold request re-runs a live R2 folder discovery scan to find the master audio
-- file (see src/lib/playback/resolve-playback-key.js). That cost previously only avoided
-- re-payment via a 60s in-memory Map, which doesn't survive serverless cold starts or routing
-- to a different instance. This table makes the discovered key durable so it's paid once ever
-- per (slug, trackSlug), not once per cold instance.
--
-- Deliberately separate from products.stream_key / catalog_tracks.stream_key (Phase 5.2 hybrid
-- streaming, see 20260530160000_stream_asset_registration.sql) — those store an alternate AAC
-- stream rendition and are a different quality/format tier. This table only caches *where the
-- existing master file already lives*, so it can't change what's served.

begin;

create table if not exists public.playback_key_resolution_cache (
  cache_key text primary key,
  audio_key text not null,
  source text,
  playback_source text,
  entity_folder text,
  product_id uuid,
  resolved_at timestamptz not null default now()
);

comment on table public.playback_key_resolution_cache is
  'Durable cache of resolvePlaybackKey discovery results, keyed by "slug" or "slug:trackSlug". Avoids re-running R2 folder discovery on every cold serverless instance.';

commit;

-- ── Rollback (manual; not auto-run) ───────────────────────────────────────────
-- drop table if exists public.playback_key_resolution_cache;
