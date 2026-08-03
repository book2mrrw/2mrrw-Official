import crypto from "crypto";

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;

function getSecret() {
  return process.env.COLLECTOR_CARD_JWT_SECRET || process.env.GUEST_SESSION_SECRET || "";
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64").toString("utf8");
}

function signPayload(payloadB64) {
  const secret = getSecret();
  if (!secret) throw new Error("COLLECTOR_CARD_JWT_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createCollectorCardJwt({
  cardId,
  visibleSerial,
  userId = null,
  ttlSeconds = DEFAULT_TTL_SECONDS,
}) {
  if (!cardId || !visibleSerial) {
    throw new Error("cardId and visibleSerial required");
  }

  const payload = {
    sub: cardId,
    serial: visibleSerial,
    uid: userId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(payloadB64);
  return `${payloadB64}.${signature}`;
}

export function verifyCollectorCardJwt(token) {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "invalid_token" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "invalid_format" };
  }

  const [payloadB64, signature] = parts;
  let expected;
  try {
    expected = signPayload(payloadB64);
  } catch {
    return { ok: false, reason: "secret_missing" };
  }

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "invalid_signature" };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }

  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    cardId: payload.sub,
    visibleSerial: payload.serial,
    userId: payload.uid || null,
    payload,
  };
}

export { verifyCollectorCardJwt as verifyCardToken, createCollectorCardJwt as signCardToken };
