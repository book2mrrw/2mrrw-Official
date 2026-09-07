/**
 * Explicit video worker entry point — the "video" Fly.io process group.
 *
 * Lane identity is fixed here: this process requests job_type='video' from
 * the database claim query and nothing else, and dispatches every claimed
 * job to processVideoTranscodeJob() and nothing else. There is no fallback
 * path to audio processing anywhere in this file — it never imports
 * transcoder.js.
 *
 * video-transcoder.js's dbClient/downloadStreamFn/uploadFn are required,
 * never-defaulted params (see its own header) — this is the one real place
 * that imports db.js/r2.js and closes over them, so video-transcoder.js
 * itself stays safe to import in a test file with no env vars set.
 */

import os from "os";
import crypto from "crypto";
import { processVideoTranscodeJob } from "../video-transcoder.js";
import { runWorker } from "../worker-runtime.js";
import { dropPrivilegesIfRoot } from "../drop-privileges.js";
import { db } from "../db.js";
import { downloadStream, upload } from "../r2.js";

// /data is the mounted scratch volume — owned by root the first time Fly
// attaches a fresh volume, so this must chown it before dropping privileges.
dropPrivilegesIfRoot(["/data"]);

const JOB_TYPE = "video";

const WORKER_ID = `fly-video-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

runWorker({
  jobType:   JOB_TYPE,
  workerId:  WORKER_ID,
  processFn: (job) => processVideoTranscodeJob(job, { dbClient: db, downloadStreamFn: downloadStream, uploadFn: upload }),
  idlePollMs: IDLE_POLL_MS,
});
