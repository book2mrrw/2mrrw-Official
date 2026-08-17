-- Catalog Ingestion: extend existing tables for R2 auto-ingest pipeline.
-- catalog_tracks was created in 20260529120000 with album_slug/track_number schema;
-- this migration ALTERS the existing table to add product_id + supporting columns
-- rather than re-creating it (CREATE TABLE IF NOT EXISTS would silently skip).

-- ── Products: new columns ─────────────────────────────────────────────────────
-- release_date, video_path, stream_path already exist from prior migrations.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS release_type text
    CHECK (release_type IS NULL OR release_type IN ('singles','features','albums','mixtapes-and-eps')),
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS ingested_from_r2_at timestamptz;

CREATE INDEX IF NOT EXISTS products_release_type_idx ON public.products (release_type)
  WHERE release_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_release_date_idx ON public.products (release_date DESC)
  WHERE release_date IS NOT NULL;

UPDATE public.products
SET release_type = (metadata->>'release_type')::text
WHERE release_type IS NULL
  AND metadata->>'release_type' IS NOT NULL
  AND metadata->>'release_type' IN ('singles','features','albums','mixtapes-and-eps');

-- ── catalog_tracks: extend for R2 auto-ingest ────────────────────────────────
-- Existing schema: album_slug NOT NULL, track_number NOT NULL, slug, title,
--   display_title, storage_path, preview_path, stream_path, stream_key.
-- We make album_slug + track_number nullable (ingest rows won't have them)
-- then add product_id FK, position, metadata, duration_seconds.

ALTER TABLE public.catalog_tracks
  ALTER COLUMN album_slug DROP NOT NULL,
  ALTER COLUMN track_number DROP NOT NULL;

ALTER TABLE public.catalog_tracks
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS duration_seconds integer;

-- Backfill position from track_number for existing rows.
UPDATE public.catalog_tracks
SET position = track_number
WHERE track_number IS NOT NULL;

-- Backfill product_id by matching album_slug → products.slug.
UPDATE public.catalog_tracks ct
SET product_id = p.id
FROM public.products p
WHERE ct.album_slug = p.slug
  AND ct.product_id IS NULL;

-- Unique index used as ON CONFLICT target in the ingest upsert route.
-- NULLs are always distinct in PostgreSQL unique indexes, so legacy rows
-- with NULL product_id never conflict with each other or with new ingest rows.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_tracks_product_slug_unique
  ON public.catalog_tracks (product_id, slug);

CREATE INDEX IF NOT EXISTS catalog_tracks_product_position_idx
  ON public.catalog_tracks (product_id, position)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_tracks_slug_idx
  ON public.catalog_tracks (slug);

-- ── RLS policy ────────────────────────────────────────────────────────────────
-- Legacy rows (product_id IS NULL) remain fully public as before.
-- New ingest rows (product_id IS NOT NULL) gated on products.active = true.
DROP POLICY IF EXISTS "catalog_tracks_public_read" ON public.catalog_tracks;
CREATE POLICY "catalog_tracks_public_read" ON public.catalog_tracks
  FOR SELECT USING (
    product_id IS NULL
    OR product_id IN (SELECT id FROM public.products WHERE active = true)
  );

DROP POLICY IF EXISTS "catalog_tracks_admin_all" ON public.catalog_tracks;
CREATE POLICY "catalog_tracks_admin_all" ON public.catalog_tracks
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));

DROP TRIGGER IF EXISTS catalog_tracks_updated_at ON public.catalog_tracks;
CREATE TRIGGER catalog_tracks_updated_at
  BEFORE UPDATE ON public.catalog_tracks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
