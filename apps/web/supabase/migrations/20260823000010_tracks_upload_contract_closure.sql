-- Close the database contract used by the release upload, publish, edit, and
-- replace-master routes.  Earlier upload work added position/master_history,
-- but the routes also require a stable per-track slug and production may not
-- have received the earlier additive migration yet.

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS master_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS slug text;

-- Existing tracks predate the slug contract.  Give every row a deterministic,
-- non-empty value; the id suffix prevents collisions inside a release.
UPDATE public.tracks
SET slug = 'track-' || position::text || '-' || left(id::text, 8)
WHERE slug IS NULL OR btrim(slug) = '';

ALTER TABLE public.tracks
  ALTER COLUMN slug SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tracks_release_position
  ON public.tracks (release_id, position);

CREATE INDEX IF NOT EXISTS idx_tracks_release_slug
  ON public.tracks (release_id, slug);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS release_id uuid
    REFERENCES public.releases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_release_id_idx
  ON public.products (release_id)
  WHERE release_id IS NOT NULL;

-- Prompt PostgREST to discard the stale schema cache that produced the 500.
NOTIFY pgrst, 'reload schema';
