/**
 * Cover art lane worker (2MRRW-Cloud). Claims queued cover versions, makes
 * their silent renditions (transcode.js) and publishes them under cover-art/.
 *
 *   node src/worker.js          keep polling the queue
 *   node src/worker.js --once   drain the queue, then exit (backfill runs)
 *
 * Environment (cover-art.env.example): COVER_ART_DATABASE_URL, R2_ACCOUNT_ID,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME; optional
 * COVER_ART_SCRATCH (work directory), IDLE_POLL_MS.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { claim, closeQueue, complete, fail, heartbeat } from "./queue.js";
import { download, renditionKey, upload } from "./storage.js";
import { transcodeCover } from "./transcode.js";

const once = process.argv.includes("--once");
const workerId = `cover-art:${hostname()}:${process.pid}`;
const idleMs = Number(process.env.IDLE_POLL_MS || 10_000);
const scratchRoot = process.env.COVER_ART_SCRATCH || tmpdir();
let stopping = false;

const log = (event, fields = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), lane: "cover-art", event, ...fields }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function processJob(job) {
  const scratch = mkdtempSync(join(scratchRoot, "cover-art-"));
  const beat = setInterval(() => { heartbeat(job).catch((error) => log("heartbeat_failed", { id: job.id, error: error.message })); }, 60_000);
  const started = Date.now();
  try {
    const input = join(scratch, "source");
    const etag = await download(job.source_key, input);
    // A cover replaced after it was queued is queued again as its own version.
    if (etag !== job.source_etag) throw new Error("the original changed since it was queued");
    const { source, renditions } = await transcodeCover(input, scratch);
    const published = [];
    for (const rendition of renditions) {
      const key = renditionKey(job.source_key, job.source_etag, rendition.id);
      const bytes = await upload(key, rendition.file);
      published.push({ id: rendition.id, key, width: rendition.width, height: rendition.height, bytes });
    }
    await complete(job, published);
    log("ready", { id: job.id, source: job.source_key, size: `${source.width}x${source.height}`, renditions: published.map((r) => r.id), ms: Date.now() - started });
  } catch (error) {
    log("failed", { id: job.id, source: job.source_key, attempt: job.attempt, error: error.message });
    await fail(job, error.message).catch((finishError) => log("fail_report_failed", { id: job.id, error: finishError.message }));
  } finally {
    clearInterval(beat);
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function main() {
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; log("stopping", { signal }); });
  log("started", { worker: workerId, once });
  while (!stopping) {
    const job = await claim(workerId).catch((error) => { log("claim_failed", { error: error.message }); return null; });
    if (job) {
      await processJob(job);
      continue;
    }
    if (once) break;
    await sleep(idleMs);
  }
  await closeQueue();
  log("stopped");
}

main().catch((error) => {
  log("crashed", { error: error.message });
  process.exit(1);
});
