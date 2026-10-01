-- Vault video transcode lane.
--
-- The Vault's video playback routes (/api/vault/video/{manifest,variant,key})
-- have existed since vault video was first scoped, but nothing ever enqueued a
-- job to populate hls_manifests for them, so vault video fell back to a signed
-- direct URL: no adaptive ladder, no encryption.
--
-- It cannot reuse job_type='video'. That lane is bound to Audio Visualz:
-- processVideoTranscodeJob() requires an asset_version_id, loads
-- audio_visual_asset_versions and then audio_visuals, and writes
-- audio_visual_renditions. Giving vault content rows in those tables would be
-- precisely the integration the Vault pipeline exists to avoid.
--
-- So vault video gets its own lane, identified the way vault audio already is:
-- by vault_content.slug. Purely additive -- no existing row changes type, and
-- both existing lanes keep their exact identity rules.

-- 1. Admit the new type.
alter table public.hls_transcode_jobs
  drop constraint if exists hls_transcode_jobs_job_type_check;

alter table public.hls_transcode_jobs
  add constraint hls_transcode_jobs_job_type_check
  check (job_type in ('audio', 'video', 'vault_video'));

-- 2. A row must still identify itself correctly for its own type, never
--    neither. Same shape as the audio rule: vault video is keyed by slug.
alter table public.hls_transcode_jobs
  drop constraint if exists hls_transcode_jobs_identity_by_type_check;

alter table public.hls_transcode_jobs
  add constraint hls_transcode_jobs_identity_by_type_check
  check (
    (job_type = 'audio'       and slug is not null)
    or
    (job_type = 'video'       and asset_version_id is not null)
    or
    (job_type = 'vault_video' and slug is not null)
  );

-- 3. The claim guard rejects anything it does not know, so it has to learn the
--    new lane or the worker can never claim a row. Everything else about the
--    function is unchanged: still FOR UPDATE SKIP LOCKED, still type-scoped
--    inside the query so one lane can never receive another lane's row.
create or replace function hls_claim_next_job(p_worker_id text, p_job_type text)
returns hls_transcode_jobs
language plpgsql
security definer
as $$
declare
  v_job hls_transcode_jobs;
begin
  if p_job_type not in ('audio', 'video', 'vault_video') then
    raise exception 'invalid job_type: %', p_job_type;
  end if;

  select *
    into v_job
    from hls_transcode_jobs
   where status = 'pending'
     and job_type = p_job_type
   order by priority asc, created_at asc
   limit 1
     for update skip locked;

  if not found then
    return null;
  end if;

  update hls_transcode_jobs
     set status       = 'processing',
         worker_id    = p_worker_id,
         started_at   = now(),
         heartbeat_at = now()
   where id = v_job.id;

  v_job.status       := 'processing';
  v_job.worker_id    := p_worker_id;
  v_job.started_at   := now();
  v_job.heartbeat_at := now();
  return v_job;
end;
$$;

-- 4. The polling index already leads with job_type, so the new lane uses it
--    without change. Nothing to add.
