import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getPublicCdnBase, warnPublicCdnEnvMismatch } from "@/lib/storage/r2-public-cdn";

export const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY,
  },
});

export const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME;

/** Former Supabase bucket names → R2 key prefixes inside the unified bucket. */
export const R2_PREFIX = {
  DIGITAL_ASSETS: "digital-assets",
  PROTECTED_MEDIA: "protected-media",
};

/**
 * Build a full R2 object key: `{prefix}/{path}` (no leading slashes on path).
 * @param {string} prefix - e.g. `digital-assets` or `protected-media`
 * @param {string} path - object path without bucket prefix
 */
export function buildR2Key(prefix, path) {
  const normalizedPrefix = String(prefix || "").replace(/\/$/, "");
  const normalizedPath = String(path || "").replace(/^\//, "");
  if (!normalizedPath) return normalizedPrefix;
  return `${normalizedPrefix}/${normalizedPath}`;
}

/**
 * Public CDN URL for objects under public prefixes (previews/, artwork/, etc.).
 * @param {string} path - path relative to public CDN root (no leading slash)
 */
let warnedMissingR2PublicUrl = false;

export function getPublicR2Url(path) {
  const base = getPublicCdnBase();
  if (!process.env.NEXT_PUBLIC_R2_PUBLIC_URL) {
    if (!warnedMissingR2PublicUrl) {
      warnedMissingR2PublicUrl = true;
      console.warn(
        "[2MRRW Storefront] NEXT_PUBLIC_R2_PUBLIC_URL is not set — using documented public CDN fallback for catalog media."
      );
    }
  } else {
    warnPublicCdnEnvMismatch();
  }
  const normalized = String(path || "").replace(/^\//, "");
  if (!normalized) return base;
  return `${base}/${normalized}`;
}

export async function createR2SignedGetUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2Client, command, { expiresIn });
}

export async function createR2SignedPutUrl(key, contentType, expiresIn = 300) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

/** Dev mock when R2 credentials are absent (replaces signed.local). */
export function r2MockSignedUrl(key) {
  const endpoint = (process.env.CLOUDFLARE_R2_ENDPOINT || "https://r2.local").replace(/\/$/, "");
  const bucket = R2_BUCKET || "2mrrw-media";
  return `${endpoint}/${bucket}/${key}`;
}

export async function checkR2Connectivity() {
  if (!R2_BUCKET || !process.env.CLOUDFLARE_R2_ENDPOINT) {
    return { ok: false, message: "R2 env not configured" };
  }
  try {
    await r2Client.send(new HeadBucketCommand({ Bucket: R2_BUCKET }));
    return { ok: true, bucket: R2_BUCKET };
  } catch (err) {
    return { ok: false, message: err?.message || "R2 HeadBucket failed" };
  }
}
