import { getPublicCdnBase, R2_PUBLIC_CDN_FALLBACK } from "@/lib/storage/r2-public-cdn";

/**
 * Derive the virtual-hosted S3 origin for signed R2 URLs.
 * CLOUDFLARE_R2_ENDPOINT = https://{accountId}.r2.cloudflarestorage.com
 * Signed URL host        = https://{bucket}.{accountId}.r2.cloudflarestorage.com
 */
function getR2SignedUrlOrigin() {
  const endpoint = (process.env.CLOUDFLARE_R2_ENDPOINT || "").replace(/\/$/, "");
  const bucket = (process.env.CLOUDFLARE_R2_BUCKET_NAME || "").trim();
  if (!endpoint || !bucket) return null;
  try {
    const { protocol, host } = new URL(endpoint);
    return `${protocol}//${bucket}.${host}`;
  } catch {
    return null;
  }
}

/** Domains touched on tap→audible: public CDN, signed R2 stream host, same-origin API proxy. */
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
  add(getR2SignedUrlOrigin());

  return origins;
}

/** Expected TLS+TCP setup saved when preconnect runs before first play fetch (typical mobile). */
export const PRECONNECT_SETUP_SAVINGS_MS = { low: 40, typical: 80, high: 150 };
