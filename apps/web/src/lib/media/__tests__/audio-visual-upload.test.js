import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

const presign = read("src/app/api/admin/audio-visual/upload/presigned/route.js");
const complete = read("src/app/api/admin/audio-visual/upload/complete/route.js");
const contracts = read("src/lib/media/admin-upload-contract.js");

test("both Audio Visualz upload routes require the canonical admin guard", () => {
  for (const source of [presign, complete]) {
    assert.match(source, /getAdminSessionUser/);
    assert.match(source, /isAdminUser\(user\)/);
  }
});

test("neither route destructures release/track identity fields from the request body — videoId only, never releaseId/trackId/slug/releaseType", () => {
  for (const source of [presign, complete]) {
    assert.match(source, /videoId/);
    const bodyDestructureAt = source.indexOf("await req.json()");
    const nextLine = source.slice(bodyDestructureAt, source.indexOf("\n", bodyDestructureAt) + 200);
    assert.ok(
      !/releaseId|trackId|releaseType|trackSlug/.test(nextLine),
      "must never pull release/track identity fields out of the request body"
    );
  }
});

test("the presign route defines exactly the 3 Audio Visualz asset types, isolated from the release contract entries", () => {
  assert.match(presign, /new Set\(\["av-cover", "av-cover-video", "av-master"\]\)/);
  assert.ok(!/"cover-video": \{/.test(presign), "must not inline a competing contract — it imports ADMIN_UPLOAD_CONTRACTS");
});

test("the master upload contract caps at R2's real single-PUT limit, and documents multipart as a known, deliberate gap rather than silently assuming it works at any size", () => {
  assert.match(contracts, /"av-master": \{/);
  assert.match(contracts, /maxBytes: 5_000_000_000/);
  assert.match(contracts, /multipart upload, deliberately not built here/);
});

test("the master R2 key is timestamp-suffixed so a replace-master re-upload can never collide with an existing, still-serving version's object", () => {
  assert.match(presign, /master-\$\{Date\.now\(\)\}/);
});

test("av-master completion creates a NEW audio_visual_asset_versions row (never an update-in-place) and enqueues a job_type='video' hls_transcode_jobs row pointing at it", () => {
  const fnAt = complete.indexOf('if (assetType === "av-master")');
  const body = complete.slice(fnAt, fnAt + 1200);
  assert.match(body, /\.from\("audio_visual_asset_versions"\)\s*\.insert\(\{ audio_visual_id: videoId, master_r2_key: key, status: "uploaded" \}\)/);
  assert.doesNotMatch(body, /\.update\(/, "av-master must never update an existing asset version row");
  assert.match(body, /job_type: "video"/);
  assert.match(body, /asset_version_id: assetVersion\.id/);
  assert.match(body, /status: "pending"/);
});

test("av-cover-video completion merges into the existing metadata jsonb rather than overwriting it, and enforces the same duration cap as the contract", () => {
  const fnAt = complete.indexOf('if (assetType === "av-cover-video")');
  const body = complete.slice(fnAt, fnAt + 800);
  assert.match(body, /ADMIN_UPLOAD_CONTRACTS\["av-cover-video"\]\.maxDurationSeconds/);
  assert.match(body, /\{ \.\.\.meta, animated_cover_r2_key: key \}/);
});

test("both routes verify the object actually landed in R2 before accepting completion — never trusts the client's claim alone", () => {
  assert.match(complete, /headR2ObjectKey\(key\)/);
  assert.match(complete, /File not found in R2/);
});

test("both routes are rate-limited under their own distinct route keys, isolated from the release upload route keys", () => {
  assert.match(presign, /routeKey: "admin\.audio-visual\.upload\.presigned"/);
  assert.match(complete, /routeKey: "admin\.audio-visual\.upload\.complete"/);
});
