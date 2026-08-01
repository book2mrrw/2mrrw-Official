-- HLS pre-transcode job pipeline
-- Segments are AES-128 encrypted at the FFmpeg layer.
-- Keys are derived deterministically (HMAC of master secret + slug) — nothing sensitive stored here.

-- ---------------------------------------------------------------------------
-- hls_transcode_jobs: work queue consumed by the Fly.io transcoding worker
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hls_transcode_jobs (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT        NOT NULL,
  track_slug              TEXT,
  release_type            TEXT        NOT NULL DEFAULT 'singles',
  source_key              TEXT        NOT NULL,   -- R2 object key of the master audio file
  hls_prefix              TEXT,                   -- set on completion, e.g. "hls/singles/my-slug/"
  status                  TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'processing', 'complete', 'failed', 'cancelled')),
  priority                INTEGER     NOT NULL DEFAULT 5,  -- lower number = higher priority
  bitrates                TEXT[]      NOT NULL DEFAULT ARRAY['320k', '160k', '96k'],
  segment_duration_secs   INTEGER     NOT NULL DEFAULT 6,
  error_message           TEXT,
  attempt_count           INTEGER     NOT NULL DEFAULT 0,
  worker_id               TEXT,       -- Fly machine ID that claimed this job
  queued_by               TEXT,       -- user ID or "system" that triggered the job
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ
);

-- Unique constraint via expression index (COALESCE not allowed in inline UNIQUE)
CREATE UNIQUE INDEX IF NOT EXISTS idx_hls_transcode_jobs_unique_track
  ON hls_transcode_jobs (slug, COALESCE(track_slug, ''));

-- Index for efficient job polling: worker fetches pending jobs ordered by priority, then age
CREATE INDEX IF NOT EXISTS idx_hls_transcode_jobs_polling
  ON hls_transcode_jobs (priority ASC, created_at ASC)
  WHERE status = 'pending';

-- Index for admin status queries
CREATE INDEX IF NOT EXISTS idx_hls_transcode_jobs_status
  ON hls_transcode_jobs (status, created_at DESC);

-- ---------------------------------------------------------------------------
-- hls_manifests: record of successfully transcoded tracks
-- Queried by the manifest API to confirm HLS is available before serving m3u8.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hls_manifests (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT        NOT NULL,
  track_slug            TEXT,
  release_type          TEXT        NOT NULL DEFAULT 'singles',
  hls_prefix            TEXT        NOT NULL,  -- R2 prefix, e.g. "hls/singles/my-slug/"
  bitrates              TEXT[]      NOT NULL DEFAULT ARRAY['320k', '160k', '96k'],
  segment_duration_secs INTEGER     NOT NULL DEFAULT 6,
  duration_seconds      DECIMAL(12, 6),        -- total audio duration in seconds
  segment_counts        JSONB,                 -- {"320k": 42, "160k": 42, "96k": 42}
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint via expression index
CREATE UNIQUE INDEX IF NOT EXISTS idx_hls_manifests_unique_track
  ON hls_manifests (slug, COALESCE(track_slug, ''));

-- Primary lookup index: manifest API queries by slug + track_slug
CREATE INDEX IF NOT EXISTS idx_hls_manifests_slug
  ON hls_manifests (slug, track_slug);

-- ---------------------------------------------------------------------------
-- RLS: these tables are only ever accessed via service_role on the server.
-- Public access is blocked; no authenticated-user policies needed.
-- ---------------------------------------------------------------------------
ALTER TABLE hls_transcode_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hls_manifests      ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hls_transcode_jobs' AND policyname = 'no_public_access'
  ) THEN
    CREATE POLICY no_public_access ON hls_transcode_jobs FOR ALL TO public USING (false);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'hls_manifests' AND policyname = 'no_public_access'
  ) THEN
    CREATE POLICY no_public_access ON hls_manifests FOR ALL TO public USING (false);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- hls_claim_next_job: atomic job claim using FOR UPDATE SKIP LOCKED.
-- Called exclusively by the Fly.io transcoding worker via service_role.
-- Returns the claimed row, or NULL when the queue is empty.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hls_claim_next_job(p_worker_id TEXT)
RETURNS hls_transcode_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job hls_transcode_jobs;
BEGIN
  SELECT *
    INTO v_job
    FROM hls_transcode_jobs
   WHERE status = 'pending'
   ORDER BY priority ASC, created_at ASC
   LIMIT 1
     FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE hls_transcode_jobs
     SET status     = 'processing',
         worker_id  = p_worker_id,
         started_at = NOW()
   WHERE id = v_job.id;

  v_job.status    := 'processing';
  v_job.worker_id := p_worker_id;
  RETURN v_job;
END;
$$;
