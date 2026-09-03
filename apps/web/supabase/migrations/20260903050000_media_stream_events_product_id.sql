-- media_stream_events.product_slug is a bare track slug for multi-track
-- releases (catalog_tracks.slug), which is only unique WITHIN its own album
-- (unique(album_slug, slug)) — two different albums can legitimately share a
-- same-named track ("intro", "outro"). Historically there was no accompanying
-- identifier to disambiguate, so a per-track analytics query could silently
-- merge two unrelated tracks' stats.
--
-- product_id resolves this going forward: the analytics-event write path now
-- looks up the owning album/single's products.id at write time (via the
-- already-known albumSlug, or the track's own slug for singles) and stores it
-- alongside the existing product_slug. Nullable and left unbackfilled — rows
-- written before this migration remain best-effort via product_slug alone,
-- same as today.
alter table public.media_stream_events
  add column if not exists product_id uuid references public.products(id) on delete set null;

create index if not exists media_stream_events_product_id_idx
  on public.media_stream_events (product_id, event_type, created_at desc);
