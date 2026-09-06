/**
 * Deterministic AES-128 key + IV derivation for Audio Visual HLS content
 * protection — the Vercel-side counterpart to
 * workers/hls-transcoder/src/engine/packaging.js's worker-side derivation.
 *
 * The worker and this app are separate deployables with no shared module
 * path (the worker already duplicates audio's own key derivation inline
 * for the same reason — see transcoder.js), so this file independently
 * re-implements the IDENTICAL algorithm packaging.js uses: HMAC-SHA256(
 * HLS_MASTER_SECRET, "2mrrw:av-hls:<videoId>:<assetVersionId>:<purpose>")
 * truncated to 16 bytes. Both sides must derive byte-identical keys from
 * the same (videoId, assetVersionId) — this file's own test suite proves
 * that by cross-checking this Web-Crypto-based implementation against
 * Node's crypto.createHmac (which is what packaging.js actually uses)
 * for the same inputs, rather than assuming the two APIs agree.
 *
 * This is NOT the same key space as src/lib/hls/derive-key.js (audio's
 * slug-keyed "2mrrw:hls:" namespace) — kept as a separate, sibling file
 * rather than modified/extended, since audio_visuals has no slug at all
 * (see the schema migration's own header comment) and mixing namespaces
 * in one file risks exactly the kind of cross-content-type key confusion
 * both namespaces exist to prevent.
 */

function getMasterSecret() {
  const s = process.env.HLS_MASTER_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "HLS_MASTER_SECRET must be set and at least 32 characters. Generate with: openssl rand -hex 32"
    );
  }
  return s;
}

async function hmacSha256(secret, input) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const raw = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(input));
  return Buffer.from(raw);
}

function derivationInput(videoId, assetVersionId, purpose) {
  return `2mrrw:av-hls:${videoId}:${assetVersionId}:${purpose}`;
}

/**
 * @param {string} videoId
 * @param {string} assetVersionId
 * @returns {Promise<Buffer>} 16-byte AES-128 key
 */
export async function deriveAudioVisualHLSKey(videoId, assetVersionId) {
  const secret = getMasterSecret();
  const raw = await hmacSha256(secret, derivationInput(videoId, assetVersionId, "key"));
  return raw.subarray(0, 16);
}

/**
 * @param {string} videoId
 * @param {string} assetVersionId
 * @returns {Promise<Buffer>} 16-byte AES-128 IV
 */
export async function deriveAudioVisualHLSIV(videoId, assetVersionId) {
  const secret = getMasterSecret();
  const raw = await hmacSha256(secret, derivationInput(videoId, assetVersionId, "iv"));
  return raw.subarray(0, 16);
}
