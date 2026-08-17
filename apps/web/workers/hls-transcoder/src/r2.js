/**
 * R2 client for the HLS transcoder worker.
 * Downloads source audio and uploads encrypted HLS segments.
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
} = process.env;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME are required");
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

/**
 * Download an R2 object and return a Node.js Readable stream.
 * The transcoder pipes this directly into FFmpeg's stdin.
 */
export async function downloadStream(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
  // res.Body is an AWS SDK ChecksumStream which extends Node.js Readable — return directly.
  return res.Body;
}

/**
 * Upload a Buffer or Readable stream to R2.
 * Used for init.mp4, seg_XXXXX.m4s, AES key files, and poster JPEGs.
 */
export async function upload(key, body, contentType = "application/octet-stream", extra = {}) {
  await s3.send(
    new PutObjectCommand({
      Bucket:      R2_BUCKET_NAME,
      Key:         key,
      Body:        body,
      ContentType: contentType,
      ...extra,
    })
  );
}

/**
 * Download the first maxBytes of an R2 object as a Buffer.
 * Used by poster extraction to avoid fetching full multi-GB video files.
 */
export async function downloadPartialBuffer(key, maxBytes) {
  const res = await s3.send(new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key:    key,
    Range:  `bytes=0-${maxBytes - 1}`,
  }));
  const chunks = [];
  for await (const chunk of res.Body) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}
