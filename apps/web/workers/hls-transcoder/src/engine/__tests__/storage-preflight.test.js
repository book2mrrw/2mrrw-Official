import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateRequiredScratchBytes,
  getAvailableScratchBytes,
  runStoragePreflight,
  SAFETY_RESERVE_BYTES,
} from "../storage-preflight.js";

const GB = 1024 * 1024 * 1024;

test("estimateRequiredScratchBytes scales with source size, codec family count, and rendition count", () => {
  const oneCodec = estimateRequiredScratchBytes({ sourceFileSizeBytes: 1 * GB, codecFamilies: ["avc"], renditionCount: 4 });
  const twoCodecs = estimateRequiredScratchBytes({ sourceFileSizeBytes: 1 * GB, codecFamilies: ["avc", "av1"], renditionCount: 4 });
  assert.ok(twoCodecs > oneCodec, "a second codec family must increase the estimate");

  const fewerRenditions = estimateRequiredScratchBytes({ sourceFileSizeBytes: 1 * GB, codecFamilies: ["avc"], renditionCount: 2 });
  assert.ok(oneCodec > fewerRenditions, "more renditions must increase the estimate");
});

test("estimateRequiredScratchBytes adds real overhead for HDR sources", () => {
  const sdr = estimateRequiredScratchBytes({ sourceFileSizeBytes: 1 * GB, hasHdr: false });
  const hdr = estimateRequiredScratchBytes({ sourceFileSizeBytes: 1 * GB, hasHdr: true });
  assert.ok(hdr > sdr, "an HDR source must estimate more scratch than the identical SDR case");
});

test("estimateRequiredScratchBytes rejects a non-positive source size — never silently returns 0 or NaN", () => {
  assert.throws(() => estimateRequiredScratchBytes({ sourceFileSizeBytes: 0 }), /must be a positive number/);
  assert.throws(() => estimateRequiredScratchBytes({ sourceFileSizeBytes: -5 }), /must be a positive number/);
  assert.throws(() => estimateRequiredScratchBytes({ sourceFileSizeBytes: NaN }), /must be a positive number/);
});

test("getAvailableScratchBytes reads real free space for the current filesystem via fs.statfsSync", () => {
  const available = getAvailableScratchBytes("/");
  assert.ok(Number.isFinite(available) && available > 0, "must return a real positive byte count for the root filesystem");
});

test("runStoragePreflight returns the exact shape the storage_preflight jsonb column expects", async () => {
  const result = await runStoragePreflight({ sourceFileSizeBytes: 1 * GB, mountPath: "/" });
  assert.equal(typeof result.requiredScratchBytes, "number");
  assert.equal(typeof result.availableScratchBytes, "number");
  assert.equal(result.safetyReserveBytes, SAFETY_RESERVE_BYTES);
  assert.ok(result.verdict === "ok" || result.verdict === "insufficient");
});

test("runStoragePreflight verdict is 'insufficient' when required scratch plus the safety reserve exceeds available space", async () => {
  // An absurdly large source (100 TB) can never fit on any real test machine's root filesystem.
  const result = await runStoragePreflight({ sourceFileSizeBytes: 100 * 1024 * GB, mountPath: "/" });
  assert.equal(result.verdict, "insufficient");
});
