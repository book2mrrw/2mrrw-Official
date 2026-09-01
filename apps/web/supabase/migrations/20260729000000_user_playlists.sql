-- User playlists: server-backed cross-device playlist persistence
-- Replaces localStorage-only playlists. Client generates UUIDs; server accepts or assigns.

CREATE TABLE IF NOT EXISTS user_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Playlist',
  artwork_url TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES user_playlists(id) ON DELETE CASCADE,
  track_slug TEXT NOT NULL,
  album_slug TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  track_data JSONB,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (playlist_id, track_slug)
);

CREATE INDEX IF NOT EXISTS idx_user_playlists_user_sort
  ON user_playlists (user_id, sort_order ASC);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order
  ON playlist_tracks (playlist_id, sort_order ASC);

ALTER TABLE user_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_playlists"
  ON user_playlists FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_own_playlist_tracks"
  ON playlist_tracks FOR ALL TO authenticated
  USING (
    playlist_id IN (
      SELECT id FROM user_playlists WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    playlist_id IN (
      SELECT id FROM user_playlists WHERE user_id = auth.uid()
    )
  );
