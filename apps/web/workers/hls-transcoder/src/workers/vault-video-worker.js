/**
 * Explicit vault video worker entry point — the "vault-video" Fly.io process
 * group.
 *
 * Lane identity is fixed here, at the top of this file: this process requests
 * job_type='vault_video' from the database claim query and nothing else, and
 * dispatches every claimed job to processVaultVideoJob() and nothing else.
 * There is no path from here to the audio lane's transcoder.js or to the Audio
 * Visualz video-transcoder.js.
 */

import os from "os";
import crypto from "crypto";
import { processVaultVideoJob } from "../vault-video-transcoder.js";
import { runWorker } from "../worker-runtime.js";
import { dropPrivilegesIfRoot } from "../drop-privileges.js";

// A long-form encode needs real scratch space, so this lane runs with the
// mounted volume like the Audio Visualz video lane does.
dropPrivilegesIfRoot(["/data"]);

const JOB_TYPE = "vault_video";
const WORKER_ID = `fly-vault-video-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

runWorker({
  jobType: JOB_TYPE,
  workerId: WORKER_ID,
  processFn: processVaultVideoJob,
  idlePollMs: IDLE_POLL_MS,
});
