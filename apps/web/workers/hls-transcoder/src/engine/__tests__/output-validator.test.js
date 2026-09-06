import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validatePackagedOutput } from "../output-validator.js";

function makeOutputDir({ playlist, segments = ["seg_00000.m4s"], writeInit = true, writeSegments = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "output-validator-test-"));
  if (writeInit) fs.writeFileSync(path.join(dir, "init.mp4"), "fake init bytes");
  if (writeSegments) {
    for (const seg of segments) fs.writeFileSync(path.join(dir, seg), "fake segment bytes");
  }
  if (playlist !== null) {
    fs.writeFileSync(
      path.join(dir, "playlist.m3u8"),
      playlist ??
        [
          "#EXTM3U",
          "#EXT-X-VERSION:7",
          "#EXT-X-TARGETDURATION:6",
          "#EXT-X-MAP:URI=\"init.mp4\"",
          "#EXTINF:6.006006,",
          "seg_00000.m4s",
          "#EXT-X-ENDLIST",
        ].join("\n")
    );
  }
  return dir;
}

test("a well-formed playlist with all referenced files present passes", () => {
  const dir = makeOutputDir();
  try {
    const result = validatePackagedOutput({ outputDir: dir });
    assert.equal(result.passed, true);
    assert.deepEqual(result.failures, []);
    assert.equal(result.segmentCount, 1);
    assert.ok(Math.abs(result.totalDuration - 6.006006) < 1e-6);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing playlist.m3u8 fails immediately with a clear message, not a generic filesystem error", () => {
  const dir = makeOutputDir({ playlist: null });
  try {
    const result = validatePackagedOutput({ outputDir: dir });
    assert.equal(result.passed, false);
    assert.match(result.failures[0].message, /playlist\.m3u8 does not exist/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a playlist missing the #EXT-X-MAP init reference is rejected", () => {
  const dir = makeOutputDir({ playlist: "#EXTM3U\n#EXTINF:6.0,\nseg_00000.m4s\n#EXT-X-ENDLIST" });
  try {
    const result = validatePackagedOutput({ outputDir: dir });
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((f) => /no #EXT-X-MAP/.test(f.message)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a playlist referencing an init or segment file that doesn't actually exist on disk is rejected", () => {
  const dir = makeOutputDir({ writeInit: false });
  try {
    const result = validatePackagedOutput({ outputDir: dir });
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((f) => /init segment file missing/.test(f.message)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a playlist with zero media segments is rejected", () => {
  const dir = makeOutputDir({ playlist: "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXT-X-ENDLIST" });
  try {
    const result = validatePackagedOutput({ outputDir: dir });
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((f) => /zero media segments/.test(f.message)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("upscale is rejected: an expected rendition taller than the source fails, even if the files themselves are all present", () => {
  const dir = makeOutputDir();
  try {
    const result = validatePackagedOutput({
      outputDir: dir,
      expectedRendition: { height: 1440 },
      sourceAnalysis: { height: 1080, durationSeconds: 6.006006 },
    });
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((f) => /upscale is never permitted/.test(f.message)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a rendition at or below the source height passes the upscale check", () => {
  const dir = makeOutputDir();
  try {
    const result = validatePackagedOutput({
      outputDir: dir,
      expectedRendition: { height: 720 },
      sourceAnalysis: { height: 1080, durationSeconds: 6.006006 },
    });
    assert.equal(result.passed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("packaged duration significantly diverging from source duration is rejected", () => {
  const dir = makeOutputDir(); // playlist totals ~6.006s
  try {
    const result = validatePackagedOutput({
      outputDir: dir,
      sourceAnalysis: { durationSeconds: 120, height: 1080 },
      durationToleranceSeconds: 2,
    });
    assert.equal(result.passed, false);
    assert.ok(result.failures.some((f) => /differs from source duration/.test(f.message)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("packaged duration within tolerance of source duration passes", () => {
  const dir = makeOutputDir();
  try {
    const result = validatePackagedOutput({
      outputDir: dir,
      sourceAnalysis: { durationSeconds: 6.5, height: 1080 },
      durationToleranceSeconds: 2,
    });
    assert.equal(result.passed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("multiple simultaneous problems are all reported together, not just the first one found", () => {
  const dir = makeOutputDir({ writeInit: false, writeSegments: false });
  try {
    const result = validatePackagedOutput({
      outputDir: dir,
      expectedRendition: { height: 4000 },
      sourceAnalysis: { height: 1080, durationSeconds: 6.006006 },
    });
    const messages = result.failures.map((f) => f.message).join(" | ");
    assert.match(messages, /init segment file missing/);
    assert.match(messages, /segment file missing/);
    assert.match(messages, /upscale is never permitted/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
