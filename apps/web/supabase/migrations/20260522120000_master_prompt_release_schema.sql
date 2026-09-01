-- MASTER-PROMPT 2026-05-22 — idempotent release schema extensions
-- Run against shared Supabase project (safe to re-run).

ALTER TABLE releases ADD COLUMN IF NOT EXISTS subtitle text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS cover_art_r2_key text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS mood_tags text[];
ALTER TABLE releases ADD COLUMN IF NOT EXISTS publishing_credits text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS upc text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS storefront_visible boolean DEFAULT false;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE releases ADD COLUMN IF NOT EXISTS executive_producer text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS mixing_engineer text;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS mastering_engineer text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'releases_slug_key') THEN
    ALTER TABLE releases ADD CONSTRAINT releases_slug_key UNIQUE (slug);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'releases_status_check') THEN
    ALTER TABLE releases ADD CONSTRAINT releases_status_check
      CHECK (status IN ('draft','scheduled','published','archived'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'releases_release_type_check') THEN
    ALTER TABLE releases ADD CONSTRAINT releases_release_type_check
      CHECK (release_type IN ('single','ep','album','deluxe'));
  END IF;
END $$;

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_r2_key text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS master_r2_key text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_format text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS bit_depth integer;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS sample_rate integer;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS file_size_bytes bigint;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS upload_status text DEFAULT 'pending';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS written_by text[];
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS produced_by text[];
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS featured_artists text[];
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS mixing_engineer text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS mastering_engineer text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS executive_producer text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS draft_data jsonb;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS isrc text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS duration_seconds integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_upload_status_check') THEN
    ALTER TABLE tracks ADD CONSTRAINT tracks_upload_status_check
      CHECK (upload_status IN ('pending','uploading','processing','ready','error'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS release_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    uuid REFERENCES releases(id) ON DELETE CASCADE,
  saved_at      timestamptz DEFAULT now(),
  draft_payload jsonb NOT NULL,
  step_index    integer DEFAULT 0
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS releases_updated_at ON releases;
CREATE TRIGGER releases_updated_at BEFORE UPDATE ON releases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS tracks_updated_at ON tracks;
CREATE TRIGGER tracks_updated_at BEFORE UPDATE ON tracks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION generate_release_slug(title text, release_id uuid)
RETURNS text AS $$
DECLARE
  base_slug text;
  final_slug text;
  counter integer := 0;
BEGIN
  base_slug := lower(regexp_replace(
    regexp_replace(title, '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g'
  ));
  base_slug := trim(both '-' from base_slug);
  final_slug := base_slug;
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM releases WHERE slug = final_slug AND id != release_id
    ) THEN
      RETURN final_slug;
    END IF;
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auto_set_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := generate_release_slug(NEW.title, NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS releases_auto_slug ON releases;
CREATE TRIGGER releases_auto_slug BEFORE INSERT OR UPDATE ON releases
  FOR EACH ROW EXECUTE FUNCTION auto_set_slug();

ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_full_access" ON releases;
CREATE POLICY "admin_full_access" ON releases
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_full_access" ON tracks;
CREATE POLICY "admin_full_access" ON tracks
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "admin_full_access" ON release_drafts;
CREATE POLICY "admin_full_access" ON release_drafts
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "storefront_read" ON releases;
CREATE POLICY "storefront_read" ON releases FOR SELECT
  USING (storefront_visible = true AND status IN ('published','scheduled'));

DROP POLICY IF EXISTS "storefront_read" ON tracks;
CREATE POLICY "storefront_read" ON tracks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM releases r
    WHERE r.id = tracks.release_id
    AND r.storefront_visible = true
    AND r.status IN ('published','scheduled')
  ));

CREATE INDEX IF NOT EXISTS idx_releases_storefront ON releases(storefront_visible, status);
CREATE INDEX IF NOT EXISTS idx_releases_date ON releases(release_date DESC);
CREATE INDEX IF NOT EXISTS idx_releases_type ON releases(release_type);
CREATE INDEX IF NOT EXISTS idx_releases_slug ON releases(slug);
CREATE INDEX IF NOT EXISTS idx_tracks_release ON tracks(release_id, track_number);
CREATE INDEX IF NOT EXISTS idx_drafts_release ON release_drafts(release_id, saved_at DESC);
