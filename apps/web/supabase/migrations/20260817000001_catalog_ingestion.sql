-- Catalog Ingestion: DB-driven catalog columns + catalog_tracks table.
-- Enables R2 auto-discovery to populate the catalog without code deploys.
-- Fully additive — safe to re-run.

-- ── Products: media path columns ─────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS release_type text
    CHECK (release_type IS NULL OR release_type IN ('singles','features','albums','mixtapes-and-eps')),
  ADD COLUMN IF NOT EXISTS video_path text,
  ADD COLUMN IF NOT EXISTS image_path text,
  ADD COLUMN IF NOT EXISTS stream_path text,
  ADD COLUMN IF NOT EXISTS release_date date,
  ADD COLUMN IF NOT EXISTS ingested_from_r2_at timestamptz;

COMMENT ON COLUMN public.products.release_type IS 'R2 folder segment: singles | features | albums | mixtapes-and-eps';
COMMENT ON COLUMN public.products.video_path IS 'R2 key for motion cover video (videos/{type}/{slug}/)';
COMMENT ON COLUMN public.products.image_path IS 'R2 key for static cover image (images/{type}/{slug}/)';
COMMENT ON COLUMN public.products.stream_path IS 'R2 key for AAC stream file (streaming/{type}/{slug}/)';
COMMENT ON COLUMN public.products.ingested_from_r2_at IS 'Timestamp of last R2 auto-ingest scan that touched this row';

CREATE INDEX IF NOT EXISTS products_release_type_idx ON public.products (release_type)
  WHERE release_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_release_date_idx ON public.products (release_date DESC)
  WHERE release_date IS NOT NULL;

-- Backfill release_type from metadata for existing rows that have it stored in JSON.
UPDATE public.products
SET release_type = (metadata->>'release_type')::text
WHERE release_type IS NULL
  AND metadata->>'release_type' IS NOT NULL
  AND metadata->>'release_type' IN ('singles','features','albums','mixtapes-and-eps');

-- ── Catalog Tracks ────────────────────────────────────────────────────────────
-- One row per track in a multi-track release (album, EP, mixtape).
-- Discovery: R2 folder listing under digital-assets/{type}/{albumSlug}/{trackSlug}/
CREATE TABLE IF NOT EXISTS public.catalog_tracks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  slug            text NOT NULL,
  title           text NOT NULL,
  position        integer NOT NULL DEFAULT 1,
  storage_path    text,
  preview_path    text,
  stream_path     text,
  duration_seconds integer,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, slug)
);

CREATE INDEX IF NOT EXISTS catalog_tracks_product_position_idx
  ON public.catalog_tracks (product_id, position);
CREATE INDEX IF NOT EXISTS catalog_tracks_slug_idx
  ON public.catalog_tracks (slug);

ALTER TABLE public.catalog_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "catalog_tracks_admin_all" ON public.catalog_tracks;
CREATE POLICY "catalog_tracks_admin_all" ON public.catalog_tracks
  USING (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ));

DROP POLICY IF EXISTS "catalog_tracks_public_read" ON public.catalog_tracks;
CREATE POLICY "catalog_tracks_public_read" ON public.catalog_tracks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = catalog_tracks.product_id AND p.active = true
    )
  );

DROP TRIGGER IF EXISTS catalog_tracks_updated_at ON public.catalog_tracks;
CREATE TRIGGER catalog_tracks_updated_at
  BEFORE UPDATE ON public.catalog_tracks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
