/**
 * Deterministic AES-128 key + IV derivation for HLS content protection.
 *
 * Keys are NEVER stored in the database. Both the Fly.io transcoding worker
 * and the Vercel key-delivery endpoint independently derive the same key from:
 *   HMAC-SHA256(HLS_MASTER_SECRET, "<slug>:<trackSlug>:<purpose>")[0:16]
 *
 * Rotating HLS_MASTER_SECRET invalidates all existing segments (requires re-transcode).
 * That is intentional — key rotation is a security event.
 *
 * Workers and servers share the secret via the HLS_MASTER_SECRET environment variable.
 */

/** @returns {string} */
function getMasterSecret() {
  const s = process.env.HLS_MASTER_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "HLS_MASTER_SECRET must be set and at least 32 characters. " +
      "Generate with: openssl rand -hex 32"
    );
  }
  return s;
}

/**
 * Build the canonical derivation input for a track.
 * @param {string} slug
 * @param {string|null} trackSlug
 * @param {"key"|"iv"} purpose
 */
function derivationInput(slug, trackSlug, purpose) {
  const track = trackSlug ? `${slug}:${trackSlug}` : slug;
  return `2mrrw:hls:${track}:${purpose}`;
}

/**
 * Derive a 16-byte AES-128 key for a track using HMAC-SHA256.
 * Returns the first 16 bytes of the HMAC output.
 *
 * @param {string} slug
 * @param {string|null} [trackSlug]
 * @returns {Promise<Buffer>} 16-byte key buffer
 */
export async function deriveHLSKey(slug, trackSlug = null) {
  const secret = getMasterSecret();
  const input = derivationInput(slug, trackSlug, "key");

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const raw = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(input));
  return Buffer.from(raw).subarray(0, 16);
}

/**
 * Derive a 16-byte AES-128 IV for a track using HMAC-SHA256.
 * Returns the first 16 bytes of the HMAC output.
 *
 * @param {string} slug
 * @param {string|null} [trackSlug]
 * @returns {Promise<Buffer>} 16-byte IV buffer
 */
export async function deriveHLSIV(slug, trackSlug = null) {
  const secret = getMasterSecret();
  const input = derivationInput(slug, trackSlug, "iv");

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const raw = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(input));
  return Buffer.from(raw).subarray(0, 16);
}

/**
 * Derive both key and IV, returning hex strings suitable for FFmpeg key-info files.
 * @param {string} slug
 * @param {string|null} [trackSlug]
 * @returns {Promise<{ keyHex: string, ivHex: string, keyBuffer: Buffer, ivBuffer: Buffer }>}
 */
export async function deriveHLSKeyAndIV(slug, trackSlug = null) {
  const [keyBuffer, ivBuffer] = await Promise.all([
    deriveHLSKey(slug, trackSlug),
    deriveHLSIV(slug, trackSlug),
  ]);
  return {
    keyBuffer,
    ivBuffer,
    keyHex: keyBuffer.toString("hex"),
    ivHex: ivBuffer.toString("hex"),
  };
}

/**
 * Build the canonical R2 prefix for this track's HLS segments.
 * @param {string} slug
 * @param {string|null} trackSlug
 * @param {string} releaseType  e.g. "singles", "albums", "mixtapes-and-eps"
 * @returns {string}  e.g. "hls/singles/my-slug/" or "hls/albums/album-slug/track-slug/"
 */
export function buildHLSPrefix(slug, trackSlug, releaseType) {
  const rt = String(releaseType || "singles").replace(/[^a-z0-9-]/g, "");
  const s = String(slug || "").replace(/[^a-z0-9-_]/g, "");
  if (trackSlug) {
    const ts = String(trackSlug).replace(/[^a-z0-9-_]/g, "");
    return `hls/${rt}/${s}/${ts}/`;
  }
  return `hls/${rt}/${s}/`;
}
