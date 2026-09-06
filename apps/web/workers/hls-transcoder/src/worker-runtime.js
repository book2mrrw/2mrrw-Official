/**
 * Generic worker lifecycle — the claim/heartbeat/complete-failure loop
 * shared by both lanes. Carries zero media-specific policy: no rendition
 * ladder, no codec assumptions, no FFmpeg invocation, nothing that differs
 * between audio and video. That all lives in each lane's own entry point
 * (audio-worker.js / video-worker.js) and its processFn.
 *
 * Lane identity is fixed at process boot via the `jobType` argument — there
 * is no runtime path that changes which type a running process claims.
 *
 * Shutdown:
 *   SIGTERM / SIGINT → finish the current job, then exit cleanly.
 *   Mid-job crash    → stale-jobs cron rescues the row (audio: fixed
 *                      threshold on started_at, unchanged; video:
 *                      heartbeat_at gone quiet — see
 *                      /api/cron/hls-stale-jobs).
 */

import { logger } from "./logger.js";
import { claimNextJob, markJobFailed, touchHeartbeat } from "./db.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * @param {object} opts
 * @param {"audio"|"video"} opts.jobType — this process's fixed lane. Every
 *   claim request is scoped to exactly this type at the database level
 *   (hls_claim_next_job's WHERE job_type = p_job_type) — this process can
 *   never be handed a job of the other type.
 * @param {string} opts.workerId
 * @param {(job: object) => Promise<void>} opts.processFn — the lane's own
 *   media-specific processor. Owns its full success path (transcode,
 *   markJobComplete, any lane-specific post-processing). Throwing signals
 *   failure; markJobFailed is called generically here in response.
 * @param {number} opts.idlePollMs
 */
export function runWorker({ jobType, workerId, processFn, idlePollMs }) {
  let shuttingDown = false;

  process.on("SIGTERM", () => {
    logger.info("SIGTERM received — draining current job then exiting", { lane: jobType });
    shuttingDown = true;
  });
  process.on("SIGINT", () => {
    logger.info("SIGINT received — draining current job then exiting", { lane: jobType });
    shuttingDown = true;
  });

  async function processClaimedJob(job) {
    // Defense in depth: the atomic claim query already filters by job_type,
    // so this should be structurally impossible — but a lane mismatch is
    // never silently processed anyway. It's recorded as a validation
    // failure, not a generic transcode error.
    if (job.job_type !== jobType) {
      logger.error("claimed job has the wrong job_type — refusing to process it", {
        jobId: job.id, lane: jobType, allowedJobType: jobType, actualJobType: job.job_type,
      });
      await markJobFailed(
        job.id,
        `Lane mismatch: a "${jobType}" worker claimed a "${job.job_type}" job`,
        "VALIDATION_FAILURE"
      ).catch(() => {});
      return;
    }

    logger.info("job claimed", {
      jobId: job.id, jobType, lane: jobType, slug: job.slug, trackSlug: job.track_slug, workerId,
    });

    const heartbeatTimer = setInterval(() => {
      touchHeartbeat(job.id).catch((err) => {
        logger.warn("heartbeat write failed", { jobId: job.id, lane: jobType, message: err?.message });
      });
    }, HEARTBEAT_INTERVAL_MS);

    try {
      await processFn(job);
    } catch (err) {
      const message = err?.message ?? String(err);
      const failureCategory = err?.failureCategory || "UNKNOWN";
      logger.error("job failed", { jobId: job.id, jobType, lane: jobType, message, failureCategory });
      await markJobFailed(job.id, message, failureCategory).catch((dbErr) => {
        logger.error("markJobFailed error", { jobId: job.id, lane: jobType, message: dbErr?.message });
      });
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  async function poll() {
    while (!shuttingDown) {
      let job;
      try {
        job = await claimNextJob(workerId, jobType);
      } catch (err) {
        logger.error("claimNextJob error", { message: err?.message, lane: jobType });
        await sleep(idlePollMs);
        continue;
      }

      if (!job) {
        await sleep(idlePollMs);
        continue;
      }

      await processClaimedJob(job);
      // No sleep here — check for more work immediately after finishing a job
    }

    logger.info("shutdown complete", { workerId, lane: jobType });
    process.exit(0);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  logger.info("worker started", { workerId, lane: jobType, allowedJobType: jobType, idlePollMs });
  poll().catch((err) => {
    logger.error("unhandled error in poll loop", { message: err?.message, stack: err?.stack, lane: jobType });
    process.exit(1);
  });
}
