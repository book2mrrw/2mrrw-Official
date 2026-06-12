/**
 * Phase 5.2 Stage 3 — R2 object download/upload helpers for stream pipeline.
 */

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/storage/r2";
import { STREAM_CONTAINER_FORMAT } from "@/lib/media/stream-asset-schema";

/**
 * @param {string} key — full R2 object key
 * @returns {Promise<Buffer>}
 */
export async function downloadR2ObjectToBuffer(key) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!R2_BUCKET || !normalized) {
    throw new Error("R2 bucket or object key missing");
  }

  const response = await r2Client.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: normalized,
    })
  );

  const bytes = await response.Body?.transformToByteArray();
  if (!bytes?.length) {
    throw new Error(`R2 object empty or unreadable: ${normalized}`);
  }
  return Buffer.from(bytes);
}

/**
 * @param {string} key — full R2 object key
 * @param {Buffer | Uint8Array} body
 * @param {string} [contentType]
 */
export async function uploadR2ObjectBuffer(key, body, contentType) {
  const normalized = String(key || "").replace(/^\//, "");
  if (!R2_BUCKET || !normalized) {
    throw new Error("R2 bucket or object key missing");
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: normalized,
      Body: body,
      ContentType: contentType || "audio/mp4",
    })
  );
}

/** MIME type for AAC-LC in MP4 container (.m4a). */
export function streamObjectContentType() {
  return STREAM_CONTAINER_FORMAT === "m4a" ? "audio/mp4" : `audio/${STREAM_CONTAINER_FORMAT}`;
}
