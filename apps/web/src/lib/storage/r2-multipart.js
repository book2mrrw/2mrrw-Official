/**
 * R2 multipart upload — for masters too large for a single presigned PUT
 * (multi-GB/multi-hour Audio Visual sources). Mirrors the existing
 * single-part presigned-URL posture in r2.js: the browser uploads part
 * bytes directly to R2, credentials never reach the client, nothing is
 * proxied through Vercel.
 *
 * Flow: createMultipartUpload → (per part) getMultipartPartUploadUrl, browser
 * PUTs the part directly and keeps the returned ETag → completeMultipartUpload
 * with the full part list. abortMultipartUpload on cancel/failure.
 * cleanupStaleMultipartUploads is a periodic sweep for uploads abandoned
 * mid-flight (browser closed, network died) that were never completed or
 * aborted.
 */
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Client, R2_BUCKET } from "@/lib/storage/r2";

const DEFAULT_PART_URL_EXPIRES_IN = 3600; // 1h — large parts over slow connections need real headroom

/** Begin a multipart upload. Returns the uploadId the browser needs for every subsequent part/complete/abort call. */
export async function createMultipartUpload(key, contentType) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!R2_BUCKET || !normalized) throw new Error("createMultipartUpload: missing bucket or key");
  const result = await r2Client.send(
    new CreateMultipartUploadCommand({
      Bucket: R2_BUCKET,
      Key: normalized,
      ContentType: contentType,
    })
  );
  return { uploadId: result.UploadId, key: normalized };
}

/** Presigned URL for one part — the browser PUTs raw bytes here directly, never through this server. */
export async function getMultipartPartUploadUrl(key, uploadId, partNumber, expiresIn = DEFAULT_PART_URL_EXPIRES_IN) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!R2_BUCKET || !normalized || !uploadId) throw new Error("getMultipartPartUploadUrl: missing bucket, key, or uploadId");
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    throw new Error("getMultipartPartUploadUrl: partNumber must be an integer between 1 and 10000");
  }
  const command = new UploadPartCommand({
    Bucket: R2_BUCKET,
    Key: normalized,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

/**
 * Finalize the upload. `parts` must be every uploaded part's
 * `{ partNumber, etag }` (the ETag the browser received back from each part
 * PUT response header), in ascending partNumber order.
 */
export async function completeMultipartUpload(key, uploadId, parts) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!R2_BUCKET || !normalized || !uploadId) throw new Error("completeMultipartUpload: missing bucket, key, or uploadId");
  if (!Array.isArray(parts) || parts.length === 0) throw new Error("completeMultipartUpload: parts must be a non-empty array");

  const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);

  const result = await r2Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: R2_BUCKET,
      Key: normalized,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: sortedParts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
      },
    })
  );
  return { key: normalized, etag: result.ETag || null, location: result.Location || null };
}

/** Cancel an in-progress upload — releases any already-uploaded part bytes on R2's side. Non-throwing if already gone. */
export async function abortMultipartUpload(key, uploadId) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!R2_BUCKET || !normalized || !uploadId) return;
  try {
    await r2Client.send(
      new AbortMultipartUploadCommand({ Bucket: R2_BUCKET, Key: normalized, UploadId: uploadId })
    );
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    // Already aborted/completed/nonexistent — nothing left to clean up.
    if (status === 404 || err?.name === "NoSuchUpload") return;
    throw err;
  }
}

/**
 * List in-progress multipart uploads under `prefix` older than
 * `olderThanMs` — candidates for the stale-cleanup cron. Never aborts
 * anything itself; call abortMultipartUpload per result if the caller
 * decides to clean up.
 */
export async function listStaleMultipartUploads(prefix, olderThanMs) {
  const normalized = String(prefix || "").replace(/^\//, "");
  if (!R2_BUCKET) return [];
  const cutoff = Date.now() - olderThanMs;

  const stale = [];
  let keyMarker;
  let uploadIdMarker;

  do {
    const response = await r2Client.send(
      new ListMultipartUploadsCommand({
        Bucket: R2_BUCKET,
        Prefix: normalized || undefined,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadIdMarker,
      })
    );
    for (const upload of response.Uploads || []) {
      const initiated = upload.Initiated ? new Date(upload.Initiated).getTime() : 0;
      if (initiated && initiated < cutoff) {
        stale.push({ key: upload.Key, uploadId: upload.UploadId, initiated: upload.Initiated });
      }
    }
    keyMarker = response.IsTruncated ? response.NextKeyMarker : undefined;
    uploadIdMarker = response.IsTruncated ? response.NextUploadIdMarker : undefined;
  } while (keyMarker);

  return stale;
}

/** Convenience wrapper: find and abort every stale upload under `prefix` in one call. Returns the list it cleaned up. */
export async function cleanupStaleMultipartUploads(prefix, olderThanMs) {
  const stale = await listStaleMultipartUploads(prefix, olderThanMs);
  for (const { key, uploadId } of stale) {
    await abortMultipartUpload(key, uploadId);
  }
  return stale;
}
