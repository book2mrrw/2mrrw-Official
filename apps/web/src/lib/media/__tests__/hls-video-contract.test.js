import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(path.join(WEB, relative), "utf8");

describe("HLS video rendition contract", () => {
  const worker = read("workers/hls-transcoder/src/transcoder.js");
  const contract = read("workers/hls-transcoder/src/rendition-contract.js");
  const image = read("workers/hls-transcoder/Dockerfile");
  const master = read("src/app/api/vault/video/manifest/route.js");
  const variant = read("src/app/api/vault/video/variant/route.js");
  const migration = read("supabase/migrations/20260828000054_hls_rendition_metadata.sql");

  test("worker probes the source once and chooses media kind from streams", () => {
    assert.equal((worker.match(/downloadStream\(sourceKey\)/g) || []).length, 1);
    assert.match(worker, /probeSource\(sourcePath\)/);
    assert.match(worker, /const mediaKind = videoSource \? "video" : "audio"/);
    assert.match(image, /\/ffprobe \/usr\/local\/bin\/ffprobe/);
  });

  test("video tiers have explicit H.264 and bounded AAC controls", () => {
    assert.match(contract, /"-c:v", "libx264"/);
    assert.match(contract, /"-maxrate", `\$\{rendition\.videoKbps\}k`/);
    assert.match(contract, /"-b:a", `\$\{rendition\.audioKbps\}k`/);
    assert.match(contract, /"-force_key_frames"/);
    assert.match(contract, /selectVideoRenditions/);
    assert.match(contract, /seenDimensions/);
  });

  test("master playlist advertises measured rendition facts", () => {
    assert.match(master, /rendition_metadata/);
    assert.match(master, /AVERAGE-BANDWIDTH/);
    assert.match(master, /RESOLUTION=/);
    assert.match(master, /FRAME-RATE=/);
    assert.match(master, /metadata\.peak_bandwidth/);
    assert.match(master, /metadata\.codecs/);
  });

  test("variant playlist prefers exact encoded segment durations", () => {
    assert.match(variant, /segment_durations/);
    assert.match(variant, /exactDurations/);
    assert.match(variant, /#EXT-X-INDEPENDENT-SEGMENTS/);
  });

  test("migration is additive, constrained, and versioned", () => {
    for (const column of [
      "media_kind",
      "segment_durations",
      "rendition_metadata",
      "source_metadata",
      "transcode_profile_version",
    ]) assert.match(migration, new RegExp(`add column if not exists ${column}`));
    assert.match(migration, /media_kind in \('audio', 'video'\)/);
    assert.match(migration, /jsonb_typeof\(rendition_metadata\) = 'object'/);
  });
});

