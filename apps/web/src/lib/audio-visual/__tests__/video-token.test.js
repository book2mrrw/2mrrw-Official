import assert from "node:assert/strict";
import test from "node:test";
import {
  signAudioVisualKeyToken,
  signAudioVisualVariantToken,
  verifyAudioVisualKeyToken,
  verifyAudioVisualVariantToken,
} from "../video-token.js";

process.env.HLS_HMAC_SECRET = "test-hmac-secret-at-least-32-characters-xyz";

test("throws when HLS_HMAC_SECRET is missing or too short", async () => {
  const saved = process.env.HLS_HMAC_SECRET;
  delete process.env.HLS_HMAC_SECRET;
  await assert.rejects(
    () => signAudioVisualVariantToken({ videoId: "v1", assetVersionId: "a1", codecFamily: "avc", resolutionLabel: "720p", userId: "u1" }),
    /HLS_HMAC_SECRET must be set/
  );
  process.env.HLS_HMAC_SECRET = saved;
});

test("a variant token round-trips: signs then verifies to the exact same fields", async () => {
  const token = await signAudioVisualVariantToken({
    videoId: "video-1", assetVersionId: "version-1", codecFamily: "av1", resolutionLabel: "1080p", userId: "user-1",
  });
  const payload = await verifyAudioVisualVariantToken(token);
  assert.deepEqual(payload, {
    videoId: "video-1", assetVersionId: "version-1", codecFamily: "av1", resolutionLabel: "1080p", userId: "user-1",
  });
});

test("a key token round-trips: signs then verifies to the exact same fields", async () => {
  const token = await signAudioVisualKeyToken({ videoId: "video-1", assetVersionId: "version-1", userId: "user-1" });
  const payload = await verifyAudioVisualKeyToken(token);
  assert.deepEqual(payload, { videoId: "video-1", assetVersionId: "version-1", userId: "user-1" });
});

test("a variant token is rejected by verifyAudioVisualKeyToken, and vice versa — type discriminator prevents cross-endpoint replay", async () => {
  const variantToken = await signAudioVisualVariantToken({
    videoId: "video-1", assetVersionId: "version-1", codecFamily: "avc", resolutionLabel: "720p", userId: "user-1",
  });
  const keyToken = await signAudioVisualKeyToken({ videoId: "video-1", assetVersionId: "version-1", userId: "user-1" });

  assert.equal(await verifyAudioVisualKeyToken(variantToken), null);
  assert.equal(await verifyAudioVisualVariantToken(keyToken), null);
});

test("an expired token is rejected", async () => {
  // Craft an already-expired av_v payload directly, signed with the real secret,
  // to prove verification actually checks exp rather than trusting the caller.
  const enc = new TextEncoder();
  const expiredPayload = {
    type: "av_v", vid: "video-1", aid: "version-1", cf: "avc", rl: "720p", uid: "user-1",
    exp: Math.floor(Date.now() / 1000) - 10,
  };
  const dataB64 = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(process.env.HLS_HMAC_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(dataB64));
  const expiredToken = `${dataB64}.${Buffer.from(sig).toString("base64url")}`;

  assert.equal(await verifyAudioVisualVariantToken(expiredToken), null);
});

test("a tampered payload (signature no longer matches) is rejected", async () => {
  const token = await signAudioVisualVariantToken({
    videoId: "video-1", assetVersionId: "version-1", codecFamily: "avc", resolutionLabel: "720p", userId: "user-1",
  });
  const [dataB64, sigB64] = token.split(".");
  const tamperedPayload = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));
  tamperedPayload.uid = "attacker"; // attempt to swap the authorized user without re-signing
  const tamperedDataB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url");
  const tamperedToken = `${tamperedDataB64}.${sigB64}`;

  assert.equal(await verifyAudioVisualVariantToken(tamperedToken), null);
});

test("a malformed token (no '.' separator, or garbage) is rejected rather than throwing", async () => {
  assert.equal(await verifyAudioVisualVariantToken("not-a-real-token"), null);
  assert.equal(await verifyAudioVisualVariantToken(""), null);
  assert.equal(await verifyAudioVisualKeyToken("garbage.moregarbage"), null);
});

test("a previous secret (mid-rotation) still verifies an existing token", async () => {
  const saved = process.env.HLS_HMAC_SECRET;
  process.env.HLS_HMAC_SECRET = "rotation-old-secret-at-least-32-characters";
  const token = await signAudioVisualVariantToken({
    videoId: "video-1", assetVersionId: "version-1", codecFamily: "avc", resolutionLabel: "720p", userId: "user-1",
  });

  process.env.HLS_HMAC_SECRET = "rotation-new-secret-at-least-32-characters!";
  process.env.HLS_HMAC_SECRET_PREVIOUS = "rotation-old-secret-at-least-32-characters";

  const payload = await verifyAudioVisualVariantToken(token);
  assert.equal(payload.videoId, "video-1");

  process.env.HLS_HMAC_SECRET = saved;
  delete process.env.HLS_HMAC_SECRET_PREVIOUS;
});
