-- Fix releases_release_type_check to include feature and mixtape.
-- The original constraint only allowed single/ep/album/deluxe, blocking
-- draft creation for feature and mixtape release types.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'releases_release_type_check') THEN
    ALTER TABLE public.releases DROP CONSTRAINT releases_release_type_check;
  END IF;
END $$;

ALTER TABLE public.releases
  ADD CONSTRAINT releases_release_type_check
  CHECK (release_type IN ('single','ep','album','deluxe','feature','mixtape'));
