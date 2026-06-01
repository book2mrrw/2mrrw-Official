import { getPublicCdnBase, R2_PUBLIC_CDN_FALLBACK } from "@/lib/storage/r2-public-cdn";

/** Domains touched on tap→audible (preview CDN + same-origin API proxy). No signed URL hosts. */
export function getPlaybackPreconnectOrigins() {
  /** @type {string[]} */
  const origins = [];
  const seen = new Set();

  const add = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return;
    try {
      const url = new URL(raw.startsWith("http") ? raw : `https://${raw.replace(/^\/\//, "")}`);
      const origin = url.origin;
      if (!seen.has(origin)) {
        seen.add(origin);
        origins.push(origin);
      }
    } catch {
      /* ignore invalid URLs */
    }
  };

  add(getPublicCdnBase() || R2_PUBLIC_CDN_FALLBACK);

  return origins;
}

/** Expected TLS+TCP setup saved when preconnect runs before first play fetch (typical mobile). */
export const PRECONNECT_SETUP_SAVINGS_MS = { low: 40, typical: 80, high: 150 };
