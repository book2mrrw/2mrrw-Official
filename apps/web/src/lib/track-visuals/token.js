import { createHmac, timingSafeEqual } from 'node:crypto';
import { UUID_RE } from './contract';
const TTL = 8 * 60 * 60;
function signature(body, secret) {
  return createHmac('sha256', secret).update(`2mrrw:track-visual-delivery:${body}`).digest();
}
export function signVisualToken(versionId, now = Date.now()) {
  const secret = process.env.HLS_HMAC_SECRET;
  if (!secret || secret.length < 32 || !UUID_RE.test(versionId)) throw new Error('Visual signing unavailable');
  const body = Buffer.from(JSON.stringify({ versionId, exp: Math.floor(now / 1000) + TTL })).toString('base64url');
  return `${body}.${signature(body, secret).toString('base64url')}`;
}
export function verifyVisualToken(token, versionId, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 1024 || !UUID_RE.test(versionId)) return false;
    const parts = token.split('.'); if (parts.length !== 2) return false;
    const [body, encoded] = parts, supplied = Buffer.from(encoded, 'base64url');
    const valid = [process.env.HLS_HMAC_SECRET, process.env.HLS_HMAC_SECRET_PREVIOUS].some(secret => {
      if (!secret || secret.length < 32) return false;
      const expected = signature(body, secret);
      return expected.length === supplied.length && timingSafeEqual(expected, supplied);
    });
    if (!valid) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.versionId === versionId && Number.isSafeInteger(payload.exp) && payload.exp > Math.floor(now / 1000);
  } catch { return false; }
}
