import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");
const uploadContracts = read("src/lib/media/admin-upload-contract.js");

describe("admin upload MIME authority", () => {
  const presign = read("src/app/api/admin/upload/presigned/route.js");
  const client = read("src/lib/media/r2-upload-client.js");

  test("server maps every supported extension to a canonical MIME", () => {
    for (const pair of [
      ['wav: "audio/wav"', 'wave: "audio/wav"', 'flac: "audio/flac"'],
      ['aiff: "audio/aiff"', 'aif: "audio/aiff"'],
      ['jpg: "image/jpeg"', 'jpeg: "image/jpeg"', 'png: "image/png"', 'webp: "image/webp"'],
      ['mp4: "video/mp4"', 'mp3: "audio/mpeg"'],
      ['mov: "video/quicktime"', 'webm: "video/webm"'],
    ].flat()) assert.match(uploadContracts, new RegExp(pair.replace(/[/.]/g, "\\$&")));
    assert.match(presign, /ADMIN_UPLOAD_CONTRACTS\[assetType\]/);
  });

  test("unsupported extensions and invalid sizes fail closed", () => {
    assert.match(presign, /if \(!contentType\)/);
    assert.ok(!/application\/octet-stream/.test(presign));
    assert.match(presign, /!Number\.isSafeInteger\(size\) \|\| size <= 0/);
  });

  test("the exact server MIME is signed, returned, and sent", () => {
    assert.match(presign, /createR2SignedPutUrl\(key, contentType,/);
    assert.match(presign, /\{ uploadUrl, key, contentType, expiresAt \}/);
    assert.match(client, /xhr\.setRequestHeader\("Content-Type", contentType\)/);
    assert.ok(!/file\.type/.test(client.replace(/\/\*[\s\S]*?\*\//g, "")));
  });
});

describe("one upload transport and one storefront invalidator", () => {
  test("all eight upload call sites use the shared transport", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    const releases = read("src/app/admin/releases/page.js");
    const inline = read("src/components/admin/InlineReleasesManager.js");
    assert.equal((wizard.match(/uploadAssetToR2\s*\(/g) || []).length, 4);
    assert.equal((releases.match(/uploadAssetToR2\s*\(/g) || []).length, 2);
    assert.equal((inline.match(/uploadAssetToR2\s*\(/g) || []).length, 2);
    for (const source of [wizard, releases, inline]) {
      assert.ok(!source.includes("/api/admin/upload/presigned"));
      assert.ok(!source.includes("new XMLHttpRequest"));
    }
  });

  test("cover selection uses a persistent input and validates completion", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    assert.match(wizard, /ref=\{coverInputRef\}/);
    assert.match(wizard, /coverInputRef\.current\?\.click\(\)/);
    assert.ok(!/const pickCover = \(\) => \{\s*const input = document\.createElement/.test(wizard));
    assert.match(wizard, /if \(!completeRes\.ok\)/);
  });

  test("cover video selection shares MP4, MOV, WebM and seven-minute rules", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    const complete = read("src/app/api/admin/upload/complete/route.js");
    assert.match(wizard, /ref=\{videoInputRef\}/);
    assert.match(wizard, /accept=\{VIDEO_COVER_ACCEPT\}/);
    assert.match(uploadContracts, /VIDEO_COVER_ACCEPT[\s\S]*video\/mp4[\s\S]*video\/quicktime[\s\S]*video\/webm/);
    assert.match(wizard, /durationSeconds > 420\.5/);
    assert.match(wizard, /assetType: "cover-video"/);
    assert.match(complete, /ADMIN_UPLOAD_CONTRACTS\["cover-video"\]\.maxDurationSeconds/);
  });

  test("My Releases replaces audio immediately after direct upload", () => {
    const inline = read("src/components/admin/InlineReleasesManager.js");
    const uploadStart = inline.indexOf("const uploadAudio");
    const replaceCall = inline.indexOf("/replace-master`,", uploadStart);
    assert.ok(replaceCall > uploadStart);
    assert.ok(!inline.includes('setAudioPhase("confirming")'));
    assert.ok(!inline.includes('audioPhase === "confirming"'));
  });

  test("master cleanup occurs after persistence and preserves the new key", () => {
    const route = read("src/app/api/admin/releases/[id]/replace-master/route.js");
    const update = route.indexOf('.from("tracks")');
    const cleanup = route.indexOf("removeStaleMasterSiblings(newAudioFolder, newKey)");
    assert.ok(update > -1 && cleanup > update);
    assert.match(route, /key !== newKey/);
    assert.match(route, /listR2Objects\(prefix, \{ recursive: false \}\)/);
  });

  test("catalog DB has no explicit cache beneath ISR", () => {
    const catalog = read("src/lib/media/catalog-db.js");
    assert.ok(!/unstable_cache|revalidateTag|\bcache\s*\(|redis/i.test(catalog));
  });
});

describe("release upload database contract", () => {
  const migration = read("supabase/migrations/20260823000010_tracks_upload_contract_closure.sql");

  test("tracks supplies every field shared by complete, publish, edit, and replace-master", () => {
    for (const column of ["position", "master_history", "slug"]) {
      assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
    }
    assert.match(migration, /ALTER COLUMN slug SET NOT NULL/);
    assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
  });

  test("the publish linkage column is present even when the earlier migration was skipped", () => {
    assert.match(migration, /public\.products[\s\S]*ADD COLUMN IF NOT EXISTS release_id uuid/);
  });

  test("live routes tolerate the pre-migration tracks table", () => {
    const complete = read("src/app/api/admin/upload/complete/route.js");
    const publish = read("src/app/api/admin/releases/[id]/publish/route.js");
    const replace = read("src/app/api/admin/releases/[id]/replace-master/route.js");
    const detail = read("src/app/api/admin/releases/[id]/route.js");
    assert.ok(!complete.includes('.eq("slug", trackSlug)'));
    assert.ok(!complete.includes("slug: trackSlug || slug"));
    assert.ok(!publish.includes('.select("id, slug, title'));
    assert.ok(!replace.includes("master_history, slug"));
    assert.ok(!/\.from\("tracks"\)[\s\S]{0,120}\.select\("id, slug, title/.test(detail));
  });
});
