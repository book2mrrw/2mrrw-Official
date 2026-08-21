-- Upload pipeline schema fixes:
--
-- 1. Add position to tracks — complete/route.js inserts position but the column
--    was never added to tracks (only catalog_tracks got it in 20260817000001).
--    Backfill from track_number if that column exists.
--
-- 2. Add master_history to tracks — stores previous master file keys on re-upload.
--
-- 3. Add release_id to products — publish/route.js upserts products with
--    release_id to link the wizard-uploaded release to the storefront product row.

-- ── tracks.position ───────────────────────────────────────────────────────────
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tracks'
      AND column_name  = 'track_number'
  ) THEN
    UPDATE public.tracks
    SET    position = track_number
    WHERE  track_number IS NOT NULL
      AND  position = 1;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tracks_release_position
  ON public.tracks (release_id, position);

-- ── tracks.master_history ─────────────────────────────────────────────────────
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS master_history jsonb NOT NULL DEFAULT '[]';

-- ── products.release_id ───────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS release_id uuid
    REFERENCES public.releases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_release_id_idx
  ON public.products (release_id)
  WHERE release_id IS NOT NULL;
