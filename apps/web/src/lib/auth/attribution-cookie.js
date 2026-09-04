import { cookies } from "next/headers";

const COOKIE_NAME = "ff_attr";
const ALLOWED_KEYS = ["source", "medium", "campaign", "term", "content", "referrer", "landingPath", "capturedAt"];

/**
 * Reads the first-touch marketing cookie set by MarketingAttributionCapture
 * and returns a plain object safe to store on profiles.first_touch, or null
 * if absent/unparseable. Defensive by construction — this reads a client-
 * writable cookie, so it must never let malformed or oversized content
 * through to a JSONB column. Uses next/headers cookies(), matching every
 * other cookie read in this codebase (e.g. guest-session.js) rather than
 * reading off the request object directly.
 */
export async function readAttributionCookie() {
  try {
    const store = await cookies();
    const raw = store.get(COOKIE_NAME)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== "object") return null;

    const clean = {};
    for (const key of ALLOWED_KEYS) {
      const value = parsed[key];
      if (typeof value === "string" && value.length > 0) {
        clean[key] = value.slice(0, 300);
      }
    }
    return Object.keys(clean).length ? clean : null;
  } catch {
    return null;
  }
}
