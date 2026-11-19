/**
 * Explicit vault video worker entry point (Compose service "vault-video").
 *
 * Lane identity is fixed here, at the top of this file: this process claims
 * job_type='vault_video' through the leased lane claim (media-lane.js,
 * hls_claim_media_job) and nothing else, and dispatches every claimed job to
 * processVaultVideoJob() and nothing else. Keyless: the database only through
 * the lane's own login (lane-db.js), storage and content keys only through
 * the website per lease (lane-transfers.js).
 * There is no path from here to the audio lane's transcoder.js or to the Audio
 * Visualz video-transcoder.js.
 */

import os from "os";
import crypto from "crypto";
import { processVaultVideoJob } from "../vault-video-transcoder.js";
import { runMediaLane } from "../media-lane.js";
import { rpc, isLeaseLive } from "../lane-db.js";
import { laneSession } from "../lane-transfers.js";
import { dropPrivilegesIfRoot } from "../drop-privileges.js";

// A long-form encode needs real scratch space, so this lane runs with the
// mounted volume like the Audio Visualz video lane does.
dropPrivilegesIfRoot(["/data"]);

const JOB_TYPE = "vault_video";
const WORKER_ID = `vault-video-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

runMediaLane({
  jobType: JOB_TYPE,
  workerId: WORKER_ID,
  rpc,
  isLeaseLive,
  processFn: (job, { lease }) => processVaultVideoJob(job, { rpc, lease, lane: laneSession({ lane: JOB_TYPE, job }) }),
  idlePollMs: IDLE_POLL_MS,
});
