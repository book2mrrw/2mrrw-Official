import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { processVideoTranscodeJob } from "../video-transcoder.js";
import { LeaseLost, leaseOf } from "../media-lane.js";

// This suite covers SEQUENCING and ERROR-HANDLING only — every engine this
// orchestrator wires together (SourceAnalyzer, RenditionPlanner, CodecEngine,
// QualityEvaluator, PackagingEngine, PeekGenerator) is already unit-tested in
// its own file. Nothing here re-tests FFmpeg behavior. The lane holds no
// credential: its storage, content key and video details come from a fake
// website session, its publication from fake lane functions.

const FOLDER = "2MRRW Studios/Audio Visualz/test-video/renditions/version-1/g3/";

function baseJob(overrides = {}) {
  return {
    id: "job-1",
    source_key: "2MRRW Studios/Audio Visualz/test-video/master-1.mov",
    asset_version_id: "version-1",
    job_type: "video",
    attempt_count: 1,
    worker_id: "video-host-1",
    claim_token: "lease-1",
    generation: 3,
    ...overrides,
  };
}

/** The lane functions, recorded; each answers as a held lease would unless told otherwise. */
function fakeRpc(answers = {}) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name in answers) return answers[name];
    return name === "hls_commit_video_job" ? { committed: true, generation: 3 } : true;
  };
  rpc.calls = calls;
  return rpc;
}

/** The website's session for this lease (lane-transfers.js), recorded. */
function fakeLane({ context, prefix = FOLDER, refuse = false } = {}) {
  const lane = {
    context: context === undefined ? { audio_visual_id: "video-1", asset_version_id: "version-1", peek_start_seconds: 1, peek_duration_seconds: 6 } : context,
    prefix,
    encryption: { key: "0f".repeat(16), iv: "a5".repeat(16) },
    downloads: [],
    uploads: [],
    async open() {
      if (refuse) throw new LeaseLost("job-1");
      return { context: lane.context, prefix: lane.prefix, encryption: lane.encryption };
    },
    async downloadSource(file) { lane.downloads.push(file); fs.writeFileSync(file, "fake video bytes"); },
    async uploadFiles(items) { lane.uploads.push(...items.map((item) => item.key)); },
  };
  return lane;
}

function baseDeps(overrides = {}) {
  return { rpc: fakeRpc(), lease: leaseOf(baseJob()), lane: fakeLane(), ...overrides };
}

/** Engines for a source that passes every check and plans one 1080p AVC rendition. */
function passingEngines(overrides = {}) {
  return {
    runSourceAnalyzerFn: async () => ({ width: 1920, height: 1080, durationSeconds: 30, hdrMode: "sdr" }),
    validateSourceAnalysisFn: () => ({ passed: true, failures: [] }),
    runDecodeSanityCheckFn: async () => ({ passed: true, exitCode: 0, stderrOutput: "" }),
    runSceneComplexityAnalyzerFn: async () => ({ frameDifferenceMean: 1 }),
    runStoragePreflightFn: async () => ({ verdict: "ok", requiredScratchBytes: 1, availableScratchBytes: 999, safetyReserveBytes: 1 }),
    planRenditionsFn: () => ([
      { codecFamily: "avc", resolutionLabel: "1080p", width: 1920, height: 1080, bitDepth: 8, hdrMode: "sdr", requiresToneMap: false, crf: 21, preset: "slow" },
    ]),
    runQualityGatedEncodeFn: async ({ outputDir }) => {
      fs.writeFileSync(path.join(outputDir, "init.mp4"), "init");
      fs.writeFileSync(path.join(outputDir, "seg_00001.m4s"), "seg");
      fs.writeFileSync(path.join(outputDir, "playlist.m3u8"), "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6.0,\nseg_00001.m4s\n");
      return { encodeResult: { playlistPath: path.join(outputDir, "playlist.m3u8") }, scores: { vmaf: 95, cambi: 2, ssim: 0.98 }, rendition: {}, attempts: 1 };
    },
    validatePackagedOutputFn: () => ({ passed: true, failures: [], totalDuration: 30, segmentCount: 1 }),
    encryptRenditionSegmentsFn: async () => ({ encryptedFiles: ["init.mp4", "seg_00001.m4s"], keyHex: "a".repeat(32), ivHex: "b".repeat(32) }),
    rewritePlaylistForEncryptionFn: (text) => text.replace("#EXT-X-MAP", "#EXT-X-KEY:METHOD=AES-128,URI=\"placeholder\"\n#EXT-X-MAP"),
    generatePeekClipFn: async ({ outputPath }) => { fs.writeFileSync(outputPath, "peek"); return { outputPath }; },
    ...overrides,
  };
}

let scratchRoot;
test.beforeEach(() => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "video-transcoder-test-"));
  process.env.VIDEO_SCRATCH_ROOT = scratchRoot;
});
test.afterEach(() => {
  delete process.env.VIDEO_SCRATCH_ROOT;
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

test("rejects a job with no asset_version_id before contacting anything", async () => {
  const deps = baseDeps();
  await assert.rejects(
    () => processVideoTranscodeJob(baseJob({ asset_version_id: null }), deps),
    (err) => {
      assert.match(err.message, /has no asset_version_id/);
      assert.equal(err.failureCategory, "VALIDATION_FAILURE");
      return true;
    }
  );
  assert.deepEqual(deps.lane.downloads, []);
});

test("requires rpc, lease and lane — never silently defaults to a real database or storage client", async () => {
  await assert.rejects(() => processVideoTranscodeJob(baseJob(), {}), /rpc, lease and lane are all required/);
  const { lane, ...withoutLane } = baseDeps();
  await assert.rejects(() => processVideoTranscodeJob(baseJob(), withoutLane), /are all required/);
});

test("a version the website does not know fails as INPUT_NOT_FOUND, before any download", async () => {
  for (const context of [null, { audio_visual_id: "video-1", asset_version_id: "another-version" }]) {
    const deps = baseDeps({ lane: fakeLane({ context }) });
    await assert.rejects(() => processVideoTranscodeJob(baseJob(), deps), (err) => err.failureCategory === "INPUT_NOT_FOUND");
    assert.deepEqual(deps.lane.downloads, []);
  }
});

test("a lease the website refuses stops the job before anything is downloaded", async () => {
  const deps = baseDeps({ lane: fakeLane({ refuse: true }) });
  await assert.rejects(() => processVideoTranscodeJob(baseJob(), deps), (err) => err instanceof LeaseLost);
  assert.deepEqual(deps.lane.downloads, []);
});

test("happy path: downloads the master, encodes with the handed-over content key, uploads under its generation, and publishes in one fenced commit", async () => {
  const encrypted = [];
  const deps = baseDeps({
    ...passingEngines({
      encryptRenditionSegmentsFn: async (args) => { encrypted.push(args); return { encryptedFiles: [], keyHex: "", ivHex: "" }; },
    }),
  });

  await processVideoTranscodeJob(baseJob(), deps);

  assert.equal(deps.lane.downloads.length, 1);
  assert.deepEqual(deps.lane.uploads.sort(), [`${FOLDER}avc-1080p/init.mp4`, `${FOLDER}avc-1080p/playlist.m3u8`, `${FOLDER}avc-1080p/seg_00001.m4s`, `${FOLDER}peek.mp4`]);
  assert.equal(encrypted[0].key.toString("hex"), "0f".repeat(16), "the website's content key, never a derived one");
  assert.equal(encrypted[0].iv.toString("hex"), "a5".repeat(16));
  assert.deepEqual(deps.rpc.calls.map((c) => c.name), ["hls_video_job_encoding", "hls_commit_video_job"]);
  const lease = { p_job_id: "job-1", p_worker_id: "video-host-1", p_claim_token: "lease-1", p_generation: 3 };
  for (const call of deps.rpc.calls) {
    assert.deepEqual({ p_job_id: call.args.p_job_id, p_worker_id: call.args.p_worker_id, p_claim_token: call.args.p_claim_token, p_generation: call.args.p_generation }, lease, `${call.name} names the lease`);
  }
  const commit = deps.rpc.calls[1].args;
  assert.equal(commit.p_peek_r2_key, `${FOLDER}peek.mp4`);
  assert.deepEqual(commit.p_renditions.map((r) => [r.codec_family, r.resolution_label, r.hls_prefix, r.vmaf_score]), [["avc", "1080p", `${FOLDER}avc-1080p/`, 95]]);
});

test("a refused commit means another worker holds the job: LeaseLost, and the job is not reported failed", async () => {
  const deps = baseDeps({
    ...passingEngines(),
    rpc: fakeRpc({ hls_commit_video_job: { committed: false, reason: "superseded" } }),
  });
  await assert.rejects(() => processVideoTranscodeJob(baseJob(), deps), (err) => err instanceof LeaseLost);
});

test("a lease lost before encoding stops the job before any rendition is made", async () => {
  let encoded = false;
  const deps = baseDeps({
    ...passingEngines({ runQualityGatedEncodeFn: async () => { encoded = true; return {}; } }),
    rpc: fakeRpc({ hls_video_job_encoding: false }),
  });
  await assert.rejects(() => processVideoTranscodeJob(baseJob(), deps), (err) => err instanceof LeaseLost);
  assert.equal(encoded, false);
});

test("a source validation failure re-throws with the engine's own failureCategory, writes nothing itself, and never reaches rendition encoding", async () => {
  let plannedCalled = false;
  const deps = baseDeps({
    runSourceAnalyzerFn: async () => ({ width: 0, height: 0, durationSeconds: 0 }),
    validateSourceAnalysisFn: () => ({ passed: false, failures: [{ code: "MISSING_VIDEO_DIMENSIONS", message: "no dimensions" }] }),
    planRenditionsFn: () => { plannedCalled = true; return []; },
  });
  await assert.rejects(
    () => processVideoTranscodeJob(baseJob(), deps),
    (err) => {
      assert.equal(err.failureCategory, "VALIDATION_FAILURE");
      assert.match(err.message, /no dimensions/);
      return true;
    }
  );
  assert.equal(plannedCalled, false, "must never reach rendition planning after a source validation failure");
  // The lane records the failure through its fenced hls_fail_media_job (media-lane.js).
  assert.deepEqual(deps.rpc.calls, []);
  assert.deepEqual(deps.lane.uploads, []);
});

test("an insufficient storage preflight fails as RESOURCE_EXHAUSTION before any rendition is encoded", async () => {
  let encodeCalled = false;
  const deps = baseDeps(passingEngines({
    runStoragePreflightFn: async () => ({ verdict: "insufficient", requiredScratchBytes: 999, availableScratchBytes: 1, safetyReserveBytes: 1 }),
    runQualityGatedEncodeFn: async () => { encodeCalled = true; return {}; },
  }));
  await assert.rejects(() => processVideoTranscodeJob(baseJob(), deps), (err) => err.failureCategory === "RESOURCE_EXHAUSTION");
  assert.equal(encodeCalled, false);
});

test("a rendition that never meets quality thresholds propagates OUTPUT_VALIDATION_FAILURE and never reaches Peek generation or publication", async () => {
  let peekCalled = false;
  const qualityErr = Object.assign(new Error("never met thresholds"), { failureCategory: "OUTPUT_VALIDATION_FAILURE" });
  const deps = baseDeps(passingEngines({
    runQualityGatedEncodeFn: async () => { throw qualityErr; },
    generatePeekClipFn: async () => { peekCalled = true; },
  }));
  await assert.rejects(() => processVideoTranscodeJob(baseJob(), deps), (err) => err.failureCategory === "OUTPUT_VALIDATION_FAILURE");
  assert.equal(peekCalled, false);
  assert.ok(!deps.rpc.calls.some((c) => c.name === "hls_commit_video_job"));
});

test("the lease-scoped scratch directory is always cleaned up, even when the pipeline fails", async () => {
  let capturedScratchDir = null;
  const deps = baseDeps({
    createJobWorkDirFn: (jobId, attemptId) => {
      const dir = path.join(scratchRoot, jobId, String(attemptId));
      fs.mkdirSync(dir, { recursive: true });
      capturedScratchDir = dir;
      return dir;
    },
    cleanupJobWorkDirFn: (jobId, attemptId) => {
      fs.rmSync(path.join(scratchRoot, jobId, String(attemptId)), { recursive: true, force: true });
    },
    runSourceAnalyzerFn: async () => { throw Object.assign(new Error("probe failed"), { failureCategory: "PROBE_FAILURE" }); },
  });

  await assert.rejects(() => processVideoTranscodeJob(baseJob(), deps));
  assert.ok(capturedScratchDir?.endsWith(path.join("job-1", "lease-1")), "named by the lease");
  assert.equal(fs.existsSync(capturedScratchDir), false, "scratch dir must be removed even on failure");
});
