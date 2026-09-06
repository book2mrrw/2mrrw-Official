/**
 * HLS Transcoder Worker — main process.
 *
 * Polls the Supabase hls_transcode_jobs queue for pending work.
 * Each job is processed serially on this machine; horizontal scale is
 * achieved by running multiple Fly.io machines simultaneously — each
 * uses FOR UPDATE SKIP LOCKED so they never double-claim the same job.
 *
 * Shutdown:
 *   SIGTERM / SIGINT → finish the current job, then exit cleanly.
 *   Mid-job crash    → stale-jobs cron (every 10 min) rescues the row.
 */

import os from "os";
import crypto from "crypto";
import { logger }                                              from "./logger.js";
import { claimNextJob, markJobComplete, markJobFailed, updatePosterKey } from "./db.js";
import { transcode }                                           from "./transcoder.js";
import { extractPoster }                                       from "./poster.js";
import { processVideoTranscodeJob }                            from "./video-transcoder.js";

// Bitrates that indicate a video job (not audio-only)
const VIDEO_BITRATES = new Set(["4000k", "2000k", "1000k", "720k"]);

// Unique worker ID per process — shown in hls_transcode_jobs.worker_id
const WORKER_ID = `fly-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;

// Which lane this machine belongs to. Fly.io injects FLY_PROCESS_GROUP to
// match the [processes] entry in fly.toml ("app" or "video"); WORKER_JOB_TYPE
// is an explicit override for local/manual runs. "app" maps to "audio" since
// that's the historical, still-unrenamed name of the audio lane's process
// group — kept as-is so the existing production machines needed no
// reassignment when the video lane was added alongside them.
const WORKER_JOB_TYPE =
  process.env.WORKER_JOB_TYPE ||
  (process.env.FLY_PROCESS_GROUP === "video" ? "video" : "audio");

// Poll interval when queue is empty (ms)
const IDLE_POLL_MS = parseInt(process.env.IDLE_POLL_MS || "5000", 10);

let shuttingDown = false;
let activeJobId  = null;

process.on("SIGTERM", () => {
  logger.info("SIGTERM received — draining current job then exiting");
  shuttingDown = true;
});
process.on("SIGINT", () => {
  logger.info("SIGINT received — draining current job then exiting");
  shuttingDown = true;
});

/**
 * Single, explicit dispatch point: job_type decides which processor runs.
 * transcoder.js's audio path is never touched by the video branch and vice
 * versa — each processor owns its own transcode/complete logic below;
 * job-claim and job-failure handling stay shared here since they carry no
 * media-specific policy of their own.
 */
async function processJob(job) {
  activeJobId = job.id;
  logger.info("job claimed", {
    jobId:     job.id,
    jobType:   job.job_type,
    slug:      job.slug,
    trackSlug: job.track_slug,
    bitrates:  job.bitrates,
    workerId:  WORKER_ID,
  });

  try {
    if (job.job_type === "video") {
      await processVideoTranscodeJob(job);
    } else {
      await processAudioTranscodeJob(job);
    }
  } catch (err) {
    const message = err?.message ?? String(err);
    logger.error("job failed", { jobId: job.id, jobType: job.job_type, slug: job.slug, message });
    await markJobFailed(job.id, message).catch((dbErr) => {
      logger.error("markJobFailed error", { jobId: job.id, message: dbErr?.message });
    });
  } finally {
    activeJobId = null;
  }
}

/**
 * job_type='audio' path — unchanged behavior from before the job_type split,
 * only extracted out of processJob and given an explicit name for clarity.
 * transcoder.js itself (today's transcodeOneBitrate/transcode()) is never
 * edited by this or any future Audio Visual slice.
 */
async function processAudioTranscodeJob(job) {
  const manifest = await transcode({ job });
  await markJobComplete(job, manifest);
  logger.info("job complete", { jobId: job.id, slug: job.slug, trackSlug: job.track_slug });

  // Poster extraction — only for video jobs, non-fatal. Dead in practice
  // now that job_type is explicit: an audio-typed job's bitrates are always
  // AUDIO_RENDITIONS values, which VIDEO_BITRATES never contains. Left as-is
  // — this slice preserves the audio path's behavior byte-for-byte.
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

async function poll() {
  while (!shuttingDown) {
    let job;
    try {
      job = await claimNextJob(WORKER_ID);
    } catch (err) {
      logger.error("claimNextJob error", { message: err?.message });
      await sleep(IDLE_POLL_MS);
      continue;
    }

    if (!job) {
      // Queue empty — wait before next poll
      await sleep(IDLE_POLL_MS);
      continue;
    }

    await processJob(job);
    // No sleep here — check for more work immediately after finishing a job
  }

  logger.info("shutdown complete", { workerId: WORKER_ID });
  process.exit(0);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

logger.info("worker started", { workerId: WORKER_ID, jobType: WORKER_JOB_TYPE, idlePollMs: IDLE_POLL_MS });
poll().catch((err) => {
  logger.error("unhandled error in poll loop", { message: err?.message, stack: err?.stack });
  process.exit(1);
});
