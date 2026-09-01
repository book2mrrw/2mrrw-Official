import crypto from "crypto";

const REMINDER_PREFIX = "r1.";

/**
 * INV-ENT-17: no ADMIN_SEED_SECRET fallback. A key that signs gift reminder
 * links — which grant access to a gift claim — must not also be the bearer
 * credential for eleven privileged API routes.
 */
function signingSecret() {
  return (
    process.env.GIFT_REMINDER_SIGNING_SECRET ||
    process.env.GUEST_SESSION_SECRET ||
    ""
  );
}

function encodePayload(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodePayload(encoded) {
  const json = Buffer.from(encoded, "base64url").toString("utf8");
  return JSON.parse(json);
}

export function isGiftReminderToken(token) {
  return typeof token === "string" && token.startsWith(REMINDER_PREFIX);
}

/**
 * Signed reminder token (no plaintext gift link token in DB).
 * Format: r1.<base64url(payload)>.<base64url(hmac)>
 */
export function createGiftReminderToken(giftId, expiresAtIso) {
  const secret = signingSecret();
  if (!secret) {
    throw new Error("GIFT_REMINDER_SIGNING_SECRET (or GUEST_SESSION_SECRET) required for reminder links");
  }
  const exp = expiresAtIso
    ? Math.floor(new Date(expiresAtIso).getTime() / 1000)
    : Math.floor(Date.now() / 1000) + 15 * 24 * 3600;
  const payload = encodePayload({ gid: giftId, exp });
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${REMINDER_PREFIX}${payload}.${sig}`;
}

export function parseGiftReminderToken(token) {
  if (!isGiftReminderToken(token)) return null;
  const secret = signingSecret();
  if (!secret) return null;

  const body = token.slice(REMINDER_PREFIX.length);
  const lastDot = body.lastIndexOf(".");
  if (lastDot <= 0) return null;

  const payload = body.slice(0, lastDot);
  const sig = body.slice(lastDot + 1);
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!sig || sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const { gid, exp } = decodePayload(payload);
    if (!gid || !exp) return null;
    if (Math.floor(Date.now() / 1000) > Number(exp)) return null;
    return { giftId: gid, expiresAt: new Date(Number(exp) * 1000).toISOString() };
  } catch {
    return null;
  }
}

export async function buildSignedGiftReminderLink(giftId, expiresAtIso) {
  const { buildGiftLink } = await import("@/lib/gifts/email");
  const token = createGiftReminderToken(giftId, expiresAtIso);
  return buildGiftLink(token);
}
