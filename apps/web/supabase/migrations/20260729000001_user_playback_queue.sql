-- User playback queue: server-backed queue state for cross-device continuity
-- One row per user; upserted on every meaningful queue change.

CREATE TABLE IF NOT EXISTS user_playback_queue (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  queue JSONB NOT NULL DEFAULT '[]',
  queue_index INTEGER NOT NULL DEFAULT 0,
  shuffle BOOLEAN NOT NULL DEFAULT FALSE,
  repeat_mode TEXT NOT NULL DEFAULT 'off',
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_playback_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_queue"
  ON user_playback_queue FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
