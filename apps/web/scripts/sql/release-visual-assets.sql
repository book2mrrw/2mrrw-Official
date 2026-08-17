-- Release Visual Layer — release_visual_assets table
-- Idempotent. Safe to re-run.
--
-- Each row is one visual experience attached to a release.
-- A release can have zero, one, or many.
-- Zero rows = normal release card behavior unchanged.

CREATE TABLE IF NOT EXISTS release_visual_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Release identity
  release_slug     text NOT NULL,
  track_slug       text,                         -- null = applies to whole release

  -- Asset classification
  asset_type       text NOT NULL CHECK (asset_type IN (
    'animated_cover', 'visualizer', 'music_video_moment', 'music_video',
    'interview_clip', 'podcast_clip', 'studio_footage', 'bts',
    'performance', 'custom_visual'
  )),

  -- Playback behavior
  playback_mode    text NOT NULL DEFAULT 'synced' CHECK (playback_mode IN ('synced', 'independent')),
  interaction      text NOT NULL DEFAULT 'hold'   CHECK (interaction IN ('hold', 'hold_swipe', 'modal', 'full_visual', 'auto')),
  sync_offset      numeric DEFAULT 0,             -- seconds: videoTime = audioTime + syncOffset

  -- Entitlement gate
  entitlement      text NOT NULL DEFAULT 'public' CHECK (entitlement IN (
    'public', 'signed_in', 'purchaser', 'subscriber', 'collector', 'vault', 'admin'
  )),

  -- Media references (R2 / HLS)
  r2_key           text,                          -- direct MP4/WebM for Visual Moments / short clips
  hls_slug         text,                          -- references hls_manifests.slug for long-form HLS
  poster_r2_key    text,                          -- poster frame key in R2
  thumbnail_url    text,                          -- resolved CDN URL (denormalized)

  -- Timing
  duration_seconds numeric,
  priority         integer DEFAULT 0,             -- higher = preferred when multiple assets of same type

  -- Lifecycle
  active           boolean NOT NULL DEFAULT true,
  publish_at       timestamptz,                   -- null = active immediately when active=true
  expires_at       timestamptz,                   -- null = never expires

  -- Metadata
  title            text,
  description      text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the hot read path (card render and API lookup by release slug)
CREATE INDEX IF NOT EXISTS idx_visual_assets_release_slug ON release_visual_assets(release_slug, active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_visual_assets_type        ON release_visual_assets(asset_type, active);
CREATE INDEX IF NOT EXISTS idx_visual_assets_entitlement ON release_visual_assets(entitlement, active);

-- updated_at auto-trigger
CREATE OR REPLACE FUNCTION _set_visual_asset_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_visual_asset_updated_at ON release_visual_assets;
CREATE TRIGGER trg_visual_asset_updated_at
  BEFORE UPDATE ON release_visual_assets
  FOR EACH ROW EXECUTE FUNCTION _set_visual_asset_updated_at();

-- RLS
ALTER TABLE release_visual_assets ENABLE ROW LEVEL SECURITY;

-- Admin has full CRUD
DROP POLICY IF EXISTS "admin_full_access" ON release_visual_assets;
CREATE POLICY "admin_full_access" ON release_visual_assets
  USING   (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Anyone can read active, published public/signed_in assets.
-- Entitlement-gated rows are filtered server-side by the API route.
DROP POLICY IF EXISTS "public_read_active" ON release_visual_assets;
CREATE POLICY "public_read_active" ON release_visual_assets FOR SELECT
  USING (
    active = true
    AND (publish_at IS NULL OR publish_at <= now())
    AND (expires_at IS NULL OR expires_at > now())
  );
