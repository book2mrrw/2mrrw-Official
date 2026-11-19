/**
 * Video worker entry point: music videos, short films and documentaries
 * (Audio Visualz, job_type 'video').
 *
 * Lane identity is fixed here: this process claims job_type='video' through
 * the leased lane claim (media-lane.js, hls_claim_media_job) and nothing
 * else, and dispatches every claimed job to processVideoTranscodeJob() and
 * nothing else. There is no fallback path to audio processing anywhere in
 * this file — it never imports transcoder.js.
 *
 * Keyless: the database only through the lane's own login (lane-db.js), and
 * storage plus content keys only through the website, per lease
 * (lane-transfers.js). Never db.js or r2.js: this host holds no service-role
 * key, no storage key and no master secret.
 */

import os from "os";
import crypto from "crypto";
import { processVideoTranscodeJob } from "../video-transcoder.js";
import { runMediaLane } from "../media-lane.js";
import { dropPrivilegesIfRoot } from "../drop-privileges.js";
import { rpc, isLeaseLive } from "../lane-db.js";
import { laneSession } from "../lane-transfers.js";

// /data is the mounted scratch volume — owned by root the first time a fresh
// volume is attached, so this must chown it before dropping privileges.
dropPrivilegesIfRoot(["/data"]);

const JOB_TYPE = "video";
const WORKER_ID = `video-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

runMediaLane({
  jobType: JOB_TYPE,
  workerId: WORKER_ID,
  rpc,
  isLeaseLive,
  processFn: (job, { lease }) => processVideoTranscodeJob(job, {
    rpc, lease, lane: laneSession({ lane: JOB_TYPE, job }),
  }),
  idlePollMs: IDLE_POLL_MS,
});
