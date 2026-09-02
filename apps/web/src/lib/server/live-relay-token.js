import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const LIVE_RELAY_PATH = "2mrrw-live";
const TOKEN_VERSION = 1;
const TOKEN_AUDIENCE = "2mrrw-live-relay";
const DEFAULT_TTL_SECONDS = 120;
const MIN_SECRET_BYTES = 32;

function relaySecret() {
  const secret = String(process.env.LIVE_RELAY_TOKEN_SECRET || "");
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error("LIVE_RELAY_TOKEN_SECRET must contain at least 32 bytes");
  }
  return secret;
}

function signatureFor(encodedPayload) {
  return createHmac("sha256", relaySecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function getLiveRelayPublishUrl() {
  const configured = String(process.env.LIVE_RELAY_PUBLISH_BASE_URL || "").trim();
  if (!configured) throw new Error("LIVE_RELAY_PUBLISH_BASE_URL is not configured");

  let url;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("LIVE_RELAY_PUBLISH_BASE_URL is invalid");
  }

  const localDevelopment = process.env.NODE_ENV !== "production" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new Error("LIVE_RELAY_PUBLISH_BASE_URL must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("LIVE_RELAY_PUBLISH_BASE_URL cannot contain credentials, query, or fragment");
  }

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${LIVE_RELAY_PATH}/whip`.replace(/\/{2,}/g, "/");
  return url.toString();
}

export function issueLiveRelayPublishToken({ actorId, nowMs = Date.now(), ttlSeconds = DEFAULT_TTL_SECONDS } = {}) {
  if (!actorId) throw new Error("Live relay actor is required");
  const boundedTtl = Math.min(300, Math.max(30, Number(ttlSeconds) || DEFAULT_TTL_SECONDS));
  const issuedAt = Math.floor(nowMs / 1000);
  const payload = {
    v: TOKEN_VERSION,
    aud: TOKEN_AUDIENCE,
    sub: String(actorId),
    action: "publish",
    path: LIVE_RELAY_PATH,
    iat: issuedAt,
    exp: issuedAt + boundedTtl,
    jti: randomUUID(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return {
    token: `${encodedPayload}.${signatureFor(encodedPayload)}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyLiveRelayPublishToken(token, { nowMs = Date.now(), path = LIVE_RELAY_PATH } = {}) {
  const [encodedPayload, presentedSignature, extra] = String(token || "").split(".");
  if (!encodedPayload || !presentedSignature || extra !== undefined) {
    return { ok: false, reason: "malformed" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!safeEqual(presentedSignature, signatureFor(encodedPayload))) {
    return { ok: false, reason: "signature" };
  }

  const now = Math.floor(nowMs / 1000);
  if (
    payload?.v !== TOKEN_VERSION ||
    payload?.aud !== TOKEN_AUDIENCE ||
    payload?.action !== "publish" ||
    payload?.path !== path ||
    typeof payload?.sub !== "string" ||
    !payload.sub ||
    typeof payload?.iat !== "number" ||
    typeof payload?.exp !== "number" ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= now ||
    payload.iat > now + 30 ||
    payload.exp - payload.iat > 300
  ) {
    return { ok: false, reason: "claims" };
  }

  return { ok: true, payload };
}
