#!/usr/bin/env node
/**
 * Phase 5.2 Stage 5 — Master fallback validation (resolver-scoped).
 *
 * Run: node --import ./scripts/register-alias.mjs scripts/test-playback-resolver-fallback.mjs
 */
import assert from "node:assert/strict";
import {
  pickRegisteredStreamFields,
  validateRegisteredStreamFields,
  tryResolveStreamPlaybackKey,
} from "@/lib/playback/resolve-stream-playback.js";
import {
  recordPlaybackResolverOutcome,
  resetPlaybackResolverDiagnostics,
  getPlaybackResolverDiagnostics,
} from "@/lib/playback/playback-resolver-diagnostics.js";
import {
  readHybridStreamingEnvBool,
  isHybridStreamingEnabled,
  isStreamPlaybackPreferred,
} from "@/lib/feature-flags/hybrid-streaming.js";

const VALID_STREAM_KEY = "streaming/singles/hourglass/hourglass.m4a";
const VALID_STREAM_PATH = "streaming/singles/hourglass/";
const MASTER_KEY = "masters/singles/hourglass/hourglass.wav";

const mockAdmin = {
  from() {
    return {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({ data: null, error: null }),
    };
  },
};

const productWithStream = {
  slug: "hour-glass",
  stream_key: VALID_STREAM_KEY,
  stream_path: VALID_STREAM_PATH,
};

/** @type {Record<string, string | undefined>} */
const envSnapshot = {
  HYBRID_STREAMING_ENABLED: process.env.HYBRID_STREAMING_ENABLED,
  STREAM_PLAYBACK_PREFERRED: process.env.STREAM_PLAYBACK_PREFERRED,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(envSnapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function setHybridEnv(hybrid, preferred) {
  if (hybrid == null) delete process.env.HYBRID_STREAMING_ENABLED;
  else process.env.HYBRID_STREAMING_ENABLED = hybrid ? "1" : "0";
  if (preferred == null) delete process.env.STREAM_PLAYBACK_PREFERRED;
  else process.env.STREAM_PLAYBACK_PREFERRED = preferred ? "1" : "0";
}

/**
 * Mirrors resolve-playback-key stream gate (lines 246–261) for master-fallback proof.
 */
async function simulateMasterStreamGate(masterKey, streamAttempt) {
  let audioKey = masterKey;
  let playbackSource = "master";
  let resolverResult = playbackSource;
  let streamFallbackReason = null;

  if (playbackSource === "master" && isStreamPlaybackPreferred()) {
    const attempt = await streamAttempt();
    if (attempt.ok && attempt.key) {
      audioKey = attempt.key;
      playbackSource = "stream";
      resolverResult = "stream";
    } else {
      streamFallbackReason = attempt.fallbackReason || "unknown";
      resolverResult = "master";
    }
  }

  return { audioKey, playbackSource, resolverResult, streamFallbackReason };
}

/** @type {{ id: string, category: string, run: () => Promise<void> | void }[]} */
const scenarios = [];

function scenario(id, category, run) {
  scenarios.push({ id, category, run });
}

// ── pickRegisteredStreamFields ────────────────────────────────────────────────

scenario("pick-products-columns", "registration", () => {
  assert.deepEqual(pickRegisteredStreamFields(productWithStream, null), {
    stream_key: VALID_STREAM_KEY,
    stream_path: VALID_STREAM_PATH,
    source: "products",
  });
});

scenario("pick-products-metadata", "registration", () => {
  assert.deepEqual(
    pickRegisteredStreamFields(
      { slug: "album", metadata: { stream_key: VALID_STREAM_KEY, stream_path: VALID_STREAM_PATH } },
      null
    ),
    { stream_key: VALID_STREAM_KEY, stream_path: VALID_STREAM_PATH, source: "products.metadata" }
  );
});

scenario("pick-catalog-tracks", "registration", () => {
  assert.deepEqual(
    pickRegisteredStreamFields({ slug: "album" }, { stream_key: VALID_STREAM_KEY, stream_path: VALID_STREAM_PATH }),
    { stream_key: VALID_STREAM_KEY, stream_path: VALID_STREAM_PATH, source: "catalog_tracks" }
  );
});

scenario("pick-none", "registration", () => {
  assert.equal(pickRegisteredStreamFields({ slug: "no-stream" }, null), null);
});

scenario("pick-path-only-no-key", "registration", () => {
  assert.equal(
    pickRegisteredStreamFields({ slug: "path-only", stream_path: VALID_STREAM_PATH }, null),
    null
  );
});

// ── validateRegisteredStreamFields ────────────────────────────────────────────

scenario("validate-ok", "validation", () => {
  assert.equal(validateRegisteredStreamFields(VALID_STREAM_KEY, VALID_STREAM_PATH).valid, true);
});

scenario("validate-bad-key", "validation", () => {
  assert.equal(validateRegisteredStreamFields("bad/key.mp3", VALID_STREAM_PATH).valid, false);
});

scenario("validate-bad-path", "validation", () => {
  assert.equal(validateRegisteredStreamFields(VALID_STREAM_KEY, "masters/foo/").valid, false);
});

// ── Feature-flag matrix (master-only when not fully ON) ───────────────────────

scenario("flags-hybrid-off-preferred-on", "flags", () => {
  setHybridEnv(false, true);
  assert.equal(isHybridStreamingEnabled(), false);
  assert.equal(isStreamPlaybackPreferred(), false);
});

scenario("flags-hybrid-on-preferred-off", "flags", () => {
  setHybridEnv(true, false);
  assert.equal(isHybridStreamingEnabled(), true);
  assert.equal(isStreamPlaybackPreferred(), false);
});

scenario("flags-both-on", "flags", () => {
  setHybridEnv(true, true);
  assert.equal(readHybridStreamingEnvBool(process.env.HYBRID_STREAMING_ENABLED), true);
  assert.equal(isStreamPlaybackPreferred(), true);
});

// ── Master fallback scenarios (Stage 5 matrix) ───────────────────────────────

scenario("fallback-no-registration", "fallback", async () => {
  setHybridEnv(true, true);
  const result = await tryResolveStreamPlaybackKey(mockAdmin, { slug: "bare" }, null, {
    headCheck: async () => VALID_STREAM_KEY,
  });
  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "no_stream_registration");
});

scenario("fallback-r2-missing", "fallback", async () => {
  setHybridEnv(true, true);
  const result = await tryResolveStreamPlaybackKey(mockAdmin, productWithStream, null, {
    headCheck: async () => null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "r2_missing");
});

scenario("fallback-hybrid-on-preferred-off", "fallback", async () => {
  setHybridEnv(true, false);
  const result = await tryResolveStreamPlaybackKey(mockAdmin, productWithStream, null, {
    headCheck: async () => VALID_STREAM_KEY,
  });
  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "flags_off");
});

scenario("fallback-invalid-stream-key", "fallback", async () => {
  setHybridEnv(true, true);
  const result = await tryResolveStreamPlaybackKey(
    mockAdmin,
    { slug: "bad", stream_key: "bad/key.mp3", stream_path: VALID_STREAM_PATH },
    null,
    { headCheck: async () => VALID_STREAM_KEY }
  );
  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "invalid_stream_key");
});

scenario("fallback-invalid-stream-path", "fallback", async () => {
  setHybridEnv(true, true);
  const result = await tryResolveStreamPlaybackKey(
    mockAdmin,
    { slug: "bad", stream_key: VALID_STREAM_KEY, stream_path: "masters/foo/" },
    null,
    { headCheck: async () => VALID_STREAM_KEY }
  );
  assert.equal(result.ok, false);
  assert.equal(result.fallbackReason, "invalid_stream_path");
});

scenario("stream-hit-valid-registration", "stream", async () => {
  setHybridEnv(true, true);
  const result = await tryResolveStreamPlaybackKey(mockAdmin, productWithStream, null, {
    headCheck: async (key) => key,
  });
  assert.equal(result.ok, true);
  assert.equal(result.key, VALID_STREAM_KEY);
});

// ── Master gate simulation (resolve-playback-key parity) ─────────────────────

scenario("gate-master-kept-on-r2-miss", "gate", async () => {
  setHybridEnv(true, true);
  const gated = await simulateMasterStreamGate(MASTER_KEY, () =>
    tryResolveStreamPlaybackKey(mockAdmin, productWithStream, null, { headCheck: async () => null })
  );
  assert.equal(gated.audioKey, MASTER_KEY);
  assert.equal(gated.playbackSource, "master");
  assert.equal(gated.resolverResult, "master");
  assert.equal(gated.streamFallbackReason, "r2_missing");
});

scenario("gate-master-kept-flags-off", "gate", async () => {
  setHybridEnv(true, false);
  const gated = await simulateMasterStreamGate(MASTER_KEY, () =>
    tryResolveStreamPlaybackKey(mockAdmin, productWithStream, null, {
      headCheck: async () => VALID_STREAM_KEY,
    })
  );
  assert.equal(gated.audioKey, MASTER_KEY);
  assert.equal(gated.resolverResult, "master");
  assert.equal(gated.streamFallbackReason, null);
});

scenario("gate-stream-replaces-master", "gate", async () => {
  setHybridEnv(true, true);
  const gated = await simulateMasterStreamGate(MASTER_KEY, () =>
    tryResolveStreamPlaybackKey(mockAdmin, productWithStream, null, {
      headCheck: async (key) => key,
    })
  );
  assert.equal(gated.audioKey, VALID_STREAM_KEY);
  assert.equal(gated.playbackSource, "stream");
  assert.equal(gated.resolverResult, "stream");
  assert.equal(gated.streamFallbackReason, null);
});

// ── Shadow metrics (Stage 4 diagnostics) ──────────────────────────────────────

scenario("shadow-metrics-aggregate", "metrics", () => {
  resetPlaybackResolverDiagnostics();
  recordPlaybackResolverOutcome({ result: "master", durationMs: 12, fallbackReason: "r2_missing" });
  recordPlaybackResolverOutcome({ result: "stream", durationMs: 8 });
  recordPlaybackResolverOutcome({ result: "master", durationMs: 5, fallbackReason: "flags_off" });
  const diag = getPlaybackResolverDiagnostics();
  assert.equal(diag.total, 3);
  assert.equal(diag.stream, 1);
  assert.equal(diag.master, 2);
  assert.equal(diag.fallbacks, 2);
  assert.equal(diag.streamHitRate, 0.333);
  assert.equal(diag.fallbackRate, 0.667);
  assert.equal(diag.avgDurationMs, 8.3);
  assert.equal(diag.fallbacksByReason.r2_missing, 1);
  assert.equal(diag.fallbacksByReason.flags_off, 1);
});

// ── Run matrix ────────────────────────────────────────────────────────────────

const results = [];
let failed = 0;

for (const { id, category, run } of scenarios) {
  try {
    await run();
    results.push({ id, category, status: "PASS" });
  } catch (err) {
    failed += 1;
    results.push({ id, category, status: "FAIL", message: err?.message || String(err) });
  }
}

restoreEnv();

if (failed > 0) {
  console.error("playback-resolver-fallback: FAILED");
  for (const row of results.filter((r) => r.status === "FAIL")) {
    console.error(`  [FAIL] ${row.id}: ${row.message}`);
  }
  process.exit(1);
}

console.log("playback-resolver-fallback: ok");
console.log(`scenarios: ${results.length} passed`);
console.table(results.map(({ id, category, status }) => ({ id, category, status })));
