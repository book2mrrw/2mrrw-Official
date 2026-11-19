import assert from "node:assert/strict";
import test from "node:test";
import { processAudioTranscodeJob } from "../audio-lane.js";
import { LeaseLost, leaseOf } from "../media-lane.js";

const JOB = { id: "job-1", slug: "w2d", track_slug: null, worker_id: "audio-host-1", claim_token: "lease-1", generation: 4 };
const MANIFEST = { slug: "w2d", hls_prefix: "hls/singles/w2d/versions/g4/", transcode_profile_version: 3 };

function fakes({ committed = true } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push(["rpc", name, args]); return committed ? { committed: true, generation: 4 } : { committed: false, reason: "superseded" }; },
    lane: { published: async () => { calls.push(["published"]); return true; } },
    transcodeFn: async ({ job, lane }) => { calls.push(["transcode", job.id, Boolean(lane)]); return MANIFEST; },
  };
}

test("a song is encoded, then published through the fenced commit named by its lease, then its cache refreshed", async () => {
  const f = fakes();
  const lease = leaseOf(JOB);
  await processAudioTranscodeJob(JOB, { rpc: f.rpc, lease, lane: f.lane, transcodeFn: f.transcodeFn });
  assert.deepEqual(f.calls, [
    ["transcode", "job-1", true],
    ["rpc", "hls_commit_transcode_job", { p_job_id: "job-1", p_worker_id: "audio-host-1", p_claim_token: "lease-1", p_generation: 4, p_manifest: MANIFEST }],
    ["published"],
  ]);
});

test("a refused commit is LeaseLost, and nothing is announced", async () => {
  const f = fakes({ committed: false });
  await assert.rejects(() => processAudioTranscodeJob(JOB, { rpc: f.rpc, lease: leaseOf(JOB), lane: f.lane, transcodeFn: f.transcodeFn }), (err) => err instanceof LeaseLost);
  assert.ok(!f.calls.some(([kind]) => kind === "published"));
});

test("requires rpc, lease and lane", async () => {
  await assert.rejects(() => processAudioTranscodeJob(JOB, {}), /rpc, lease and lane are required/);
});
