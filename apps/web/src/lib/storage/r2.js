import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  ensureRelativeSiteApiPath,
  isSiteApiMediaPath,
  repairMisboundR2ApiUrl,
} from "@/lib/media/site-api-url";
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
  const raw = String(path || "").trim();
  if (!raw) {
    return getPublicCdnBase();
  }
  if (/^https?:\/\//i.test(raw)) {
    return repairMisboundR2ApiUrl(raw);
  }
  const normalized = raw.replace(/^\//, "");
  if (isSiteApiMediaPath(normalized)) {
    return ensureRelativeSiteApiPath(normalized);
  }

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

/**
 * True when `key` is a file directly under `folderPrefix` (no nested subfolders).
 * @param {string} folderPrefix - entity folder prefix (with or without trailing slash)
 * @param {string} key - full R2 object key
 */
export function isDirectChildObjectKey(folderPrefix, key) {
  const listPrefix = String(folderPrefix || "")
    .replace(/^\//, "")
    .replace(/\/?$/, "/");
  const normalizedKey = String(key || "").replace(/^\//, "");
  if (!listPrefix || !normalizedKey.startsWith(listPrefix)) return false;
  const remainder = normalizedKey.slice(listPrefix.length);
  return remainder.length > 0 && !remainder.includes("/");
}

/**
 * List R2 objects under a prefix (ListObjectsV2, paginated).
 * Default: non-recursive — direct child files only (Delimiter `/`).
 * @param {string} prefix - object key prefix (no leading slash)
 * @param {{ recursive?: boolean }} [options]
 * @returns {Promise<Array<{ Key: string, Size?: number }>>}
 */
let _r2BucketWarned = false;
export async function listR2Objects(prefix, options = {}) {
  const { recursive = false } = options;
  if (!R2_BUCKET) {
    if (!_r2BucketWarned) {
      _r2BucketWarned = true;
      console.error("[R2] CLOUDFLARE_R2_BUCKET_NAME is not set — all R2 object listing returns empty; audio discovery will fail");
    }
    return [];
  }
  const normalized = String(prefix || "").replace(/^\//, "");
  if (!normalized) return [];

  const listPrefix = normalized.endsWith("/") ? normalized : `${normalized}/`;
  const searchPrefix = recursive ? normalized : listPrefix;

  const objects = [];
  let continuationToken;

  do {
    const response = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: searchPrefix,
        ...(recursive ? {} : { Delimiter: "/" }),
        ContinuationToken: continuationToken,
      })
    );
    if (response.Contents?.length) {
      for (const item of response.Contents) {
        if (!item?.Key || item.Key.endsWith("/")) continue;
        if (recursive || isDirectChildObjectKey(listPrefix, item.Key)) {
          objects.push(item);
        }
      }
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/**
 * Discover first direct-child object under prefix matching extensions (priority order).
 * Does not scan nested subfolders (e.g. …/hour-glass/audio/master.wav).
 * @param {string} prefix - entity folder prefix (with or without trailing slash)
 * @param {string[]} extensionsInPriorityOrder - e.g. [".wav", ".flac"]
 * @returns {Promise<string | null>} full R2 object key
 */
/** True when an exact object key exists in the configured R2 bucket. */
export async function headR2ObjectKey(key) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!R2_BUCKET || !normalized) return false;
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: normalized }));
    return true;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound") return false;
    // Re-throw permission failures and server errors — these are not "file not found"
    // and masking them causes stale cache entries to serve deleted R2 objects.
    if (status === 403 || (status >= 500 && status < 600)) throw err;
    return false;
  }
}

/**
 * Server-side same-bucket copy. Used at publish time to move wizard-uploaded
 * audio from the temporary draft-slug path to the canonical slug path.
 * @param {string} sourceKey - existing R2 key
 * @param {string} destKey   - destination R2 key (must not equal sourceKey)
 */
export async function copyR2Object(sourceKey, destKey) {
  const src  = String(sourceKey || "").replace(/^\//, "");
  const dest = String(destKey   || "").replace(/^\//, "");
  if (!R2_BUCKET || !src || !dest) throw new Error("copyR2Object: missing bucket or keys");
  await r2Client.send(
    new CopyObjectCommand({
      Bucket:     R2_BUCKET,
      CopySource: `${R2_BUCKET}/${src}`,
      Key:        dest,
    })
  );
}

/**
 * Delete a single R2 object by key. Non-throwing for missing objects.
 * @param {string} key - R2 object key to delete
 */
export async function deleteR2Object(key) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!R2_BUCKET || !normalized) return;
  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: normalized }));
}

export async function discoverFileByExtensions(prefix, extensionsInPriorityOrder) {
  const normalized = String(prefix || "").replace(/^\//, "").replace(/\/$/, "");
  if (!normalized || !extensionsInPriorityOrder?.length) return null;

  const listPrefix = `${normalized}/`;
  const objects = await listR2Objects(listPrefix, { recursive: false });
  const files = objects
    .map((item) => item.Key)
    .filter((key) => key && isDirectChildObjectKey(listPrefix, key));

  for (const ext of extensionsInPriorityOrder) {
    const suffix = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    const match = files.find((key) => key.toLowerCase().endsWith(suffix));
    if (match) return match;
  }

  return null;
}
