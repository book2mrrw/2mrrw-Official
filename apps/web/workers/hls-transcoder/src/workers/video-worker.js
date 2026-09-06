/**
 * Explicit video worker entry point — the "video" Fly.io process group.
 *
 * Lane identity is fixed here: this process requests job_type='video' from
 * the database claim query and nothing else, and dispatches every claimed
 * job to processVideoTranscodeJob() and nothing else. There is no fallback
 * path to audio processing anywhere in this file — it never imports
 * transcoder.js.
 *
 * Real VIDEO_TRANSCODE encoding is not implemented yet (see
 * ../video-transcoder.js) — this process runs on its own dedicated,
 * physically separate machine from day one, and safely idles (claiming
 * nothing, since no job_type='video' rows exist yet) until that lands.
 */

import os from "os";
import crypto from "crypto";
import { processVideoTranscodeJob } from "../video-transcoder.js";
import { runWorker } from "../worker-runtime.js";

const JOB_TYPE = "video";

const WORKER_ID = `fly-video-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

runWorker({
  jobType:   JOB_TYPE,
  workerId:  WORKER_ID,
  processFn: processVideoTranscodeJob,
  idlePollMs: IDLE_POLL_MS,
});
