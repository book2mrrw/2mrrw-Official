import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  jobWorkDir,
  createJobWorkDir,
  cleanupJobWorkDir,
  cleanupOrphanedJobDirs,
} from "../scratch-workspace.js";

function useTempScratchRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-workspace-test-"));
  const original = process.env.VIDEO_SCRATCH_ROOT;
  process.env.VIDEO_SCRATCH_ROOT = dir;
  return {
    dir,
    restore: () => {
      if (original === undefined) delete process.env.VIDEO_SCRATCH_ROOT;
      else process.env.VIDEO_SCRATCH_ROOT = original;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("jobWorkDir requires both jobId and attemptId — never a shared/ambiguous directory", () => {
  assert.throws(() => jobWorkDir(null, "1"), /jobId and attemptId are both required/);
  assert.throws(() => jobWorkDir("job-1", null), /jobId and attemptId are both required/);
});

test("each job+attempt gets its own isolated directory, never shared with another job or another attempt of the same job", () => {
  const { restore } = useTempScratchRoot();
  try {
    const a = jobWorkDir("job-1", "1");
    const b = jobWorkDir("job-1", "2");
    const c = jobWorkDir("job-2", "1");
    assert.notEqual(a, b);
    assert.notEqual(a, c);
    assert.notEqual(b, c);
  } finally {
    restore();
  }
});

test("createJobWorkDir actually creates the directory on disk, and is idempotent (no error calling it twice)", () => {
  const { restore } = useTempScratchRoot();
  try {
    const dir = createJobWorkDir("job-1", "1");
    assert.ok(fs.existsSync(dir));
    assert.doesNotThrow(() => createJobWorkDir("job-1", "1"));
  } finally {
    restore();
  }
});

test("cleanupJobWorkDir removes the directory and never throws if it's already gone", () => {
  const { restore } = useTempScratchRoot();
  try {
    const dir = createJobWorkDir("job-1", "1");
    fs.writeFileSync(path.join(dir, "partial.mp4"), "fake bytes");
    cleanupJobWorkDir("job-1", "1");
    assert.ok(!fs.existsSync(dir));
    assert.doesNotThrow(() => cleanupJobWorkDir("job-1", "1"));
  } finally {
    restore();
  }
});

test("cleanupJobWorkDir for one job/attempt never touches a different job's directory", () => {
  const { restore } = useTempScratchRoot();
  try {
    const keep = createJobWorkDir("job-keep", "1");
    createJobWorkDir("job-remove", "1");
    cleanupJobWorkDir("job-remove", "1");
    assert.ok(fs.existsSync(keep), "an unrelated job's directory must survive another job's cleanup");
  } finally {
    restore();
  }
});

test("cleanupOrphanedJobDirs removes only directories the active-job predicate says are no longer active", async () => {
  const { restore } = useTempScratchRoot();
  try {
    createJobWorkDir("job-active", "1");
    createJobWorkDir("job-dead", "1");

    const result = await cleanupOrphanedJobDirs(async (jobId) => jobId === "job-active");

    assert.deepEqual(result.removed, ["job-dead"]);
    assert.equal(result.scanned, 2);
    assert.ok(fs.existsSync(jobWorkDir("job-active", "1")), "the active job's directory must survive the sweep");
    assert.ok(!fs.existsSync(path.dirname(jobWorkDir("job-dead", "1"))), "the dead job's entire directory tree must be removed");
  } finally {
    restore();
  }
});

test("cleanupOrphanedJobDirs on a scratch root that doesn't exist yet is a safe no-op", async () => {
  const original = process.env.VIDEO_SCRATCH_ROOT;
  process.env.VIDEO_SCRATCH_ROOT = path.join(os.tmpdir(), "does-not-exist-" + Date.now());
  try {
    const result = await cleanupOrphanedJobDirs(async () => true);
    assert.deepEqual(result, { scanned: 0, removed: [] });
  } finally {
    if (original === undefined) delete process.env.VIDEO_SCRATCH_ROOT;
    else process.env.VIDEO_SCRATCH_ROOT = original;
  }
});
