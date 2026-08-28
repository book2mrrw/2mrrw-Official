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

// Unique worker ID per process — shown in hls_transcode_jobs.worker_id
const WORKER_ID = `fly-${os.hostname()}-${crypto.randomBytes(4).toString("hex")}`;

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

async function processJob(job) {
  activeJobId = job.id;
  logger.info("job claimed", {
    jobId:     job.id,
    slug:      job.slug,
    trackSlug: job.track_slug,
    bitrates:  job.bitrates,
    workerId:  WORKER_ID,
  });

  try {
    const manifest = await transcode({ job });
    await markJobComplete(job.id, manifest);
    logger.info("job complete", { jobId: job.id, slug: job.slug, trackSlug: job.track_slug });

    // Poster extraction — only for video jobs, non-fatal
    const isVideoJob = manifest.media_kind === "video";
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
  } catch (err) {
    const message = err?.message ?? String(err);
    logger.error("job failed", { jobId: job.id, slug: job.slug, message });
    await markJobFailed(job.id, message).catch((dbErr) => {
      logger.error("markJobFailed error", { jobId: job.id, message: dbErr?.message });
    });
  } finally {
    activeJobId = null;
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

logger.info("worker started", { workerId: WORKER_ID, idlePollMs: IDLE_POLL_MS });
poll().catch((err) => {
  logger.error("unhandled error in poll loop", { message: err?.message, stack: err?.stack });
  process.exit(1);
});
