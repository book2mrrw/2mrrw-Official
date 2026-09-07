-- hls_transcode_jobs.slug was NOT NULL with no default — fine for audio,
-- where a slug always exists, but a video job identifies itself by
-- asset_version_id (audio_visuals has no slug at all — the running theme of
-- every Audio Visual migration so far). Without this, a video job could
-- never be inserted at all.
--
-- This follows the EXACT precedent already set by whoever built this
-- table's own job_type split (20260905110000_hls_typed_job_architecture.sql,
-- its own header: "Purely additive... Nothing here changes audio's existing
-- behavior") — same shape as Slice 13's purchase_items fix: relax the
-- column, then add a check constraint so a row must still identify itself
-- correctly for its own job_type, never neither. Every existing row is a
-- real audio job with a real slug already, so this changes nothing for any
-- row that exists today.
alter table public.hls_transcode_jobs
  alter column slug drop not null;

-- This constraint is brand new (never existed under any name before this
-- migration), so — unlike Slice 13's purchase_items fix, which replaced an
-- existing constraint of unknown name — a plain by-name existence check is
-- correct and simpler here; no dynamic lookup-by-definition needed.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.hls_transcode_jobs'::regclass
       and conname = 'hls_transcode_jobs_identity_by_type_check'
  ) then
    alter table public.hls_transcode_jobs
      add constraint hls_transcode_jobs_identity_by_type_check
      check (
        (job_type = 'audio' and slug is not null)
        or
        (job_type = 'video' and asset_version_id is not null)
      );
  end if;
end $$;

-- The existing idx_hls_transcode_jobs_unique_track index (slug,
-- COALESCE(track_slug,'')) is untouched and keeps working identically for
-- audio — standard SQL never treats a NULL as equal to another NULL in a
-- unique index, so any number of video rows (slug always null) coexist
-- under it without ever colliding, audio's own uniqueness guarantee is
-- completely unaffected.
--
-- Video gets its own, separate guarantee instead: at most one job row per
-- asset_version_id, ever (a retry reuses the same row via markJobFailed
-- resetting status back to 'pending' in place — it never inserts a second
-- row), preventing the same version from ever being double-enqueued as two
-- independent jobs.
create unique index if not exists idx_hls_transcode_jobs_video_asset_version_unique
  on public.hls_transcode_jobs (asset_version_id)
  where job_type = 'video';
