/**
 * PackagingEngine — encrypts CodecEngine's plain fMP4/CMAF HLS output
 * (init.mp4 + seg_*.m4s + playlist.m3u8) for delivery, working around
 * FFmpeg's confirmed muxer limitation ("Encrypted fmp4 not yet supported"
 * when combining -hls_segment_type fmp4 with -hls_key_info_file — audio's
 * MPEG-TS pipeline never hits this because TS supports native encryption).
 *
 * HLS's METHOD=AES-128 is explicitly container-agnostic (RFC 8216bis
 * §5.2) — decryption happens at the transport layer, before the demuxer
 * ever sees the bytes — so encrypting each fMP4 segment file independently
 * (whole-file AES-128-CBC, PKCS7 padding, one static key+IV per asset
 * version) is spec-legal, not a hack. This is confirmed directly against
 * the hls.js 1.6.16 source already vendored in this repo
 * (node_modules/hls.js/dist/hls.js), not assumed from spec text alone:
 *   - setInitSegment() (the playlist parser) assigns the SAME `levelkeys`
 *     context to the init-segment Fragment as any media segment — the
 *     init segment is not exempted from #EXT-X-KEY.
 *   - isMethodFullSegmentAesCbc() and the byte-range branch in
 *     createLoaderContext() are dedicated, named support for exactly
 *     METHOD=AES-128/AES-256 applied to an init segment, citing RFC
 *     8216bis §6.3.6 — proof this is a real, supported client path.
 *   - #EXT-X-KEY must precede #EXT-X-MAP in the playlist to apply to it
 *     (same parser: `levelkeys` is whatever's active when the parser
 *     reaches the MAP tag) — rewritePlaylistForEncryption inserts it
 *     there, never after.
 * Real playlist line order confirmed live against the production video
 * machine: #EXT-X-MAP appears once, after #EXT-X-INDEPENDENT-SEGMENTS and
 * before the first #EXTINF/segment line.
 *
 * Key derivation mirrors transcoder.js's existing worker-side convention
 * (Node crypto.createHmac) rather than importing the Vercel app's
 * Web-Crypto-based src/lib/hls/derive-key.js — the worker and the Next.js
 * app are separate deployables with no shared module path, exactly why
 * transcoder.js already duplicates this logic inline instead of importing
 * it. A distinct namespace ("2mrrw:av-hls:" vs audio's "2mrrw:hls:") keyed
 * by (videoId, assetVersionId) — the stable identity Part C's schema
 * already uses — keeps Audio Visual keys cryptographically independent of
 * audio's slug-keyed ones.
 */
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

function getMasterSecret() {
  const s = process.env.HLS_MASTER_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "HLS_MASTER_SECRET must be set and at least 32 characters. Generate with: openssl rand -hex 32"
    );
  }
  return s;
}

/**
 * Deterministic, never-stored AES-128 key + IV for one (videoId,
 * assetVersionId) pair — independently re-derivable by a future key-
 * delivery route from the same two IDs, exactly like audio's convention.
 *
 * @param {string} videoId
 * @param {string} assetVersionId
 * @returns {{ key: Buffer, iv: Buffer }} 16-byte buffers
 */
export function deriveAudioVisualHLSKeyAndIV(videoId, assetVersionId) {
  const secret = getMasterSecret();
  const canonical = `${videoId}:${assetVersionId}`;
  const keyInput = `2mrrw:av-hls:${canonical}:key`;
  const ivInput = `2mrrw:av-hls:${canonical}:iv`;
  const key = crypto.createHmac("sha256", secret).update(keyInput).digest().subarray(0, 16);
  const iv = crypto.createHmac("sha256", secret).update(ivInput).digest().subarray(0, 16);
  return { key, iv };
}

/**
 * Whole-file AES-128-CBC encrypt, PKCS7 padding (Node's default for this
 * cipher) — matches exactly what a compliant HLS AES-128 client (hls.js's
 * Decrypter) expects to decrypt per segment, independently.
 */
export function encryptSegmentBuffer(plainBuffer, key, iv) {
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
}

/** Inverse of encryptSegmentBuffer — proves the real round-trip in this module's own tests, and available for future debugging tooling. */
export function decryptSegmentBuffer(cipherBuffer, key, iv) {
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([decipher.update(cipherBuffer), decipher.final()]);
}

/**
 * Encrypts every fMP4 segment file (init.mp4 + every seg_*.m4s) in
 * sourceDir IN PLACE — the plaintext bytes are overwritten with
 * ciphertext, so a segment file is never simultaneously present in both
 * forms on disk for a later upload stage to accidentally pick up the
 * wrong one. Non-segment files (playlist.m3u8, quality logs, etc.) are
 * left untouched.
 *
 * @param {object} params
 * @param {string} params.sourceDir - directory containing CodecEngine's plain output
 * @param {string} params.videoId
 * @param {string} params.assetVersionId
 * @param {Function} [params.readdirFn]
 * @param {Function} [params.readFileFn]
 * @param {Function} [params.writeFileFn]
 * @returns {Promise<{ encryptedFiles: string[], keyHex: string, ivHex: string }>}
 */
export async function encryptRenditionSegments({
  sourceDir, videoId, assetVersionId,
  readdirFn = fs.readdir, readFileFn = fs.readFile, writeFileFn = fs.writeFile,
}) {
  const { key, iv } = deriveAudioVisualHLSKeyAndIV(videoId, assetVersionId);
  const entries = await readdirFn(sourceDir);
  const segmentFiles = entries.filter((name) => name === "init.mp4" || /^seg_\d+\.m4s$/.test(name)).sort();

  if (segmentFiles.length === 0) {
    const err = new Error(`No fMP4 segment files (init.mp4/seg_*.m4s) found in ${sourceDir} — nothing to encrypt`);
    err.failureCategory = "VALIDATION_FAILURE";
    throw err;
  }

  for (const fileName of segmentFiles) {
    const filePath = path.join(sourceDir, fileName);
    const plain = await readFileFn(filePath);
    const cipherBytes = encryptSegmentBuffer(plain, key, iv);
    await writeFileFn(filePath, cipherBytes);
  }

  return { encryptedFiles: segmentFiles, keyHex: key.toString("hex"), ivHex: iv.toString("hex") };
}

/**
 * Inserts #EXT-X-KEY immediately before #EXT-X-MAP so the key applies to
 * BOTH the init segment and every media segment (required by hls.js's
 * playlist parser — see this file's header). Throws rather than silently
 * no-op'ing if the playlist has no #EXT-X-MAP line — this pipeline always
 * produces fMP4 output with an init segment, so a missing MAP line means
 * something upstream produced the wrong container type.
 *
 * @param {string} playlistText
 * @param {string} keyUri - URL a client fetches to retrieve the key (a delivery-route concern, not this module's)
 * @param {string} ivHex - 32 hex chars (16 bytes)
 */
export function rewritePlaylistForEncryption(playlistText, keyUri, ivHex) {
  const lines = playlistText.split("\n");
  const mapIndex = lines.findIndex((line) => line.startsWith("#EXT-X-MAP:"));
  if (mapIndex === -1) {
    throw new Error("rewritePlaylistForEncryption: no #EXT-X-MAP line found — expected fMP4 output with an init segment");
  }
  const keyLine = `#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x${ivHex}`;
  lines.splice(mapIndex, 0, keyLine);
  return lines.join("\n");
}
