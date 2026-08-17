/**
 * Short-lived HMAC-SHA256 tokens for HLS auth.
 *
 * Two token types:
 *   variant  — authorises fetching a variant playlist (8 h TTL)
 *   key      — authorises AES-128 key delivery (7.75 h TTL)
 *
 * TTL rationale (B1.4):
 *   The original 55/60 min TTLs caused silent stream failure for listeners who
 *   kept a session open longer than 55 minutes: the key token embedded in the
 *   variant playlist (which hls.js does not re-fetch for #EXT-X-PLAYLIST-TYPE:VOD)
 *   expired, the next key fetch returned 403, and hls.js treated it as fatal.
 *   8 h / 7.75 h covers a full listening day with a 15-minute buffer before the
 *   variant playlist itself expires — no re-fetch required, no session failure.
 *
 * Dual-key rotation (B1.7):
 *   Emergency rotation of HLS_HMAC_SECRET previously required a two-step deploy:
 *   1. deploy with new secret → all active listeners (who hold tokens signed with
 *      the old secret) fail immediately with 403 on their next key fetch.
 *
 *   The dual-key scheme eliminates this disruption:
 *   - SIGN:   always with HLS_HMAC_SECRET (current).
 *   - VERIFY: try HLS_HMAC_SECRET first; on failure, try HLS_HMAC_SECRET_PREVIOUS.
 *   - ROTATE: deploy sets HLS_HMAC_SECRET = <new>, HLS_HMAC_SECRET_PREVIOUS = <old>.
 *             Active listeners' tokens remain valid for up to 8 h after rotation.
 *             After 8 h all old tokens have expired naturally; remove _PREVIOUS.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
 * No JWT library — keeps the bundle tiny on the edge.
 */

// 8 h variant TTL — covers a full listening day, eliminates 55-min session failures.
const VARIANT_TTL_SECONDS = 28_800;
// 7.75 h key TTL — 15-min gap below variant TTL; key token always expires before
// the variant playlist so the playlist itself is the longer-lived credential.
const KEY_TTL_SECONDS     = 27_900;

/**
 * Returns { current, previous } HMAC secrets.
 * current  — the active signing secret; required.
 * previous — optional fallback for tokens signed before the last rotation.
 */
function getHmacSecrets() {
  const current = process.env.HLS_HMAC_SECRET;
  if (!current || current.length < 32) {
    throw new Error(
      "HLS_HMAC_SECRET must be set and at least 32 characters. " +
      "Generate with: openssl rand -hex 32"
    );
  }
  const prev = process.env.HLS_HMAC_SECRET_PREVIOUS;
  return {
    current,
    previous: prev && prev.length >= 32 ? prev : null,
  };
}

/**
 * Sign a payload with the current HMAC secret.
 * @param {object} payload
 * @returns {Promise<string>}
 */
async function sign(payload) {
  const { current } = getHmacSecrets();
  const enc    = new TextEncoder();
  const dataB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(current), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(dataB64));
  return `${dataB64}.${Buffer.from(sig).toString("base64url")}`;
}

/**
 * Verify a token against one specific secret.
 * Returns the decoded payload on success, null on failure or expiry.
 * @param {string} token
 * @param {string} secret
 * @returns {Promise<object|null>}
 */
async function verifyWithSecret(token, secret) {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const dataB64 = token.slice(0, dot);
  const sigB64  = token.slice(dot + 1);
  if (!sigB64) return null;

  const payload = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));

  // Expiry check first — cheap, no crypto
  if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const expectedSig = Buffer.from(sigB64, "base64url");
  const valid = await crypto.subtle.verify("HMAC", cryptoKey, expectedSig, enc.encode(dataB64));
  return valid ? payload : null;
}

/**
 * Verify a token against current secret, then previous if present.
 * Dual-key: tokens signed before rotation remain valid until they expire naturally.
 *
 * @param {string} token
 * @returns {Promise<object|null>}  null when invalid or expired
 */
async function verify(token) {
  try {
    const { current, previous } = getHmacSecrets();

    // Try current secret first — covers all newly minted tokens (fast path)
    const result = await verifyWithSecret(token, current);
    if (result) return result;

    // Try previous secret — covers listeners who received tokens before the last rotation
    if (previous) return verifyWithSecret(token, previous);

    return null;
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
    br:  bitrate,
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
    ts:  trackSlug || null,
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
