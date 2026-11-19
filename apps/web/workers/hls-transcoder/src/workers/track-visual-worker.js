/**
 * Track-visual worker entry point (Compose service "track-visual"): the
 * looping per-track visuals, on their own lease contract —
 * claim_track_visual_job, heartbeat_track_visual_job, complete_track_visual_job.
 *
 * Keyless: the database only through the lanes' own login (lane-db.js);
 * storage and the visual's content key only through the website, per lease
 * (lane-transfers.js). This host holds no service-role key, no storage key and
 * no master secret. A refused heartbeat or completion means the lease moved
 * on: the worker stops at once (exit 75) and Compose restarts it.
 */

import os from 'node:os';
import crypto from 'node:crypto';
import { rpc } from '../lane-db.js';
import { laneSession } from '../lane-transfers.js';
import { transcodeTrackVisual } from '../track-visual-transcoder.js';
import { dropPrivilegesIfRoot } from '../drop-privileges.js';
import { EXIT_LEASE_LOST, LeaseLost } from '../media-lane.js';

// /visual-scratch is this lane's mounted volume — root-owned the first time it
// is attached, so it must be chowned before dropping, exactly as the video lane
// does for /data. This is not optional hardening: the Dockerfile deliberately
// omits USER so the video lane can chown its mount, so every lane starts as root
// and drops itself. Without this line the lane would run ffmpeg — over 5gb of
// untrusted, user-supplied media — as root. dropPrivilegesIfRoot is a no-op when
// already unprivileged and skips a chown path that does not exist, so this stays
// correct running locally with no volume attached.
dropPrivilegesIfRoot(['/visual-scratch']);

const workerId = `track-visual-${os.hostname()}-${crypto.randomUUID()}`;
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function leaseLost(job, how) {
  console.error('[track-visual] lease lost — stopping this worker', { job: job.id, how });
  process.exit(EXIT_LEASE_LOST);
}

while (!stopping) {
  let heartbeat;
  try {
    const job = await rpc('claim_track_visual_job', { p_worker_id: workerId });
    if (!job) { await pause(5000); continue; }
    heartbeat = setInterval(() => {
      rpc('heartbeat_track_visual_job', { p_job_id: job.id, p_worker_id: workerId, p_lease_token: job.lease_token }).then(
        (held) => { if (held === false) leaseLost(job, 'heartbeat refused'); },
        (err) => console.error('[track-visual] heartbeat failed', err.message),
      );
    }, 30000);
    let manifest = null;
    let error = null;
    try {
      manifest = await transcodeTrackVisual({ job, lane: laneSession({ lane: 'track_visual', job }) });
    } catch (e) {
      if (e instanceof LeaseLost) leaseLost(job, e.message);
      error = e.message;
      console.error('[track-visual] failed', job.id, error);
    }
    const published = await rpc('complete_track_visual_job', { p_job_id: job.id, p_lease_token: job.lease_token, p_manifest: manifest, p_error: error });
    if (published === false) leaseLost(job, 'completion refused');
    console.info('[track-visual] completed', { job: job.id, published, failed: Boolean(error) });
  } catch (e) {
    console.error('[track-visual] worker error', e.message);
    await pause(5000);
  } finally {
    clearInterval(heartbeat);
  }
}
