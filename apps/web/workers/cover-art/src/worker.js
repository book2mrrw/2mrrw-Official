/**
 * Cover art lane worker (2MRRW-Cloud). Claims queued cover versions, makes
 * their silent renditions (transcode.js) and publishes them under cover-art/
 * through links the website signs for the job it holds (lane-api.js).
 *
 *   node src/worker.js          keep polling the queue
 *   node src/worker.js --once   drain the queue, then exit (backfill runs)
 *
 * Environment (cover-art.env.example): COVER_ART_DATABASE_URL; optional
 * COVER_ART_API_URL (the website, default https://www.2mrrw.com),
 * COVER_ART_SCRATCH (work directory), IDLE_POLL_MS. No storage credential.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { claim, closeQueue, complete, fail, heartbeat } from "./queue.js";
import { download, transfers, upload } from "./lane-api.js";
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
    const { source: original } = await transfers(job);
    const etag = await download(original.url, input);
    // A cover replaced after it was queued is queued again as its own version.
    // (A version is "<etag>:r<recipe>", see COVER_ART_RECIPE in lib/cover-art/delivery.js.)
    if (etag !== job.source_etag.split(":")[0]) throw new Error("the original changed since it was queued");
    const { source, renditions } = await transcodeCover(input, scratch);
    const links = await transfers(job, renditions.map((r) => r.id));
    const published = [];
    for (const rendition of renditions) {
      const link = links.uploads.find((u) => u.id === rendition.id);
      if (!link) throw new Error(`no upload link for ${rendition.id}`);
      const bytes = await upload(link.url, rendition.file, links);
      published.push({ id: rendition.id, key: link.key, width: rendition.width, height: rendition.height, bytes });
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
