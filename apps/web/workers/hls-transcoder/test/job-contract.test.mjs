import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSCODE_PROFILE_VERSION,
  assertClaimedJobContract,
} from "../src/job-contract.js";

function job(overrides = {}) {
  return {
    id: "14cdde4f-2558-4de6-b734-23e38cb15175",
    claim_token: "5fe21aab-eed6-47d1-b2af-715fc5953ef6",
    worker_id: "worker-1",
    generation: 7,
    target_profile_version: TRANSCODE_PROFILE_VERSION,
    base_hls_prefix: "hls/singles/example/",
    hls_prefix: "hls/singles/example/versions/g7/",
    ...overrides,
  };
}

test("accepts an exactly matched immutable generation claim", () => {
  assert.doesNotThrow(() => assertClaimedJobContract(job()));
});
test("rejects missing fencing identity", () => {
  assert.throws(() => assertClaimedJobContract(job({ claim_token: null })), /fenced claim/);
});

test("rejects a mutable or cross-generation output prefix", () => {
  assert.throws(
    () => assertClaimedJobContract(job({ hls_prefix: "hls/singles/example/" })),
    /immutable generation/
  );
  assert.throws(
    () => assertClaimedJobContract(job({ hls_prefix: "hls/singles/example/versions/g6/" })),
    /immutable generation/
  );
});

test("fails closed when the queue requests a newer encoding contract", () => {
  assert.throws(
    () => assertClaimedJobContract(job({ target_profile_version: TRANSCODE_PROFILE_VERSION + 1 })),
    /cannot satisfy/
  );
});
