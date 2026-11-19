import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EXIT_LEASE_LOST, LeaseLost, runMediaLane, sweepScratch } from "../media-lane.js";

const JOB = { id: "job-1", slug: "late-night", job_type: "video", worker_id: "w1", claim_token: "lease-1", generation: 2, attempt_count: 1 };
const LEASE = { p_job_id: "job-1", p_worker_id: "w1", p_claim_token: "lease-1", p_generation: 2 };

/** The lane functions over a fake database: claims hand out `jobs` once, then nothing. */
function harness({ jobs = [JOB], answers = {}, live = [] } = {}) {
  const calls = [];
  const queue = [...jobs];
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "hls_claim_media_job") return { data: queue.shift() ?? { id: null }, error: null };
      const answer = name in answers ? answers[name] : name === "hls_fail_media_job" ? { updated: true, status: "pending" } : true;
      return { data: answer, error: null };
    },
    from: () => {
      const filter = {};
      const query = {
        select: () => query,
        eq: (column, value) => { filter[column] = value; return query; },
        maybeSingle: async () => ({ data: live.some(([id, token]) => filter.id === id && filter.claim_token === token) ? { id: filter.id } : null, error: null }),
      };
      return query;
    },
  };
  const signals = new EventEmitter();
  const exits = [];
  const start = (processFn) => runMediaLane({
    jobType: "video", workerId: "w1", processFn, db, idlePollMs: 2, heartbeatMs: 5, exit: (code) => exits.push(code), signals,
  });
  const named = (name) => calls.filter((c) => c.name === name);
  return { db, calls, named, signals, exits, start };
}

/** A job that runs until the test lets it finish (so no lease timer outlives the test). */
function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { wait: () => promise, open };
}

async function until(condition, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

let scratch;
test.beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "media-lane-"));
  process.env.VIDEO_SCRATCH_ROOT = scratch;
});
test.afterEach(() => {
  delete process.env.VIDEO_SCRATCH_ROOT;
  fs.rmSync(scratch, { recursive: true, force: true });
});

test("a claimed job runs with its lease, which is renewed while it runs; success records nothing else", async () => {
  const h = harness();
  let seen;
  const done = h.start(async (job, ctx) => {
    seen = ctx.lease;
    await until(() => h.named("hls_heartbeat_media_job").length >= 2);
  });
  await until(() => seen && h.named("hls_claim_media_job").length >= 2);
  h.signals.emit("SIGTERM");
  await done;
  assert.deepEqual(seen, LEASE);
  assert.deepEqual(h.named("hls_claim_media_job")[0].args, { p_worker_id: "w1", p_job_type: "video" });
  assert.ok(h.named("hls_heartbeat_media_job").every((c) => JSON.stringify(c.args) === JSON.stringify(LEASE)));
  assert.equal(h.named("hls_fail_media_job").length, 0);
  assert.deepEqual(h.exits, [0], "an idle worker exits cleanly on SIGTERM");
});

test("a failure is recorded through the fenced failure: retryable unless the source itself is unusable", async () => {
  for (const [category, retryable] of [["FFMPEG_FAILURE", true], ["VALIDATION_FAILURE", false], [undefined, true]]) {
    const h = harness();
    const done = h.start(async () => { throw Object.assign(new Error("boom"), category ? { failureCategory: category } : {}); });
    await until(() => h.named("hls_fail_media_job").length === 1);
    h.signals.emit("SIGTERM");
    await done;
    assert.deepEqual(h.named("hls_fail_media_job")[0].args,
      { ...LEASE, p_error_message: "boom", p_failure_category: category ?? "UNKNOWN", p_retryable: retryable });
    assert.deepEqual(h.exits, [0]);
  }
});

test("a refused heartbeat stops the worker at once, so no encode outlives its lease", async () => {
  const h = harness({ answers: { hls_heartbeat_media_job: false } });
  const job = gate();
  const done = h.start(job.wait);
  await until(() => h.exits.length > 0);
  await new Promise((resolve) => setTimeout(resolve, 30));
  job.open();
  await done;
  assert.deepEqual(h.exits, [EXIT_LEASE_LOST], "once, and nothing after it");
  assert.equal(h.named("hls_claim_media_job").length, 1, "no further job is claimed");
});

test("a refused publication (LeaseLost) stops the worker and is not recorded as a failure", async () => {
  const h = harness();
  await h.start(async (job) => { throw new LeaseLost(job.id); });
  assert.deepEqual(h.exits, [EXIT_LEASE_LOST]);
  assert.equal(h.named("hls_fail_media_job").length, 0);
});

test("SIGTERM mid-job hands the job straight back, then exits", async () => {
  const h = harness();
  const job = gate();
  const done = h.start(job.wait);
  await until(() => h.named("hls_heartbeat_media_job").length > 0);
  h.signals.emit("SIGTERM");
  await until(() => h.exits.length > 0);
  job.open();
  await done;
  assert.deepEqual(h.named("hls_release_media_job").map((c) => c.args), [LEASE]);
  assert.deepEqual(h.exits, [0]);
  assert.equal(h.named("hls_fail_media_job").length, 0);
});

test("at boot, scratch of every attempt whose lease is gone is removed; a live one is kept", async () => {
  for (const dir of ["job-1/lease-old", "job-1/lease-live", "job-2/lease-gone"]) fs.mkdirSync(path.join(scratch, dir), { recursive: true });
  fs.writeFileSync(path.join(scratch, "job-2/lease-gone/master"), "x");
  const h = harness({ live: [["job-1", "lease-live"]] });
  const { removed } = await sweepScratch(h.db);
  assert.deepEqual(removed.sort(), ["job-1/lease-old", "job-2/lease-gone"]);
  assert.ok(fs.existsSync(path.join(scratch, "job-1/lease-live")));
  assert.ok(!fs.existsSync(path.join(scratch, "job-2")), "an emptied job directory goes too");
});
