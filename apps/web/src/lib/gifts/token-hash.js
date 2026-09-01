import crypto from "crypto";

export function hashGiftLinkToken(raw) {
  return crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

export function createGiftLinkToken() {
  const raw = crypto.randomBytes(32).toString("hex");
  return { raw, hash: hashGiftLinkToken(raw) };
}
