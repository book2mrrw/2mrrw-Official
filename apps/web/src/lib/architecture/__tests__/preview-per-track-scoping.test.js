import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migrationsDir = path.join(root, "supabase/migrations");
const readOnlyMigration = (needle) => {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.includes(needle));
  assert.equal(files.length, 1, `expected exactly one migration matching "${needle}"`);
  return fs.readFileSync(path.join(migrationsDir, files[0]), "utf8");
};

// ── schema: preview is track-scoped data, gets its own columns ─────────────

test("tracks gains preview_r2_key and preview_start_seconds — mirrors the existing audio_r2_key/master_r2_key pattern on the same table", () => {
  const sql = readOnlyMigration("tracks_preview_columns");
  assert.match(sql, /alter table public\.tracks\s*\n\s*add column if not exists preview_r2_key text,\s*\n\s*add column if not exists preview_start_seconds integer not null default 0;/);
});

// ── /api/admin/upload/complete: preview writes are scoped by trackId ───────

test("a preview upload with a trackId updates that track's own row, not the shared release metadata field", () => {
  const src = read("src/app/api/admin/upload/complete/route.js");
  const fnAt = src.indexOf('if (assetType === "preview") {');
  const body = src.slice(fnAt, fnAt + 1200);
  assert.match(body, /if \(trackId\) \{\s*\n\s*const \{ error \} = await admin\s*\n\s*\.from\("tracks"\)\s*\n\s*\.update\(\{ preview_r2_key: key, preview_start_seconds: Number\(previewStartSeconds\) \|\| 0 \}\)\s*\n\s*\.eq\("id", trackId\);/);
});

test("without a trackId, the preview still falls back to the legacy release-level metadata field (single/feature releases predating per-track scoping)", () => {
  const src = read("src/app/api/admin/upload/complete/route.js");
  const fnAt = src.indexOf('if (assetType === "preview") {');
  const body = src.slice(fnAt, fnAt + 1200);
  assert.match(body, /\} else \{\s*\n\s*const \{ data: rel \} = await admin\.from\("releases"\)\.select\("status, metadata"\)\.eq\("id", releaseId\)\.single\(\);/);
  assert.match(body, /metadata: \{ \.\.\.meta, preview_r2_key: key \}/);
});

test("previewStartSeconds is destructured from the request body, not hardcoded", () => {
  const src = read("src/app/api/admin/upload/complete/route.js");
  assert.match(src, /const \{ releaseId, trackId, key, assetType, releaseType, slug, trackSlug, trackTitle, position, durationSeconds, previewStartSeconds \} = body;/);
});

// ── UploadWizard.js: every PreviewTrimPicker call site threads a real trackId ──

test("PreviewTrimPicker sends trackId and the real trim start-second to /upload/complete, not a hardcoded value", () => {
  const src = read("src/components/admin/UploadWizard.js");
  assert.match(src, /function PreviewTrimPicker\(\{ file, releaseType, slug, trackSlug, releaseId, trackId, previewKey, onGenerated \}\)/);
  const fnAt = src.indexOf("function PreviewTrimPicker(");
  const body = src.slice(fnAt, src.indexOf("function ", fnAt + 10));
  assert.match(body, /body: JSON\.stringify\(\{ releaseId, key, assetType: "preview", releaseType, slug, trackSlug, trackId, previewStartSeconds: startSec \}\)/);
});

test("both the single/feature step and the per-track wizard row pass a real trackId into PreviewTrimPicker", () => {
  const src = read("src/components/admin/UploadWizard.js");
  const singleCallAt = src.indexOf("function AudioUploadStep(");
  const singleCallBody = src.slice(singleCallAt, singleCallAt + 6000);
  assert.match(singleCallBody, /<PreviewTrimPicker[\s\S]*?trackId=\{data\.track_id\}/);

  const trackRowCallAt = src.indexOf("function TrackRow(");
  const trackRowCallBody = src.slice(trackRowCallAt, trackRowCallAt + 12000);
  assert.match(trackRowCallBody, /<PreviewTrimPicker[\s\S]*?trackId=\{track\.id\}/);
});

test("PreviewTrimPicker's effect only calls URL.createObjectURL on a real File — a JSON-round-tripped masterFile ({}) can no longer throw synchronously", () => {
  const src = read("src/components/admin/UploadWizard.js");
  const fnAt = src.indexOf("function PreviewTrimPicker(");
  const body = src.slice(fnAt, fnAt + 1500);
  assert.match(body, /if \(!file \|\| typeof File === "undefined" \|\| !\(file instanceof File\)\) return undefined;/);
});

test("a broken (non-File) file object gets a clear, actionable message instead of getting stuck on 'Reading track length…' forever", () => {
  const src = read("src/components/admin/UploadWizard.js");
  const fnAt = src.indexOf("function PreviewTrimPicker(");
  const body = src.slice(fnAt, fnAt + 9000);
  assert.match(body, /const hasBrokenFile = Boolean\(file\) && typeof File !== "undefined" && !\(file instanceof File\);/);
  assert.match(body, /Re-select the master file above to set one\./);
  assert.match(body, /Re-select the master file above if you want to choose a different clip\./);
});

// ── publish route: durable per-track column is authoritative, not client state ──

test("the tracks query selects the new preview columns, and the merge prefers the durable DB value over client-reported wizard state", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /\.select\("id, title, upload_status, audio_r2_key, master_r2_key, position, lyrics, preview_r2_key, preview_start_seconds"\)/);
  const fnAt = src.indexOf("const tracks = (dbTracks || []).map((dbTrack) => {");
  const body = src.slice(fnAt, fnAt + 1400);
  assert.match(body, /const previewKey = dbTrack\.preview_r2_key \|\| bodyTrack\?\.preview_key \|\| null;/);
});

test("the phantom single/feature track placeholder (id: null) can no longer match a real track row via position", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /bt\.id === dbTrack\.id \|\| \(bt\.id != null && Number\(bt\.position\) === Number\(dbTrack\.position\)\)/);
});

test("for single/feature releases, resolvedPreviewKey prefers the merged track's own (durable-first) preview_key over the raw request body field", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /const singleTrackPreview = !isMultiTrack \? \(tracks\.find\(\(t\) => t\.id === track_id\) \|\| tracks\[0\]\) : null;/);
  assert.match(src, /const resolvedPreviewKey = singleTrackPreview\?\.preview_key \|\| preview_key \|\| release\.metadata\?\.preview_r2_key \|\| null;/);
});

test("the release-level preview canonicalization block is gated to single/feature only — it must never run for a multi-track release", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  assert.match(src, /if \(!isMultiTrack && resolvedPreviewKey\) \{/,
    "previously ungated: for a multi-track release with a stray value in release.metadata.preview_r2_key, this block would copy that ONE track's real preview file to a meaningless release-level path and then delete the original, destroying it before the per-track loop could run");
});

test("the per-track preview canonicalization loop runs after the release-level block, so its source files are never at risk of having been deleted by it first", () => {
  const src = read("src/app/api/admin/releases/[id]/publish/route.js");
  const releaseLevelAt = src.indexOf("if (!isMultiTrack && resolvedPreviewKey) {");
  const perTrackLoopAt = src.indexOf("for (const track of readyTracks) {", releaseLevelAt);
  assert.ok(releaseLevelAt > -1 && perTrackLoopAt > releaseLevelAt);
});

// ── resolve-playback-key.js: fast path verifies existence before trusting it ──

test("resolvePreviewKeyUncached's fast path HEAD-checks the recorded key before persisting/returning it, instead of trusting it unconditionally", () => {
  const src = read("src/lib/playback/resolve-playback-key.js");
  assert.match(src, /import \{ headR2ObjectKey \} from "@\/lib\/storage\/r2";/);
  const fnAt = src.indexOf("if (rawPreviewPath && isConcreteMediaKey(rawPreviewPath)) {");
  const body = src.slice(fnAt, fnAt + 700);
  assert.match(body, /const exists = await headR2ObjectKey\(key\)\.catch\(\(\) => false\);/);
  assert.match(body, /if \(exists\) \{/);
});

test("a failed existence check falls through to live folder discovery instead of returning null immediately — same recovery path a legacy release already relies on", () => {
  const src = read("src/lib/playback/resolve-playback-key.js");
  const fastPathAt = src.indexOf("if (rawPreviewPath && isConcreteMediaKey(rawPreviewPath)) {");
  const fastPathEnd = src.indexOf("\n  }", fastPathAt);
  const discoveryAt = src.indexOf("const releaseType = inferProductReleaseType(product);", fastPathEnd);
  assert.ok(discoveryAt > fastPathEnd, "folder-discovery fallback must be reachable after the fast path's existence check fails");
});
