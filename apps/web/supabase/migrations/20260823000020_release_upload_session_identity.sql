-- One upload session owns one canonical draft release. This expression index
-- closes the race between repeated clicks/retries at the database boundary.
CREATE UNIQUE INDEX IF NOT EXISTS releases_upload_session_id_uidx
  ON public.releases ((metadata->>'upload_session_id'))
  WHERE metadata->>'upload_session_id' IS NOT NULL;
