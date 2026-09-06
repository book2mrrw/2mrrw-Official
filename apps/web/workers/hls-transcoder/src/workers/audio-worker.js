/**
 * Explicit audio worker entry point — the "app" Fly.io process group.
 *
 * Lane identity is fixed here, at the top of this file, not derived from an
 * env var or a shared command's runtime branch: this process requests
 * job_type='audio' from the database claim query and nothing else, and
 * dispatches every claimed job to processAudioTranscodeJob() and nothing
 * else. There is no fallback path to video processing anywhere in this file.
 *
 * transcoder.js (today's transcodeOneBitrate/transcode()) is imported
 * as-is and never edited by this file — this is purely the lane's
 * entry-point/orchestration layer around that existing, unchanged encoder.
 */

import os from "os";
import crypto from "crypto";
import { logger } from "../logger.js";
import { markJobComplete, updatePosterKey } from "../db.js";
import { transcode } from "../transcoder.js";
import { extractPoster } from "../poster.js";
import { runWorker } from "../worker-runtime.js";

const JOB_TYPE = "audio";

// Bitrates that indicate a video job (not audio-only). Dead in practice now
// that job_type is explicit and validated at creation — an audio-typed
// job's bitrates are always AUDIO_RENDITIONS values, which never overlap
// with these. Left as-is; this file preserves the audio path's behavior
// byte-for-byte from before the explicit-entry-point split.
const VIDEO_BITRATES = new Set(["4000k", "2000k", "1000k", "720k"]);

const WORKER_ID = `fly-audio-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

async function processAudioTranscodeJob(job) {
  const manifest = await transcode({ job });
  await markJobComplete(job, manifest);
  logger.info("job complete", { jobId: job.id, slug: job.slug, trackSlug: job.track_slug });

  const isVideoJob = job.bitrates?.some((b) => VIDEO_BITRATES.has(b));
  if (isVideoJob && !job.track_slug) {
    try {
      const posterKey = await extractPoster({
        sourceKey:       job.source_key,
        slug:            job.slug,
        releaseType:     job.release_type,
        durationSeconds: manifest.duration_seconds,
      });
      await updatePosterKey(job.slug, null, posterKey, "ready");
      logger.info("poster ready", { jobId: job.id, slug: job.slug, posterKey });
    } catch (posterErr) {
      logger.warn("poster extraction failed (non-fatal)", {
        jobId:   job.id,
        slug:    job.slug,
        message: posterErr?.message,
      });
      await updatePosterKey(job.slug, null, null, "needs_poster").catch(() => {});
    }
  }
}

runWorker({
  jobType:   JOB_TYPE,
  workerId:  WORKER_ID,
  processFn: processAudioTranscodeJob,
  idlePollMs: IDLE_POLL_MS,
});
