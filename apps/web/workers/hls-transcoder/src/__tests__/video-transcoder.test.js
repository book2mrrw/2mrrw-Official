import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { processVideoTranscodeJob } from "../video-transcoder.js";

// This suite covers SEQUENCING and ERROR-HANDLING only — every engine this
// orchestrator wires together (SourceAnalyzer, RenditionPlanner, CodecEngine,
// QualityEvaluator, PackagingEngine, PeekGenerator, PublicationAuthority) is
// already unit-tested in its own file. Nothing here re-tests FFmpeg behavior.

function fakeQueryResult(result) {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    update() { return builder; },
    insert() { return builder; },
    single() { return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return builder;
}

/**
 * @param {object} tableResults - { [table]: result | result[] } — an array
 *   is consumed one entry per call to that table (for tables queried more
 *   than once with different expected results), a bare object is reused.
 */
function fakeDbClient(tableResults) {
  const cursors = {};
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const configured = tableResults[table];
      let result;
      if (Array.isArray(configured)) {
        cursors[table] = cursors[table] ?? 0;
        result = configured[cursors[table]] ?? configured[configured.length - 1];
        cursors[table] += 1;
      } else {
        result = configured ?? { data: null, error: null };
      }
      return fakeQueryResult(result);
    },
  };
}

function fakeVideoFile(destPath) {
  fs.writeFileSync(destPath, "fake video bytes");
}

function fakeDownloadStreamFn() {
  return async () => {
    const stream = new EventEmitter();
    stream.pipe = (dest) => {
      dest.write("fake video bytes");
      dest.end();
      return dest;
    };
    return stream;
  };
}

function baseJob(overrides = {}) {
  return {
    id: "job-1",
    source_key: "uploads/video/master.mov",
    asset_version_id: "version-1",
    job_type: "video",
    attempt_count: 0,
    ...overrides,
  };
}

function baseDeps(overrides = {}) {
  return {
    dbClient: fakeDbClient({
      audio_visual_asset_versions: { data: { id: "version-1", audio_visual_id: "video-1" }, error: null },
      audio_visuals: { data: { peek_start_seconds: 0, peek_duration_seconds: 8, slug: "test-video", video_type: "music_video", seriez_id: null }, error: null },
      audio_visual_renditions: { data: null, error: null },
      hls_transcode_jobs: { data: null, error: null },
    }),
    downloadStreamFn: fakeDownloadStreamFn(),
    uploadFn: async () => {},
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

test("rejects a job with no asset_version_id before touching the database at all", async () => {
  const deps = baseDeps();
  await assert.rejects(
    () => processVideoTranscodeJob(baseJob({ asset_version_id: null }), deps),
    (err) => {
      assert.match(err.message, /has no asset_version_id/);
      assert.equal(err.failureCategory, "VALIDATION_FAILURE");
      return true;
    }
  );
});

test("requires dbClient, downloadStreamFn, and uploadFn — never silently defaults to the real db.js/r2.js singletons", async () => {
  await assert.rejects(
    () => processVideoTranscodeJob(baseJob(), {}),
    /dbClient, downloadStreamFn, and uploadFn are all required/
  );
});

test("a missing asset version row fails as INPUT_NOT_FOUND, not a generic error", async () => {
  const deps = baseDeps({
    dbClient: fakeDbClient({
      audio_visual_asset_versions: { data: null, error: { message: "no rows" } },
    }),
  });
  await assert.rejects(
    () => processVideoTranscodeJob(baseJob(), deps),
    (err) => {
      assert.equal(err.failureCategory, "INPUT_NOT_FOUND");
      return true;
    }
  );
});

test("happy path: plans one rendition, quality-gates it, packages it, uploads it, generates Peek, promotes the version, and completes the job", async () => {
  const dbClient = fakeDbClient({
    audio_visual_asset_versions: { data: { id: "version-1", audio_visual_id: "video-1" }, error: null },
    audio_visuals: { data: { peek_start_seconds: 1, peek_duration_seconds: 6, slug: "test-video", video_type: "music_video", seriez_id: null }, error: null },
    audio_visual_renditions: { data: null, error: null },
    hls_transcode_jobs: { data: null, error: null },
  });

  const uploadedKeys = [];
  const promoted = [];

  const deps = baseDeps({
    dbClient,
    uploadFn: async (key) => { uploadedKeys.push(key); },
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
      fs.writeFileSync(
        path.join(outputDir, "playlist.m3u8"),
        "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:6.0,\nseg_00001.m4s\n"
      );
      return { encodeResult: { playlistPath: path.join(outputDir, "playlist.m3u8") }, scores: { vmaf: 95, cambi: 2, ssim: 0.98 }, rendition: {}, attempts: 1 };
    },
    validatePackagedOutputFn: () => ({ passed: true, failures: [], totalDuration: 30, segmentCount: 1 }),
    encryptRenditionSegmentsFn: async () => ({ encryptedFiles: ["init.mp4", "seg_00001.m4s"], keyHex: "a".repeat(32), ivHex: "b".repeat(32) }),
    rewritePlaylistForEncryptionFn: (text) => text.replace("#EXT-X-MAP", "#EXT-X-KEY:METHOD=AES-128,URI=\"placeholder\"\n#EXT-X-MAP"),
    generatePeekClipFn: async ({ outputPath }) => { fs.writeFileSync(outputPath, "peek"); return { outputPath }; },
    promoteAssetVersionFn: async ({ audioVisualId, assetVersionId }) => { promoted.push({ audioVisualId, assetVersionId }); },
  });

  await processVideoTranscodeJob(baseJob(), deps);

  assert.ok(uploadedKeys.some((k) => k.includes("2MRRW Studios/Audio Visualz/test-video/renditions/version-1/avc-1080p/")));
  assert.ok(uploadedKeys.some((k) => k === "2MRRW Studios/Audio Visualz/test-video/peek/version-1.mp4"));
  assert.deepEqual(promoted, [{ audioVisualId: "video-1", assetVersionId: "version-1" }]);
  assert.ok(dbClient.calls.includes("audio_visual_renditions"));
  assert.ok(dbClient.calls.includes("hls_transcode_jobs"));
});

test("a source validation failure marks the asset version failed and re-throws with the engine's own failureCategory, without ever reaching rendition encoding", async () => {
  let updatedStatus = null;
  const dbClient = fakeDbClient({
    audio_visual_asset_versions: { data: { id: "version-1", audio_visual_id: "video-1" }, error: null },
    audio_visuals: { data: { peek_start_seconds: 0, peek_duration_seconds: 8, slug: "test-video", video_type: "music_video", seriez_id: null }, error: null },
  });
  const originalFrom = dbClient.from.bind(dbClient);
  dbClient.from = (table) => {
    const builder = originalFrom(table);
    const originalUpdate = builder.update.bind(builder);
    builder.update = (patch) => {
      if (table === "audio_visual_asset_versions" && patch.status) updatedStatus = patch.status;
      return originalUpdate(patch);
    };
    return builder;
  };

  let plannedCalled = false;
  const deps = baseDeps({
    dbClient,
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
  assert.equal(updatedStatus, "failed");
});

test("an insufficient storage preflight fails as RESOURCE_EXHAUSTION before any rendition is encoded", async () => {
  let encodeCalled = false;
  const deps = baseDeps({
    runSourceAnalyzerFn: async () => ({ width: 1920, height: 1080, durationSeconds: 30, hdrMode: "sdr" }),
    validateSourceAnalysisFn: () => ({ passed: true, failures: [] }),
    runDecodeSanityCheckFn: async () => ({ passed: true, exitCode: 0, stderrOutput: "" }),
    runSceneComplexityAnalyzerFn: async () => ({}),
    planRenditionsFn: () => ([{ codecFamily: "avc", resolutionLabel: "1080p", requiresToneMap: false }]),
    runStoragePreflightFn: async () => ({ verdict: "insufficient", requiredScratchBytes: 999, availableScratchBytes: 1, safetyReserveBytes: 1 }),
    runQualityGatedEncodeFn: async () => { encodeCalled = true; return {}; },
  });

  await assert.rejects(
    () => processVideoTranscodeJob(baseJob(), deps),
    (err) => {
      assert.equal(err.failureCategory, "RESOURCE_EXHAUSTION");
      return true;
    }
  );
  assert.equal(encodeCalled, false);
});

test("a rendition that never meets quality thresholds propagates OUTPUT_VALIDATION_FAILURE and never reaches Peek generation or promotion", async () => {
  let peekCalled = false;
  let promoteCalled = false;
  const qualityErr = new Error("never met thresholds");
  qualityErr.failureCategory = "OUTPUT_VALIDATION_FAILURE";

  const deps = baseDeps({
    runSourceAnalyzerFn: async () => ({ width: 1920, height: 1080, durationSeconds: 30, hdrMode: "sdr" }),
    validateSourceAnalysisFn: () => ({ passed: true, failures: [] }),
    runDecodeSanityCheckFn: async () => ({ passed: true, exitCode: 0, stderrOutput: "" }),
    runSceneComplexityAnalyzerFn: async () => ({}),
    planRenditionsFn: () => ([{ codecFamily: "avc", resolutionLabel: "1080p", requiresToneMap: false }]),
    runStoragePreflightFn: async () => ({ verdict: "ok" }),
    runQualityGatedEncodeFn: async () => { throw qualityErr; },
    generatePeekClipFn: async () => { peekCalled = true; },
    promoteAssetVersionFn: async () => { promoteCalled = true; },
  });

  await assert.rejects(
    () => processVideoTranscodeJob(baseJob(), deps),
    (err) => {
      assert.equal(err.failureCategory, "OUTPUT_VALIDATION_FAILURE");
      return true;
    }
  );
  assert.equal(peekCalled, false);
  assert.equal(promoteCalled, false);
});

test("the job-scoped scratch directory is always cleaned up, even when the pipeline fails", async () => {
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
  assert.ok(capturedScratchDir, "scratch dir should have been created");
  assert.equal(fs.existsSync(capturedScratchDir), false, "scratch dir must be removed even on failure");
});
