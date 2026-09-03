import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("the preview clip is derived from the master entirely in the browser, not a separate manual upload", () => {
  const wizard = read("src/components/admin/UploadWizard.js");
  assert.match(wizard, /import\s*\{\s*extractAudioClipAsWav,\s*probeAudioDuration\s*\}\s*from\s*"@\/lib\/media\/browser-audio-trim"/);
  // The abandoned "admin manually picks a separate preview file" approach must
  // not come back — no dedicated preview file <input> or accept-string.
  assert.doesNotMatch(wizard, /PREVIEW_AUDIO_ACCEPT/);
});

test("extractAudioClipAsWav decodes in-browser and never talks to a server", () => {
  const src = read("src/lib/media/browser-audio-trim.js");
  assert.match(src, /decodeAudioData/);
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest/);
});

test("the generated clip is capped at PREVIEW_CLIP_SECONDS and uploaded through the existing presign pipeline", () => {
  const wizard = read("src/components/admin/UploadWizard.js");
  assert.match(wizard, /import\s*\{\s*PREVIEW_CLIP_SECONDS\s*\}\s*from\s*"@\/lib\/media\/preview-constants"/);
  assert.match(wizard, /durationSeconds:\s*PREVIEW_CLIP_SECONDS/);
  assert.match(wizard, /assetType:\s*"preview"/);
});

test("a missing preview never re-blocks the wizard's Continue button — only publish enforces it", () => {
  // A resumed draft with audio already attached (from before this feature
  // existed, or from an earlier session) must never be permanently stuck —
  // see "reopening a draft never re-requires an already-uploaded asset" in
  // admin-upload-hardening.test.js. The preview requirement is enforced
  // server-side at publish time instead (see the publish-route tests below).
  const wizard = read("src/components/admin/UploadWizard.js");
  assert.ok(wizard.includes('disabled={status !== "ready" && !data.audio_key}'),
    "AudioUploadStep's Continue button must not gain a new hard requirement on preview_key");
  assert.match(wizard, /No preview clip set yet — publishing will be blocked/);
});

test("the preview picker only appears once the master upload for that track/release is ready", () => {
  const wizard = read("src/components/admin/UploadWizard.js");
  const singlePickerAt = wizard.indexOf("<PreviewTrimPicker");
  assert.ok(singlePickerAt > -1, "PreviewTrimPicker must be rendered somewhere in the wizard");
  // Both usages (single/feature step, and per-track row) must be gated on a
  // ready upload status, not rendered unconditionally.
  const guardBefore = wizard.lastIndexOf('status === "ready"', singlePickerAt);
  assert.ok(guardBefore > -1 && guardBefore < singlePickerAt);
});

test("the tracklist builder warns about missing previews without hard-blocking Continue", () => {
  const wizard = read("src/components/admin/UploadWizard.js");
  assert.match(wizard, /missingPreviewCount\s*=\s*tracks\.filter\(\(t\)\s*=>\s*t\.upload_status === "ready" && !t\.preview_key\)\.length/);
  // Same non-regression principle as the single/feature step — resuming an
  // existing multi-track draft must never get newly stuck on this button.
  assert.ok(wizard.includes("disabled={readyCount === 0 || uploadingAny}"),
    "TracklistBuilderStep's Continue button must not gain a new hard requirement on previews");
  assert.match(wizard, /missing a preview clip — publishing will be blocked/);
});

test("the wizard sends preview_key and preview_start_seconds to the publish endpoint, both top-level and per-track", () => {
  const wizard = read("src/components/admin/UploadWizard.js");
  assert.match(wizard, /preview_key:\s*data\.preview_key/);
  assert.match(wizard, /preview_key:\s*t\.preview_key \|\| null/);
});

test("publish blocks a first-time publish with no preview, but never retroactively blocks re-publishing an existing release", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /const isFirstPublish = release\.status === "draft"/);
  const isFirstPublishAt = src.indexOf("const isFirstPublish");
  const blockAt = src.indexOf('"BLOCKING: A preview clip must be set before publishing"');
  const guardAt = src.lastIndexOf("if (isFirstPublish)", blockAt);
  assert.ok(isFirstPublishAt > -1 && guardAt > isFirstPublishAt && guardAt < blockAt,
    "the missing-preview block must be conditioned on isFirstPublish");
});

test("multi-track publish blocks when any ready track is missing its preview, first-publish only", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /tracksMissingPreview = readyTracks\.filter\(\(t\) => !t\.preview_key\)/);
});

test("preview clips are canonicalized from the draft path to the final release slug, mirroring the audio pattern", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /previews\/\$\{typeFolder\}\/\$\{releaseSlug\}\/\$\{releaseSlug\}-preview\$\{ext\}/);
  assert.match(src, /previews\/\$\{typeFolder\}\/\$\{releaseSlug\}\/\$\{track\.slug\}\/\$\{track\.slug\}-preview\$\{ext\}/);
});

test("a re-publish with a preview canonicalization failure degrades gracefully instead of hard-failing", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  const catchAt = src.indexOf('console.warn("[publish] preview canonicalize error');
  const isFirstPublishGuardAt = src.indexOf("if (isFirstPublish)", catchAt);
  assert.ok(catchAt > -1 && isFirstPublishGuardAt > catchAt,
    "a preview canonicalize failure must only hard-fail the response on first publish, not every re-publish");
});
