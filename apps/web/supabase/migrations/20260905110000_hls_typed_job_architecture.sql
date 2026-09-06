-- Typed job architecture for hls_transcode_jobs — foundation hardening before
-- any video transcode work begins. Purely additive: every existing row is a
-- real audio job today, so backfilling job_type='audio' is not a guess, it is
-- what those rows already are. Nothing here changes audio's existing behavior.
--
-- Root cause being fixed: media type used to be 100% implicit in the
-- `bitrates` array's string contents (a video-shaped value like "720k" could
-- enter the audio-only encoder because nothing rejected it explicitly). From
-- here on, `job_type` is the explicit, validated source of truth, and
-- `bitrates` is only ever interpreted in light of it — never inferred from
-- its own contents. See src/lib/hls/audio-renditions.js and
-- src/lib/hls/video-renditions.js for the two separate, non-overlapping
-- value domains this enables.
alter table public.hls_transcode_jobs
  add column if not exists job_type text not null default 'audio'
    check (job_type in ('audio', 'video')),
  add column if not exists asset_version_id uuid,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists failure_category text
    check (failure_category is null or failure_category in (
      'VALIDATION_FAILURE', 'INPUT_NOT_FOUND', 'PROBE_FAILURE', 'FFMPEG_FAILURE',
      'RESOURCE_EXHAUSTION', 'OUTPUT_VALIDATION_FAILURE', 'UPLOAD_FAILURE',
      'LEASE_LOST', 'CANCELED', 'UNKNOWN'
    ));

-- Polling index gains job_type as its leading column so a type-scoped claim
-- (added in a later slice) never has to scan rows of the other type.
create index if not exists idx_hls_transcode_jobs_job_type_polling
  on public.hls_transcode_jobs (job_type, priority asc, created_at asc)
  where status = 'pending';
