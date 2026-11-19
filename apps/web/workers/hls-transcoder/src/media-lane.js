/**
 * The worker loop of the two video lanes — music videos / short films /
 * documentaries (job_type 'video') and vault videos ('vault_video') — on the
 * leases of supabase/migrations/20261119120000_hls_media_lane_leases.sql.
 * The audio lane keeps worker-runtime.js.
 *
 * - Claim: hls_claim_media_job hands out one job with a fresh lease token and
 *   counts the attempt; it also retries (or, after three attempts, fails) any
 *   job whose worker stopped renewing for five minutes. Recovery belongs to
 *   the lane, not to a website cron.
 * - Lease: renewed every 30 s. Every write a job makes names its lease
 *   ({ p_job_id, p_worker_id, p_claim_token, p_generation }) and is refused
 *   once the job has moved on, so a worker that lost its job can never publish
 *   over the one that took it.
 * - Lease lost: the job is no longer ours, so the process exits at once (75),
 *   which stops any FFmpeg mid-encode with it; Compose's restart policy starts
 *   it fresh.
 * - Shutdown (SIGTERM/SIGINT, e.g. moving a lane to another host): a busy
 *   worker hands its job straight back (hls_release_media_job, attempt not
 *   spent) and exits, so another host resumes it now rather than after the
 *   lease runs out. A video encode can be hours; there is no draining it.
 * - Scratch: each attempt works in its own directory named by its lease token;
 *   at boot, every directory whose lease is no longer live is removed.
 */

import { logger } from "./logger.js";
import { cleanupDeadAttempts } from "./engine/scratch-workspace.js";

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const EXIT_LEASE_LOST = 75;

/** Failures a retry cannot fix: the source itself is unusable or gone. */
const PERMANENT_FAILURES = new Set(["VALIDATION_FAILURE", "INPUT_NOT_FOUND", "PROBE_FAILURE"]);

/** Thrown when a fenced write is refused: this worker no longer holds the job. */
export class LeaseLost extends Error {
  constructor(jobId) {
    super(`job ${jobId} is no longer held by this worker`);
    this.name = "LeaseLost";
    this.failureCategory = "LEASE_LOST";
  }
}

/** What every fenced write names: the job, its worker, lease token and generation. */
export function leaseOf(job) {
  return { p_job_id: job.id, p_worker_id: job.worker_id, p_claim_token: job.claim_token, p_generation: job.generation };
}

/** Call a lane function; a database error throws. */
export function rpcWith(db) {
  return async (name, args) => {
    const { data, error } = await db.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  };
}

/** A composite NULL arrives as { id: null, ... }: no job. */
function claimed(data) {
  const job = Array.isArray(data) ? data[0] : data;
  return job?.id ? job : null;
}

/** Boot-time scratch sweep: keep only attempts whose lease someone still holds. */
export async function sweepScratch(db) {
  return cleanupDeadAttempts(async (jobId, claimToken) => {
    const { data, error } = await db.from("hls_transcode_jobs").select("id")
      .eq("id", jobId).eq("status", "processing").eq("claim_token", claimToken).maybeSingle();
    return !error && Boolean(data);
  });
}

/**
 * @param {object} opts
 * @param {"video"|"vault_video"} opts.jobType this process's lane, fixed at boot
 * @param {string} opts.workerId
 * @param {(job: object, ctx: { lease: object, rpc: Function }) => Promise<void>} opts.processFn
 *   publishes through fenced functions only and throws LeaseLost when one is refused
 * @param {object} opts.db Supabase client (service role)
 */
export function runMediaLane({
  jobType, workerId, processFn, db, idlePollMs = 5000, heartbeatMs = HEARTBEAT_INTERVAL_MS,
  exit = (code) => process.exit(code), signals = process,
}) {
  const rpc = rpcWith(db);
  let current = null;
  let stopping = false;

  function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    const job = current;
    if (!job) {
      logger.info(`${signal}: idle, exiting`, { lane: jobType, workerId });
      exit(0);
      return;
    }
    logger.info(`${signal}: handing the job back`, { lane: jobType, jobId: job.id });
    rpc("hls_release_media_job", leaseOf(job)).then(
      (released) => logger.info("job handed back", { lane: jobType, jobId: job.id, released }),
      (err) => logger.warn("hand-back failed; its lease expires instead", { lane: jobType, jobId: job.id, message: err.message }),
    ).finally(() => exit(0));
  }
  signals.on("SIGTERM", () => shutdown("SIGTERM"));
  signals.on("SIGINT", () => shutdown("SIGINT"));

  function leaseLost(job, how) {
    if (stopping) return;
    stopping = true;
    logger.error("lease lost — stopping this worker", { lane: jobType, jobId: job.id, how });
    exit(EXIT_LEASE_LOST);
  }

  async function processJob(job) {
    const lease = leaseOf(job);
    current = job;
    logger.info("job claimed", { lane: jobType, jobId: job.id, slug: job.slug, attempt: job.attempt_count, generation: job.generation, workerId });

    const heartbeat = setInterval(() => {
      rpc("hls_heartbeat_media_job", lease).then(
        (held) => { if (held === false && current === job && !stopping) leaseLost(job, "heartbeat refused"); },
        // A failed renewal is retried on the next tick: the lease outlives ten of them.
        (err) => logger.warn("heartbeat failed", { lane: jobType, jobId: job.id, message: err.message }),
      );
    }, heartbeatMs);

    try {
      await processFn(job, { lease, rpc });
      logger.info("job complete", { lane: jobType, jobId: job.id });
    } catch (err) {
      if (stopping) return;
      if (err instanceof LeaseLost) {
        leaseLost(job, err.message);
        return;
      }
      const category = err?.failureCategory || "UNKNOWN";
      const message = String(err?.message ?? err);
      logger.error("job failed", { lane: jobType, jobId: job.id, category, message });
      try {
        const result = await rpc("hls_fail_media_job", {
          ...lease, p_error_message: message, p_failure_category: category, p_retryable: !PERMANENT_FAILURES.has(category),
        });
        if (result?.updated === false) leaseLost(job, "failure refused");
        else logger.info("failure recorded", { lane: jobType, jobId: job.id, status: result?.status, attempt: result?.attempt_count });
      } catch (dbErr) {
        // Unrecorded: the lease expires and the claim retries the job.
        logger.error("recording the failure failed", { lane: jobType, jobId: job.id, message: dbErr.message });
      }
    } finally {
      clearInterval(heartbeat);
      if (current === job) current = null;
    }
  }

  async function poll() {
    while (!stopping) {
      let job = null;
      try {
        job = claimed(await rpc("hls_claim_media_job", { p_worker_id: workerId, p_job_type: jobType }));
      } catch (err) {
        logger.error("claim failed", { lane: jobType, message: err.message });
      }
      if (stopping) break;
      if (job) await processJob(job);
      else await new Promise((resolve) => setTimeout(resolve, idlePollMs));
    }
  }

  logger.info("worker started", { lane: jobType, workerId, idlePollMs });
  return sweepScratch(db)
    .then((swept) => { if (swept.removed.length) logger.info("scratch from dead attempts removed", { lane: jobType, removed: swept.removed }); })
    .catch((err) => logger.warn("scratch sweep failed", { lane: jobType, message: err.message }))
    .then(poll)
    .catch((err) => {
      logger.error("worker loop crashed", { lane: jobType, message: err?.message, stack: err?.stack });
      exit(1);
    });
}
