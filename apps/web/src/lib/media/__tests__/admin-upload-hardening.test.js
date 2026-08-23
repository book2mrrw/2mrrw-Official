import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

describe("admin upload MIME authority", () => {
  const presign = read("src/app/api/admin/upload/presigned/route.js");
  const client = read("src/lib/media/r2-upload-client.js");

  test("server maps every supported extension to a canonical MIME", () => {
    for (const pair of [
      ['wav: "audio/wav"', 'wave: "audio/wav"', 'flac: "audio/flac"'],
      ['aiff: "audio/aiff"', 'aif: "audio/aiff"'],
      ['jpg: "image/jpeg"', 'jpeg: "image/jpeg"', 'png: "image/png"', 'webp: "image/webp"'],
      ['mp4: "video/mp4"', 'mp3: "audio/mpeg"'],
    ].flat()) assert.match(presign, new RegExp(pair.replace(/[/.]/g, "\\$&")));
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
  test("all seven upload call sites use the shared transport", () => {
    const wizard = read("src/components/admin/UploadWizard.js");
    const releases = read("src/app/admin/releases/page.js");
    const inline = read("src/components/admin/InlineReleasesManager.js");
    assert.equal((wizard.match(/uploadAssetToR2\s*\(/g) || []).length, 3);
    assert.equal((releases.match(/uploadAssetToR2\s*\(/g) || []).length, 2);
    assert.equal((inline.match(/uploadAssetToR2\s*\(/g) || []).length, 2);
    for (const source of [wizard, releases, inline]) {
      assert.ok(!source.includes("/api/admin/upload/presigned"));
      assert.ok(!source.includes("new XMLHttpRequest"));
    }
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
