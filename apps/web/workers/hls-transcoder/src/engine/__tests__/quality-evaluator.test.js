import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  evaluateRenditionQuality,
  meetsQualityThresholds,
  runQualityGatedEncode,
} from "../quality-evaluator.js";

function fakeSpawnProcess({ exitCode = 0, stderrChunks = [] } = {}) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of stderrChunks) proc.stderr.emit("data", Buffer.from(chunk));
    proc.emit("close", exitCode);
  });
  return proc;
}

// Real shape confirmed live against the production video machine's libvmaf
// JSON output (log_fmt=json, feature=name=cambi|name=float_ssim).
function realisticVmafLog({ vmaf = 95.2, cambi = 0.42, ssim = 0.994 } = {}) {
  return JSON.stringify({
    version: "3.0.0",
    fps: 19.5,
    frames: [{ frameNum: 0, metrics: { vmaf, cambi, float_ssim: ssim } }],
    pooled_metrics: {
      vmaf: { min: vmaf - 1, max: vmaf + 1, mean: vmaf, harmonic_mean: vmaf - 0.01 },
      cambi: { min: cambi - 0.1, max: cambi + 0.1, mean: cambi, harmonic_mean: cambi - 0.01 },
      float_ssim: { min: ssim - 0.01, max: ssim + 0.01, mean: ssim, harmonic_mean: ssim - 0.001 },
    },
    aggregate_metrics: {},
  });
}

test("evaluateRenditionQuality: builds the confirmed-working libvmaf invocation (distorted first, reference second, cambi+float_ssim requested, JSON log)", async () => {
  let capturedArgs = null;
  const spawnFn = (bin, args) => {
    capturedArgs = args;
    return fakeSpawnProcess({ exitCode: 0 });
  };
  const readFileFn = async () => realisticVmafLog();

  await evaluateRenditionQuality({
    referencePath: "/data/master.mov",
    distortedPath: "/data/out/720p/playlist.m3u8",
    logPath: "/data/out/720p/quality-log-attempt-1.json",
    spawnFn,
    readFileFn,
  });

  const iIndexes = [];
  capturedArgs.forEach((v, i) => { if (v === "-i") iIndexes.push(i); });
  assert.equal(capturedArgs[iIndexes[0] + 1], "/data/out/720p/playlist.m3u8");
  assert.equal(capturedArgs[iIndexes[1] + 1], "/data/master.mov");
  const lavfiIndex = capturedArgs.indexOf("-lavfi");
  assert.match(capturedArgs[lavfiIndex + 1], /libvmaf=feature=name=cambi\|name=float_ssim/);
  assert.match(capturedArgs[lavfiIndex + 1], /log_path=\/data\/out\/720p\/quality-log-attempt-1\.json/);
  assert.match(capturedArgs[lavfiIndex + 1], /log_fmt=json/);
});

test("evaluateRenditionQuality: parses the real confirmed pooled_metrics shape into { vmaf, cambi, ssim }", async () => {
  const result = await evaluateRenditionQuality({
    referencePath: "/data/master.mov",
    distortedPath: "/data/out/playlist.m3u8",
    logPath: "/data/out/quality-log.json",
    spawnFn: () => fakeSpawnProcess({ exitCode: 0 }),
    readFileFn: async () => realisticVmafLog({ vmaf: 93.5, cambi: 0.61, ssim: 0.991 }),
  });
  assert.equal(result.vmaf, 93.5);
  assert.equal(result.cambi, 0.61);
  assert.equal(result.ssim, 0.991);
  assert.ok(result.raw.pooled_metrics);
});

test("evaluateRenditionQuality: a nonzero FFmpeg exit is categorized as FFMPEG_FAILURE", async () => {
  await assert.rejects(
    () => evaluateRenditionQuality({
      referencePath: "/data/master.mov",
      distortedPath: "/data/out/playlist.m3u8",
      logPath: "/data/out/quality-log.json",
      spawnFn: () => fakeSpawnProcess({ exitCode: 1, stderrChunks: ["libvmaf: invalid feature"] }),
      readFileFn: async () => realisticVmafLog(),
    }),
    (err) => {
      assert.match(err.message, /invalid feature/);
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});

test("evaluateRenditionQuality: a spawn-level error is also categorized as FFMPEG_FAILURE", async () => {
  const spawnFn = () => {
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit("error", new Error("ENOENT")));
    return proc;
  };
  await assert.rejects(
    () => evaluateRenditionQuality({
      referencePath: "/data/master.mov", distortedPath: "/data/out/playlist.m3u8",
      logPath: "/data/out/quality-log.json", spawnFn, readFileFn: async () => realisticVmafLog(),
    }),
    (err) => {
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});

test("evaluateRenditionQuality: malformed/missing pooled_metrics.vmaf.mean is OUTPUT_VALIDATION_FAILURE, not silently treated as a passing score", async () => {
  await assert.rejects(
    () => evaluateRenditionQuality({
      referencePath: "/data/master.mov", distortedPath: "/data/out/playlist.m3u8",
      logPath: "/data/out/quality-log.json",
      spawnFn: () => fakeSpawnProcess({ exitCode: 0 }),
      readFileFn: async () => JSON.stringify({ pooled_metrics: {} }),
    }),
    (err) => {
      assert.match(err.message, /missing pooled_metrics\.vmaf\.mean/);
      assert.equal(err.failureCategory, "OUTPUT_VALIDATION_FAILURE");
      return true;
    }
  );
});

test("evaluateRenditionQuality: unparseable JSON log is OUTPUT_VALIDATION_FAILURE", async () => {
  await assert.rejects(
    () => evaluateRenditionQuality({
      referencePath: "/data/master.mov", distortedPath: "/data/out/playlist.m3u8",
      logPath: "/data/out/quality-log.json",
      spawnFn: () => fakeSpawnProcess({ exitCode: 0 }),
      readFileFn: async () => "not json{{{",
    }),
    (err) => {
      assert.equal(err.failureCategory, "OUTPUT_VALIDATION_FAILURE");
      return true;
    }
  );
});

// ── meetsQualityThresholds ──

test("meetsQualityThresholds: passes when vmaf/ssim meet their floors and cambi is under its ceiling", () => {
  assert.equal(
    meetsQualityThresholds({ vmaf: 95, cambi: 0.4, ssim: 0.99 }, { minVmaf: 90, maxCambi: 5, minSsim: 0.95 }),
    true
  );
});

test("meetsQualityThresholds: fails when vmaf is below its floor", () => {
  assert.equal(meetsQualityThresholds({ vmaf: 80, cambi: 0.4, ssim: 0.99 }, { minVmaf: 90 }), false);
});

test("meetsQualityThresholds: fails when cambi (banding, lower is better) exceeds its ceiling", () => {
  assert.equal(meetsQualityThresholds({ vmaf: 95, cambi: 12, ssim: 0.99 }, { maxCambi: 5 }), false);
});

test("meetsQualityThresholds: fails when ssim is below its floor", () => {
  assert.equal(meetsQualityThresholds({ vmaf: 95, cambi: 0.4, ssim: 0.80 }, { minSsim: 0.95 }), false);
});

test("meetsQualityThresholds: an omitted threshold is simply not checked", () => {
  assert.equal(meetsQualityThresholds({ vmaf: 10, cambi: 999, ssim: 0 }, {}), true);
  assert.equal(meetsQualityThresholds({ vmaf: 95, cambi: 999, ssim: 0.99 }, { minVmaf: 90 }), true);
});

// ── runQualityGatedEncode ──

function fakeRendition(overrides = {}) {
  return { codecFamily: "avc", resolutionLabel: "720p", crf: 23, preset: "medium", ...overrides };
}

test("runQualityGatedEncode: accepts on the first attempt when thresholds are already met — encode/evaluate called exactly once", async () => {
  let encodeCalls = 0;
  let evaluateCalls = 0;
  const encodeFn = async ({ rendition }) => {
    encodeCalls += 1;
    return { playlistPath: `/data/out/${rendition.resolutionLabel}/playlist.m3u8` };
  };
  const evaluateQualityFn = async () => {
    evaluateCalls += 1;
    return { vmaf: 96, cambi: 0.3, ssim: 0.99 };
  };

  const result = await runQualityGatedEncode({
    rendition: fakeRendition(), sourcePath: "/data/master.mov", referencePath: "/data/master.mov",
    outputDir: "/data/out/720p", encodeFn, evaluateQualityFn, thresholds: { minVmaf: 90 },
  });

  assert.equal(encodeCalls, 1);
  assert.equal(evaluateCalls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.scores.vmaf, 96);
  assert.equal(result.rendition.crf, 23);
});

test("runQualityGatedEncode: retries with an adjusted (lower) CRF when the first attempt misses the threshold, and accepts once it passes", async () => {
  const seenCrfs = [];
  const encodeFn = async ({ rendition }) => {
    seenCrfs.push(rendition.crf);
    return { playlistPath: "/data/out/playlist.m3u8" };
  };
  let call = 0;
  const evaluateQualityFn = async () => {
    call += 1;
    return call === 1 ? { vmaf: 80, cambi: 0.3, ssim: 0.99 } : { vmaf: 96, cambi: 0.3, ssim: 0.99 };
  };

  const result = await runQualityGatedEncode({
    rendition: fakeRendition({ crf: 23 }), sourcePath: "/data/master.mov", referencePath: "/data/master.mov",
    outputDir: "/data/out", encodeFn, evaluateQualityFn, thresholds: { minVmaf: 90 }, maxAttempts: 3,
  });

  assert.deepEqual(seenCrfs, [23, 19]);
  assert.equal(result.attempts, 2);
  assert.equal(result.rendition.crf, 19);
});

test("runQualityGatedEncode: default CRF-lowering adjustment never goes below 0", async () => {
  const seenCrfs = [];
  const encodeFn = async ({ rendition }) => {
    seenCrfs.push(rendition.crf);
    return { playlistPath: "/data/out/playlist.m3u8" };
  };
  const evaluateQualityFn = async () => ({ vmaf: 10, cambi: 0.3, ssim: 0.5 }); // never passes

  await assert.rejects(() => runQualityGatedEncode({
    rendition: fakeRendition({ crf: 2 }), sourcePath: "/data/master.mov", referencePath: "/data/master.mov",
    outputDir: "/data/out", encodeFn, evaluateQualityFn, thresholds: { minVmaf: 90 }, maxAttempts: 3,
  }));

  assert.deepEqual(seenCrfs, [2, 0, 0]);
});

test("runQualityGatedEncode: exhausting maxAttempts throws OUTPUT_VALIDATION_FAILURE carrying the last scores/rendition/encode result, never silently accepting a failing rendition", async () => {
  let encodeCalls = 0;
  const encodeFn = async ({ rendition }) => {
    encodeCalls += 1;
    return { playlistPath: `/data/out/attempt-${encodeCalls}.m3u8` };
  };
  const evaluateQualityFn = async () => ({ vmaf: 50, cambi: 0.3, ssim: 0.5 });

  await assert.rejects(
    () => runQualityGatedEncode({
      rendition: fakeRendition(), sourcePath: "/data/master.mov", referencePath: "/data/master.mov",
      outputDir: "/data/out", encodeFn, evaluateQualityFn, thresholds: { minVmaf: 90 }, maxAttempts: 2,
    }),
    (err) => {
      assert.equal(err.failureCategory, "OUTPUT_VALIDATION_FAILURE");
      assert.match(err.message, /failed to meet quality thresholds after 2 attempt/);
      assert.equal(err.lastScores.vmaf, 50);
      assert.ok(err.lastEncodeResult.playlistPath.includes("attempt-2"));
      return true;
    }
  );
  assert.equal(encodeCalls, 2);
});

test("runQualityGatedEncode: a custom adjustSettingsForRetry receives (rendition, attemptNumber, scores) and its return value drives the next encode", async () => {
  const seenArgs = [];
  const encodeFn = async ({ rendition }) => ({ playlistPath: "/data/out/playlist.m3u8", presetSeen: rendition.preset });
  let call = 0;
  const evaluateQualityFn = async () => {
    call += 1;
    return call === 1 ? { vmaf: 70, cambi: 0.3, ssim: 0.99 } : { vmaf: 96, cambi: 0.3, ssim: 0.99 };
  };
  const adjustSettingsForRetry = (rendition, attemptNumber, scores) => {
    seenArgs.push({ crf: rendition.crf, attemptNumber, vmaf: scores.vmaf });
    return { ...rendition, preset: "slow" };
  };

  const result = await runQualityGatedEncode({
    rendition: fakeRendition({ crf: 25, preset: "fast" }), sourcePath: "/data/master.mov",
    referencePath: "/data/master.mov", outputDir: "/data/out", encodeFn, evaluateQualityFn,
    thresholds: { minVmaf: 90 }, adjustSettingsForRetry,
  });

  assert.deepEqual(seenArgs, [{ crf: 25, attemptNumber: 1, vmaf: 70 }]);
  assert.equal(result.rendition.preset, "slow");
});

test("runQualityGatedEncode: each attempt gets its own quality-log path so a retry never clobbers the prior attempt's report", async () => {
  const seenLogPaths = [];
  const encodeFn = async () => ({ playlistPath: "/data/out/playlist.m3u8" });
  let call = 0;
  const evaluateQualityFn = async ({ logPath }) => {
    seenLogPaths.push(logPath);
    call += 1;
    return call === 1 ? { vmaf: 50, cambi: 0.3, ssim: 0.99 } : { vmaf: 96, cambi: 0.3, ssim: 0.99 };
  };

  await runQualityGatedEncode({
    rendition: fakeRendition(), sourcePath: "/data/master.mov", referencePath: "/data/master.mov",
    outputDir: "/data/out/720p", encodeFn, evaluateQualityFn, thresholds: { minVmaf: 90 },
  });

  assert.equal(seenLogPaths.length, 2);
  assert.notEqual(seenLogPaths[0], seenLogPaths[1]);
  assert.ok(seenLogPaths[0].startsWith("/data/out/720p"));
});
