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
 * video-transcoder.js's dbClient/downloadStreamFn/uploadFn/rpc/lease are
 * required, never-defaulted params (see its own header) — this is the one
 * real place that imports db.js/r2.js and closes over them, so
 * video-transcoder.js itself stays safe to import in a test file with no env
 * vars set.
 */

import os from "os";
import crypto from "crypto";
import { processVideoTranscodeJob } from "../video-transcoder.js";
import { runMediaLane } from "../media-lane.js";
import { dropPrivilegesIfRoot } from "../drop-privileges.js";
import { db } from "../db.js";
import { downloadStream, upload } from "../r2.js";

// /data is the mounted scratch volume — owned by root the first time a fresh
// volume is attached, so this must chown it before dropping privileges.
dropPrivilegesIfRoot(["/data"]);

const JOB_TYPE = "video";
const WORKER_ID = `video-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

runMediaLane({
  jobType: JOB_TYPE,
  workerId: WORKER_ID,
  db,
  processFn: (job, { lease, rpc }) => processVideoTranscodeJob(job, {
    dbClient: db, downloadStreamFn: downloadStream, uploadFn: upload, rpc, lease,
  }),
  idlePollMs: IDLE_POLL_MS,
});
