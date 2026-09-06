import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { deriveAudioVisualHLSIV, deriveAudioVisualHLSKey } from "../derive-key.js";

process.env.HLS_MASTER_SECRET = "test-secret-at-least-32-characters-long-xyz";

// Exactly reproduces workers/hls-transcoder/src/engine/packaging.js's own
// derivation (Node crypto.createHmac) — this file's Web-Crypto-based
// implementation must be byte-identical for the worker's encryption and
// this app's key-delivery route to ever agree on the same key.
function workerSideDerivation(videoId, assetVersionId, purpose) {
  const secret = process.env.HLS_MASTER_SECRET;
  const input = `2mrrw:av-hls:${videoId}:${assetVersionId}:${purpose}`;
  return crypto.createHmac("sha256", secret).update(input).digest().subarray(0, 16);
}

test("throws when HLS_MASTER_SECRET is missing or too short", async () => {
  const saved = process.env.HLS_MASTER_SECRET;
  delete process.env.HLS_MASTER_SECRET;
  await assert.rejects(() => deriveAudioVisualHLSKey("video-1", "version-1"), /HLS_MASTER_SECRET must be set/);
  process.env.HLS_MASTER_SECRET = "too-short";
  await assert.rejects(() => deriveAudioVisualHLSKey("video-1", "version-1"), /HLS_MASTER_SECRET must be set/);
  process.env.HLS_MASTER_SECRET = saved;
});

test("deterministic: same (videoId, assetVersionId) always derives the same 16-byte key and IV", async () => {
  const a = await deriveAudioVisualHLSKey("video-1", "version-1");
  const b = await deriveAudioVisualHLSKey("video-1", "version-1");
  assert.equal(a.length, 16);
  assert.ok(a.equals(b));
});

test("a different videoId or assetVersionId derives a genuinely different key", async () => {
  const base = await deriveAudioVisualHLSKey("video-1", "version-1");
  const differentVideo = await deriveAudioVisualHLSKey("video-2", "version-1");
  const differentVersion = await deriveAudioVisualHLSKey("video-1", "version-2");
  assert.ok(!base.equals(differentVideo));
  assert.ok(!base.equals(differentVersion));
});

test("key and IV are different byte sequences, not the same bytes reused", async () => {
  const key = await deriveAudioVisualHLSKey("video-1", "version-1");
  const iv = await deriveAudioVisualHLSIV("video-1", "version-1");
  assert.ok(!key.equals(iv));
});

test("CRITICAL: this Web-Crypto-based derivation is byte-identical to the worker's Node crypto.createHmac derivation for the same inputs — proves the two independent deployables actually agree on the same key/IV, not merely assumed from both using 'HMAC-SHA256'", async () => {
  const webCryptoKey = await deriveAudioVisualHLSKey("video-42", "version-7");
  const nodeCryptoKey = workerSideDerivation("video-42", "version-7", "key");
  assert.ok(webCryptoKey.equals(nodeCryptoKey), "key derivation diverged between Web Crypto and Node crypto — the worker and this route would encrypt/decrypt with different keys");

  const webCryptoIV = await deriveAudioVisualHLSIV("video-42", "version-7");
  const nodeCryptoIV = workerSideDerivation("video-42", "version-7", "iv");
  assert.ok(webCryptoIV.equals(nodeCryptoIV), "IV derivation diverged between Web Crypto and Node crypto");
});
