/**
 * Audio worker entry point: songs (job_type 'audio').
 *
 * Lane identity is fixed here: this process claims job_type='audio' through
 * the leased lane claim (media-lane.js, hls_claim_media_job) and nothing else,
 * and encodes every claimed job with transcoder.js — today's audio encoder —
 * through audio-lane.js, and nothing else. It never imports the video
 * processor.
 *
 * Keyless: the database only through the lanes' own login (lane-db.js); the
 * master, the write links and the song's content key only through the
 * website, per lease (lane-transfers.js). This host holds no service-role key,
 * no storage key and no master secret.
 */

import os from "os";
import crypto from "crypto";
import { processAudioTranscodeJob } from "../audio-lane.js";
import { runMediaLane } from "../media-lane.js";
import { dropPrivilegesIfRoot } from "../drop-privileges.js";
import { rpc, isLeaseLive } from "../lane-db.js";
import { laneSession } from "../lane-transfers.js";

// /data is the audio lane's scratch volume on an owned host (VIDEO_SCRATCH_ROOT);
// chowned before dropping privileges, like the video lanes. Skipped where absent.
dropPrivilegesIfRoot(["/data"]);

const JOB_TYPE = "audio";
const WORKER_ID = `audio-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

runMediaLane({
  jobType: JOB_TYPE,
  workerId: WORKER_ID,
  rpc,
  isLeaseLive,
  processFn: (job, { lease }) => processAudioTranscodeJob(job, { rpc, lease, lane: laneSession({ lane: JOB_TYPE, job }) }),
  idlePollMs: IDLE_POLL_MS,
});
