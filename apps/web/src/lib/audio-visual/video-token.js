/**
 * Audio Visual HMAC-SHA256 tokens — mirrors src/lib/hls/vault-video-token.js's
 * exact scheme (same HLS_HMAC_SECRET/HLS_HMAC_SECRET_PREVIOUS rotation, same
 * base64url(payload).base64url(signature) format), kept as a separate,
 * sibling file rather than extending the Vault one, so an Audio Visual token
 * can never be replayed against a Vault (or audio) endpoint and vice versa —
 * the type discriminator ("av_v"/"av_k" vs "vault_v"/"vault_k"/"key") is the
 * actual isolation mechanism, matching the exact reasoning already
 * established for Vault's own tokens.
 *
 * Token types:
 *   av_v — authorises fetching one Audio Visual rendition's variant
 *          playlist (codec family + resolution), 8 h TTL
 *   av_k — authorises AES-128 key delivery for one (videoId, assetVersionId)
 *          pair, 7.75 h TTL
 */

const VARIANT_TTL_SECONDS = 28_800; // 8 h
const KEY_TTL_SECONDS = 27_900; // 7.75 h — 15-min gap below variant TTL

function getHmacSecrets() {
  const current = process.env.HLS_HMAC_SECRET;
  if (!current || current.length < 32) {
    throw new Error("HLS_HMAC_SECRET must be set and at least 32 characters for Audio Visual tokens.");
  }
  const prev = process.env.HLS_HMAC_SECRET_PREVIOUS;
  return { current, previous: prev && prev.length >= 32 ? prev : null };
}

async function sign(payload) {
  const { current } = getHmacSecrets();
  const enc = new TextEncoder();
  const dataB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(current), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(dataB64));
  return `${dataB64}.${Buffer.from(sig).toString("base64url")}`;
}

async function verifyWithSecret(token, secret) {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const dataB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!sigB64) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) return null;

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const expectedSig = Buffer.from(sigB64, "base64url");
  const valid = await crypto.subtle.verify("HMAC", cryptoKey, expectedSig, enc.encode(dataB64));
  return valid ? payload : null;
}

async function verify(token) {
  try {
    const { current, previous } = getHmacSecrets();
    const result = await verifyWithSecret(token, current);
    if (result) return result;
    if (previous) return verifyWithSecret(token, previous);
    return null;
  } catch {
    return null;
  }
}

// ── Variant token ──

/**
 * @param {{ videoId: string, assetVersionId: string, codecFamily: string, resolutionLabel: string, userId: string }} opts
 */
export async function signAudioVisualVariantToken({ videoId, assetVersionId, codecFamily, resolutionLabel, userId }) {
  return sign({
    type: "av_v",
    vid: videoId,
    aid: assetVersionId,
    cf: codecFamily,
    rl: resolutionLabel,
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + VARIANT_TTL_SECONDS,
  });
}

/**
 * @param {string} token
 * @returns {Promise<{ videoId: string, assetVersionId: string, codecFamily: string, resolutionLabel: string, userId: string }|null>}
 */
export async function verifyAudioVisualVariantToken(token) {
  const p = await verify(token);
  if (!p || p.type !== "av_v") return null;
  return { videoId: p.vid, assetVersionId: p.aid, codecFamily: p.cf, resolutionLabel: p.rl, userId: p.uid };
}

// ── Key token ──

/**
 * @param {{ videoId: string, assetVersionId: string, userId: string }} opts
 */
export async function signAudioVisualKeyToken({ videoId, assetVersionId, userId }) {
  return sign({
    type: "av_k",
    vid: videoId,
    aid: assetVersionId,
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + KEY_TTL_SECONDS,
  });
}

/**
 * @param {string} token
 * @returns {Promise<{ videoId: string, assetVersionId: string, userId: string }|null>}
 */
export async function verifyAudioVisualKeyToken(token) {
  const p = await verify(token);
  if (!p || p.type !== "av_k") return null;
  return { videoId: p.vid, assetVersionId: p.aid, userId: p.uid };
}
