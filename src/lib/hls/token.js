/**
 * Short-lived HMAC-SHA256 tokens for HLS auth.
 *
 * Two token types:
 *   variant  — authorises fetching a variant playlist (60 min TTL)
 *   key      — authorises AES-128 key delivery (10 min TTL)
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
 * No JWT library needed — keeps the bundle tiny on the edge.
 */

const VARIANT_TTL_SECONDS = 3600;   // 60 min — covers a full stream session
const KEY_TTL_SECONDS     = 600;    // 10 min — key requests happen at the start of each segment batch

/** @returns {string} */
function getHmacSecret() {
  const s = process.env.HLS_HMAC_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "HLS_HMAC_SECRET must be set and at least 32 characters. " +
      "Generate with: openssl rand -hex 32"
    );
  }
  return s;
}

/**
 * @param {object} payload
 * @returns {Promise<string>}
 */
async function sign(payload) {
  const enc = new TextEncoder();
  const dataB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(getHmacSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(dataB64));
  const sigB64 = Buffer.from(sig).toString("base64url");
  return `${dataB64}.${sigB64}`;
}

/**
 * @param {string} token
 * @returns {Promise<object|null>}  null when invalid or expired
 */
async function verify(token) {
  try {
    const dot = token.indexOf(".");
    if (dot < 1) return null;
    const dataB64 = token.slice(0, dot);
    const sigB64  = token.slice(dot + 1);
    if (!sigB64) return null;

    const payload = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));

    // Expiry check first (cheap, no crypto)
    if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;

    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(getHmacSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const expectedSig = Buffer.from(sigB64, "base64url");
    const valid = await crypto.subtle.verify("HMAC", cryptoKey, expectedSig, enc.encode(dataB64));
    return valid ? payload : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Variant token — authorises fetching a variant playlist
// ---------------------------------------------------------------------------

/**
 * @param {{ slug: string, trackSlug?: string|null, userId: string, bitrate: string }} opts
 * @returns {Promise<string>}
 */
export async function signVariantToken({ slug, trackSlug = null, userId, bitrate }) {
  return sign({
    type: "variant",
    slug,
    ts: trackSlug || null,
    uid: userId,
    br: bitrate,
    exp: Math.floor(Date.now() / 1000) + VARIANT_TTL_SECONDS,
  });
}

/**
 * @param {string} token
 * @returns {Promise<{ slug: string, trackSlug: string|null, userId: string, bitrate: string }|null>}
 */
export async function verifyVariantToken(token) {
  const p = await verify(token);
  if (!p || p.type !== "variant") return null;
  return { slug: p.slug, trackSlug: p.ts || null, userId: p.uid, bitrate: p.br };
}

// ---------------------------------------------------------------------------
// Key token — authorises AES-128 key delivery
// ---------------------------------------------------------------------------

/**
 * @param {{ slug: string, trackSlug?: string|null, userId: string }} opts
 * @returns {Promise<string>}
 */
export async function signKeyToken({ slug, trackSlug = null, userId }) {
  return sign({
    type: "key",
    slug,
    ts: trackSlug || null,
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + KEY_TTL_SECONDS,
  });
}

/**
 * @param {string} token
 * @returns {Promise<{ slug: string, trackSlug: string|null, userId: string }|null>}
 */
export async function verifyKeyToken(token) {
  const p = await verify(token);
  if (!p || p.type !== "key") return null;
  return { slug: p.slug, trackSlug: p.ts || null, userId: p.uid };
}
