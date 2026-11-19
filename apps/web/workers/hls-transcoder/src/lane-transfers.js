/**
 * Storage and content keys through the website (POST /api/hls/lane-transfers):
 * the video lanes hold no storage key and no master secret. For the job it
 * holds, a worker gets a read link for its source, write links under that
 * attempt's own folder (`prefix`), that job's content key (`encryption`) and,
 * for a music video, its folder details (`context`). The lease the lane's
 * claim issued is the only proof; a refused lease means the job moved on.
 */

import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { LeaseLost } from "./media-lane.js";

const MINUTE = 60_000;
const BATCH = 500;
const ATTEMPTS = 4;
const apiBase = (env) => (env.HLS_LANE_API_URL || "https://www.2mrrw.com").replace(/\/+$/, "");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry transient failures (network, 5xx, 429) with backoff; anything else throws at once. */
async function withRetries(what, attempt) {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (err.permanent || i >= ATTEMPTS) throw err;
      await pause(1000 * 2 ** (i - 1));
    }
  }
}

function failure(message, status) {
  const err = new Error(message);
  err.permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  return err;
}

/**
 * A session for one held job.
 * @param {object} opts
 * @param {"video"|"vault_video"|"track_visual"} opts.lane
 * @param {object} opts.job the claimed row: id, worker_id, claim_token (or lease_token), generation
 */
export function laneSession({ lane, job, fetchFn = fetch, env = process.env }) {
  const lease = {
    lane,
    job_id: job.id,
    worker_id: job.worker_id,
    lease_token: job.claim_token ?? job.lease_token,
    ...(lane === "track_visual" ? {} : { generation: Number(job.generation) }),
  };
  let opened = null;

  async function call(body) {
    return withRetries("transfers", async () => {
      const res = await fetchFn(`${apiBase(env)}/api/hls/lane-transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(MINUTE),
      });
      if (res.status === 403 && !body.published) {
        const err = new LeaseLost(job.id);
        err.permanent = true;
        throw err;
      }
      if (!res.ok) throw failure(`lane transfers ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
      return res.json();
    });
  }

  return {
    /** The job's folder, content key and context; call before anything else. */
    async open() {
      opened = await call(lease);
      return opened;
    },
    get prefix() { return opened?.prefix; },
    get encryption() { return opened?.encryption; },
    get context() { return opened?.context; },

    /** Download the job's source to `file` (a fresh link each time). */
    async downloadSource(file, { timeoutMs = 120 * MINUTE } = {}) {
      return withRetries("download", async () => {
        const { source } = await call(lease);
        const res = await fetchFn(source.url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok || !res.body) {
          const err = failure(`source download ${res.status}`, res.status);
          // The job's own source is gone: no retry can fix that.
          if (res.status === 404) err.failureCategory = "INPUT_NOT_FOUND";
          throw err;
        }
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
        return fs.statSync(file).size;
      });
    },

    /**
     * Upload [{ key, file, contentType }] under this attempt's folder, in
     * batches of signed links, each with exactly the headers it was signed for.
     */
    async uploadFiles(items) {
      for (let start = 0; start < items.length; start += BATCH) {
        const batch = items.slice(start, start + BATCH);
        const { uploads, cache_control: cacheControl } = await call({
          ...lease, uploads: batch.map((item) => ({ key: item.key, content_type: item.contentType })),
        });
        const files = new Map(batch.map((item) => [item.key, item.file]));
        for (const upload of uploads) {
          await withRetries("upload", async () => {
            const body = fs.readFileSync(files.get(upload.key));
            const res = await fetchFn(upload.url, {
              method: "PUT",
              body,
              headers: { "Content-Type": upload.content_type, "Cache-Control": cacheControl },
              signal: AbortSignal.timeout(10 * MINUTE),
            });
            if (!res.ok) throw failure(`upload ${res.status} ${upload.key}`, res.status);
          });
        }
      }
    },

    /** After a vault video's commit: refresh the website's manifest cache now. Best-effort. */
    async published() {
      try {
        await call({ ...lease, published: true });
        return true;
      } catch {
        return false;
      }
    },
  };
}
