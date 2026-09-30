/**
 * Vault audio HMAC-SHA256 tokens — a third token namespace, alongside the
 * release audio pipeline's and vault video's, so a token minted for one can
 * never be replayed against another's endpoints.
 *
 * Token types:
 *   vault_a   — authorises fetching a vault audio variant playlist (8 h TTL)
 *   vault_ak  — authorises AES-128 key delivery for vault audio (7.75 h TTL)
 *
 * The type string is checked on every verify, which is what makes the
 * separation real rather than conventional: a release stream token ("variant")
 * and a vault video token ("vault_v") both fail the check here even though all
 * three are signed with the same secret.
 *
 * Dual-key rotation: HLS_HMAC_SECRET with HLS_HMAC_SECRET_PREVIOUS as the
 * grace secret, matching the other two namespaces. A rotation leaves active
 * sessions playing for up to 8 h instead of cutting them off mid-listen.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature)
 */

const VARIANT_TTL_SECONDS = 28_800;   // 8 h — covers a full listening day
const KEY_TTL_SECONDS     = 27_900;   // 7.75 h — 15-min gap below variant TTL

function getHmacSecrets() {
  const current = process.env.HLS_HMAC_SECRET;
  if (!current || current.length < 32) {
    throw new Error(
      "HLS_HMAC_SECRET must be set and at least 32 characters for vault audio tokens."
    );
  }
  const prev = process.env.HLS_HMAC_SECRET_PREVIOUS;
  return {
    current,
    previous: prev && prev.length >= 32 ? prev : null,
  };
}

async function sign(payload) {
  const { current } = getHmacSecrets();
  const enc     = new TextEncoder();
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
  const sigB64  = token.slice(dot + 1);
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

// ── Variant token ─────────────────────────────────────────────────────────────

/**
 * @param {{ contentSlug: string, userId: string, bitrate: string }} opts
 * @returns {Promise<string>}
 */
export async function signVaultAudioVariantToken({ contentSlug, userId, bitrate }) {
  return sign({
    type: "vault_a",
    cs:   contentSlug,
    uid:  userId,
    br:   bitrate,
    exp:  Math.floor(Date.now() / 1000) + VARIANT_TTL_SECONDS,
  });
}

/**
 * @param {string} token
 * @returns {Promise<{ contentSlug: string, userId: string, bitrate: string }|null>}
 */
export async function verifyVaultAudioVariantToken(token) {
  const p = await verify(token);
  if (!p || p.type !== "vault_a") return null;
  return { contentSlug: p.cs, userId: p.uid, bitrate: p.br };
}

// ── Key token ─────────────────────────────────────────────────────────────────

/**
 * @param {{ contentSlug: string, userId: string }} opts
 * @returns {Promise<string>}
 */
export async function signVaultAudioKeyToken({ contentSlug, userId }) {
  return sign({
    type: "vault_ak",
    cs:   contentSlug,
    uid:  userId,
    exp:  Math.floor(Date.now() / 1000) + KEY_TTL_SECONDS,
  });
}

/**
 * @param {string} token
 * @returns {Promise<{ contentSlug: string, userId: string }|null>}
 */
export async function verifyVaultAudioKeyToken(token) {
  const p = await verify(token);
  if (!p || p.type !== "vault_ak") return null;
  return { contentSlug: p.cs, userId: p.uid };
}
