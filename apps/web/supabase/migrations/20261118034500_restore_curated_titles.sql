-- Restore curated release and track titles.
--
-- The R2 catalog ingest named every release and track after its storage folder
-- (w2d -> "W2d", 2-heavy -> "Heavy", ad -> "Ad") and overwrote `title` on every
-- sync, while `display_title` kept the real titles. Everything that reads
-- `title` (My Music collection, gifts, receipts, collector cards, admin) showed
-- the folder name. The ingest no longer overwrites existing titles
-- (src/lib/catalog/r2-ingest-pipeline.js); this restores the ones it replaced.
update public.products
set title = display_title, updated_at = now()
where display_title is not null
  and btrim(display_title) <> ''
  and title is distinct from display_title;

update public.catalog_tracks
set title = display_title, updated_at = now()
where display_title is not null
  and btrim(display_title) <> ''
  and title is distinct from display_title;
