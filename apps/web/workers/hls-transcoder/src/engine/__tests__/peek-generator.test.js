import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { generatePeekClip } from "../peek-generator.js";

function fakeSpawnProcess({ exitCode = 0, stderrChunks = [] } = {}) {
  const proc = new EventEmitter();
  proc.stderr = new EventEmitter();
  queueMicrotask(() => {
    for (const chunk of stderrChunks) proc.stderr.emit("data", Buffer.from(chunk));
    proc.emit("close", exitCode);
  });
  return proc;
}

function baseParams(overrides = {}) {
  return {
    sourcePath: "/data/master.mov",
    outputPath: "/data/out/peek.mp4",
    startSeconds: 12,
    durationSeconds: 8,
    sourceWidth: 1920,
    sourceHeight: 1080,
    spawnFn: () => fakeSpawnProcess({ exitCode: 0 }),
    ...overrides,
  };
}

test("rejects a negative startSeconds", async () => {
  await assert.rejects(
    () => generatePeekClip(baseParams({ startSeconds: -1 })),
    /startSeconds must be a real number >= 0/
  );
});

test("rejects a non-finite startSeconds", async () => {
  await assert.rejects(() => generatePeekClip(baseParams({ startSeconds: NaN })), /startSeconds must be a real number/);
});

test("rejects durationSeconds below the 5s floor", async () => {
  await assert.rejects(
    () => generatePeekClip(baseParams({ durationSeconds: 3 })),
    /durationSeconds must be between 5 and 12/
  );
});

test("rejects durationSeconds above the 12s ceiling", async () => {
  await assert.rejects(
    () => generatePeekClip(baseParams({ durationSeconds: 20 })),
    /durationSeconds must be between 5 and 12/
  );
});

test("accepts the boundary values 5 and 12 exactly", async () => {
  await generatePeekClip(baseParams({ durationSeconds: 5 }));
  await generatePeekClip(baseParams({ durationSeconds: 12 }));
});

test("rejects missing/zero source dimensions rather than silently planning a broken scale filter", async () => {
  await assert.rejects(
    () => generatePeekClip(baseParams({ sourceWidth: 0 })),
    /sourceWidth\/sourceHeight must be known/
  );
  await assert.rejects(
    () => generatePeekClip(baseParams({ sourceHeight: undefined })),
    /sourceWidth\/sourceHeight must be known/
  );
});

test("builds the expected invocation: -ss before -i (fast input-seek), -t for duration, -an present, faststart, libx264", async () => {
  let capturedArgs = null;
  await generatePeekClip(baseParams({
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  }));

  const ssIndex = capturedArgs.indexOf("-ss");
  const iIndex = capturedArgs.indexOf("-i");
  assert.ok(ssIndex !== -1 && ssIndex < iIndex, "-ss must precede -i for fast input-side seeking");
  assert.equal(capturedArgs[ssIndex + 1], "12");

  const tIndex = capturedArgs.indexOf("-t");
  assert.equal(capturedArgs[tIndex + 1], "8");

  assert.ok(capturedArgs.includes("-an"), "Peek must never carry an audio stream, per the Peek Audio Authority design");
  assert.ok(capturedArgs.includes("libx264"));
  assert.match(capturedArgs.join(" "), /-movflags \+faststart/);
});

test("never upscales: a source narrower than the 720px card-optimized cap keeps its own native width", async () => {
  let capturedArgs = null;
  await generatePeekClip(baseParams({
    sourceWidth: 480, sourceHeight: 270,
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  }));
  const vfIndex = capturedArgs.indexOf("-vf");
  assert.match(capturedArgs[vfIndex + 1], /scale=480:-2/);
});

test("caps width at 720 for a source wider than the card-optimized cap", async () => {
  let capturedArgs = null;
  await generatePeekClip(baseParams({
    sourceWidth: 3840, sourceHeight: 2160,
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  }));
  const vfIndex = capturedArgs.indexOf("-vf");
  assert.match(capturedArgs[vfIndex + 1], /scale=720:-2/);
});

test("rounds an odd target width down to the nearest even number", async () => {
  let capturedArgs = null;
  await generatePeekClip(baseParams({
    sourceWidth: 721, sourceHeight: 405,
    spawnFn: (bin, args) => { capturedArgs = args; return fakeSpawnProcess({ exitCode: 0 }); },
  }));
  const vfIndex = capturedArgs.indexOf("-vf");
  assert.match(capturedArgs[vfIndex + 1], /scale=720:-2/);
});

test("a nonzero FFmpeg exit is categorized as FFMPEG_FAILURE with stderr context", async () => {
  await assert.rejects(
    () => generatePeekClip(baseParams({
      spawnFn: () => fakeSpawnProcess({ exitCode: 1, stderrChunks: ["invalid start time"] }),
    })),
    (err) => {
      assert.match(err.message, /invalid start time/);
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});

test("a spawn-level error is also categorized as FFMPEG_FAILURE", async () => {
  const spawnFn = () => {
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => proc.emit("error", new Error("ENOENT")));
    return proc;
  };
  await assert.rejects(
    () => generatePeekClip(baseParams({ spawnFn })),
    (err) => {
      assert.equal(err.failureCategory, "FFMPEG_FAILURE");
      return true;
    }
  );
});
