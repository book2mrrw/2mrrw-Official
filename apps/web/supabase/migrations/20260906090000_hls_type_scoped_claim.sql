-- Type-aware atomic claiming: a worker can only ever claim the job type it
-- was built to process, enforced INSIDE the atomic claim query itself — not
-- by claiming any pending row and rejecting it after the fact. This is what
-- makes the Fly.io audio/video worker-lane split actually meaningful: an
-- audio worker's claim query can never return a video row, and vice versa,
-- so a long video encode can never occupy the audio worker's claim slot.
--
-- The old single-argument hls_claim_next_job(p_worker_id) is dropped and
-- replaced by a two-argument version — nothing else calls the old
-- signature, so there's no compatibility path to preserve.
--
-- Also sets heartbeat_at on claim (for both job types, harmless for audio —
-- audio's stale-job recovery still keys off started_at, unchanged). This
-- gives every claimed row a real starting heartbeat value so the video lane's
-- heartbeat-based stale recovery has something to compare against from the
-- moment a job is claimed, not just once the worker's first heartbeat tick
-- fires.
drop function if exists hls_claim_next_job(text);

create or replace function hls_claim_next_job(p_worker_id text, p_job_type text)
returns hls_transcode_jobs
language plpgsql
security definer
as $$
declare
  v_job hls_transcode_jobs;
begin
  if p_job_type not in ('audio', 'video') then
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
  v_job.worker_id     := p_worker_id;
  v_job.started_at    := now();
  v_job.heartbeat_at  := now();
  return v_job;
end;
$$;
