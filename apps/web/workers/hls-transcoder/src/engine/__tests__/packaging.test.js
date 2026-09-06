import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptSegmentBuffer,
  deriveAudioVisualHLSKeyAndIV,
  encryptRenditionSegments,
  encryptSegmentBuffer,
  rewritePlaylistForEncryption,
} from "../packaging.js";

process.env.HLS_MASTER_SECRET = "test-secret-at-least-32-characters-long-xyz";

// Real playlist shape confirmed live against the production video machine's
// FFmpeg fMP4/CMAF HLS output (mwader/static-ffmpeg:7.1).
const REAL_PLAYLIST = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:1",
  "#EXT-X-MEDIA-SEQUENCE:0",
  "#EXT-X-PLAYLIST-TYPE:VOD",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-MAP:URI="init.mp4"',
  "#EXTINF:1.000000,",
  "seg_00000.m4s",
  "#EXTINF:1.000000,",
  "seg_00001.m4s",
  "#EXTINF:1.000000,",
  "seg_00002.m4s",
  "#EXT-X-ENDLIST",
].join("\n");

function fakeFs(initialFiles) {
  const files = new Map(Object.entries(initialFiles));
  return {
    files,
    readdirFn: async () => Array.from(files.keys()),
    readFileFn: async (filePath) => {
      const name = filePath.split("/").pop();
      if (!files.has(name)) throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
      return files.get(name);
    },
    writeFileFn: async (filePath, data) => {
      const name = filePath.split("/").pop();
      files.set(name, data);
    },
  };
}

// ── deriveAudioVisualHLSKeyAndIV ──

test("deriveAudioVisualHLSKeyAndIV: throws when HLS_MASTER_SECRET is missing or too short", () => {
  const saved = process.env.HLS_MASTER_SECRET;
  delete process.env.HLS_MASTER_SECRET;
  assert.throws(() => deriveAudioVisualHLSKeyAndIV("video-1", "version-1"), /HLS_MASTER_SECRET must be set/);
  process.env.HLS_MASTER_SECRET = "too-short";
  assert.throws(() => deriveAudioVisualHLSKeyAndIV("video-1", "version-1"), /HLS_MASTER_SECRET must be set/);
  process.env.HLS_MASTER_SECRET = saved;
});

test("deriveAudioVisualHLSKeyAndIV: deterministic — same (videoId, assetVersionId) always derives the same 16-byte key and IV", () => {
  const a = deriveAudioVisualHLSKeyAndIV("video-1", "version-1");
  const b = deriveAudioVisualHLSKeyAndIV("video-1", "version-1");
  assert.equal(a.key.length, 16);
  assert.equal(a.iv.length, 16);
  assert.ok(a.key.equals(b.key));
  assert.ok(a.iv.equals(b.iv));
});

test("deriveAudioVisualHLSKeyAndIV: a different videoId or a different assetVersionId derives a genuinely different key — real per-asset isolation", () => {
  const base = deriveAudioVisualHLSKeyAndIV("video-1", "version-1");
  const differentVideo = deriveAudioVisualHLSKeyAndIV("video-2", "version-1");
  const differentVersion = deriveAudioVisualHLSKeyAndIV("video-1", "version-2");
  assert.ok(!base.key.equals(differentVideo.key));
  assert.ok(!base.key.equals(differentVersion.key));
  assert.ok(!base.iv.equals(differentVideo.iv));
});

test("deriveAudioVisualHLSKeyAndIV: key and IV are different from each other, not the same bytes reused", () => {
  const { key, iv } = deriveAudioVisualHLSKeyAndIV("video-1", "version-1");
  assert.ok(!key.equals(iv));
});

// ── encrypt/decrypt round trip (real Node crypto, not mocked) ──

test("encryptSegmentBuffer/decryptSegmentBuffer: a real AES-128-CBC round trip recovers the exact original bytes", () => {
  const { key, iv } = deriveAudioVisualHLSKeyAndIV("video-1", "version-1");
  const plain = Buffer.from("this stands in for real fMP4 init/segment bytes, arbitrary length 37b");
  const cipher = encryptSegmentBuffer(plain, key, iv);
  const recovered = decryptSegmentBuffer(cipher, key, iv);
  assert.ok(recovered.equals(plain));
  assert.ok(!cipher.equals(plain));
});

test("encryptSegmentBuffer: ciphertext length is always a multiple of the 16-byte AES block size (PKCS7 padding), matching what a real HLS AES-128 client's per-segment decrypt expects", () => {
  const { key, iv } = deriveAudioVisualHLSKeyAndIV("video-1", "version-1");
  for (const len of [0, 1, 15, 16, 17, 1000, 1024]) {
    const cipher = encryptSegmentBuffer(Buffer.alloc(len, 0xab), key, iv);
    assert.equal(cipher.length % 16, 0, `length ${len} produced non-block-aligned ciphertext`);
  }
});

test("decryptSegmentBuffer: a different key fails to recover the original plaintext (proves the key genuinely matters, not a no-op cipher)", () => {
  const a = deriveAudioVisualHLSKeyAndIV("video-1", "version-1");
  const b = deriveAudioVisualHLSKeyAndIV("video-2", "version-1");
  const plain = Buffer.from("secret payload");
  const cipher = encryptSegmentBuffer(plain, a.key, a.iv);
  assert.throws(() => decryptSegmentBuffer(cipher, b.key, b.iv));
});

// ── encryptRenditionSegments ──

test("encryptRenditionSegments: encrypts init.mp4 and every seg_*.m4s in place, and the result decrypts back to the exact original plaintext", async () => {
  const originals = {
    "init.mp4": Buffer.from("fake init segment bytes"),
    "seg_00000.m4s": Buffer.from("fake media segment 0"),
    "seg_00001.m4s": Buffer.from("fake media segment 1"),
    "playlist.m3u8": Buffer.from(REAL_PLAYLIST),
  };
  const fake = fakeFs(originals);

  const result = await encryptRenditionSegments({
    sourceDir: "/data/jobs/job-1/av1-720p",
    videoId: "video-1", assetVersionId: "version-1",
    readdirFn: fake.readdirFn, readFileFn: fake.readFileFn, writeFileFn: fake.writeFileFn,
  });

  assert.deepEqual(result.encryptedFiles, ["init.mp4", "seg_00000.m4s", "seg_00001.m4s"]);
  assert.equal(result.keyHex.length, 32);
  assert.equal(result.ivHex.length, 32);

  const { key, iv } = deriveAudioVisualHLSKeyAndIV("video-1", "version-1");
  for (const name of ["init.mp4", "seg_00000.m4s", "seg_00001.m4s"]) {
    const stored = fake.files.get(name);
    assert.ok(!stored.equals(originals[name]), `${name} was not actually re-encrypted in place`);
    const recovered = decryptSegmentBuffer(stored, key, iv);
    assert.ok(recovered.equals(originals[name]), `${name} did not decrypt back to its original plaintext`);
  }
  // playlist.m3u8 is not a segment file — left untouched
  assert.ok(fake.files.get("playlist.m3u8").equals(originals["playlist.m3u8"]));
});

test("encryptRenditionSegments: two different (videoId, assetVersionId) pairs produce different ciphertext for identical plaintext — real per-asset key isolation exercised end to end", async () => {
  const plaintext = Buffer.from("identical source bytes");
  const fakeA = fakeFs({ "init.mp4": plaintext });
  const fakeB = fakeFs({ "init.mp4": plaintext });

  await encryptRenditionSegments({
    sourceDir: "/data/a", videoId: "video-A", assetVersionId: "version-1",
    readdirFn: fakeA.readdirFn, readFileFn: fakeA.readFileFn, writeFileFn: fakeA.writeFileFn,
  });
  await encryptRenditionSegments({
    sourceDir: "/data/b", videoId: "video-B", assetVersionId: "version-1",
    readdirFn: fakeB.readdirFn, readFileFn: fakeB.readFileFn, writeFileFn: fakeB.writeFileFn,
  });

  assert.ok(!fakeA.files.get("init.mp4").equals(fakeB.files.get("init.mp4")));
});

test("encryptRenditionSegments: an empty/non-segment directory throws VALIDATION_FAILURE rather than silently succeeding with nothing encrypted", async () => {
  const fake = fakeFs({ "playlist.m3u8": Buffer.from(REAL_PLAYLIST), "notes.txt": Buffer.from("hi") });
  await assert.rejects(
    () => encryptRenditionSegments({
      sourceDir: "/data/out", videoId: "video-1", assetVersionId: "version-1",
      readdirFn: fake.readdirFn, readFileFn: fake.readFileFn, writeFileFn: fake.writeFileFn,
    }),
    (err) => {
      assert.equal(err.failureCategory, "VALIDATION_FAILURE");
      assert.match(err.message, /nothing to encrypt/);
      return true;
    }
  );
});

// ── rewritePlaylistForEncryption ──

test("rewritePlaylistForEncryption: inserts #EXT-X-KEY immediately before #EXT-X-MAP so it covers both the init segment and every media segment", () => {
  const rewritten = rewritePlaylistForEncryption(REAL_PLAYLIST, "https://example.com/key/video-1/version-1", "aabbccdd" + "00".repeat(12));
  const lines = rewritten.split("\n");
  const keyIndex = lines.findIndex((l) => l.startsWith("#EXT-X-KEY:"));
  const mapIndex = lines.findIndex((l) => l.startsWith("#EXT-X-MAP:"));
  assert.ok(keyIndex !== -1, "no #EXT-X-KEY line was inserted");
  assert.equal(keyIndex, mapIndex - 1, "#EXT-X-KEY must be the line immediately before #EXT-X-MAP");
  assert.match(lines[keyIndex], /METHOD=AES-128/);
  assert.match(lines[keyIndex], /URI="https:\/\/example\.com\/key\/video-1\/version-1"/);
  assert.match(lines[keyIndex], /IV=0xaabbccdd0{24}$/);
});

test("rewritePlaylistForEncryption: every other line is preserved exactly, in order, around the inserted key line", () => {
  const rewritten = rewritePlaylistForEncryption(REAL_PLAYLIST, "https://example.com/key", "ab".repeat(16));
  const originalLines = REAL_PLAYLIST.split("\n");
  const rewrittenLines = rewritten.split("\n");
  const withoutKeyLine = rewrittenLines.filter((l) => !l.startsWith("#EXT-X-KEY:"));
  assert.deepEqual(withoutKeyLine, originalLines);
});

test("rewritePlaylistForEncryption: a playlist with no #EXT-X-MAP line throws rather than silently producing an unencrypted-init-segment playlist", () => {
  const noMapPlaylist = REAL_PLAYLIST.split("\n").filter((l) => !l.startsWith("#EXT-X-MAP:")).join("\n");
  assert.throws(
    () => rewritePlaylistForEncryption(noMapPlaylist, "https://example.com/key", "ab".repeat(16)),
    /no #EXT-X-MAP line found/
  );
});
