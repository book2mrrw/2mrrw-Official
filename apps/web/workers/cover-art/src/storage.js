/**
 * The media bucket (R2). The lane reads original cover videos and writes its
 * renditions under cover-art/ — it never writes anywhere else.
 */

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";

export const RENDITION_PREFIX = "cover-art/";

let client = null;
function s3() {
  if (client) return client;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME are required");
  }
  client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return client;
}

const bucket = () => process.env.R2_BUCKET_NAME;
const cleanEtag = (etag) => String(etag || "").replace(/"/g, "");

/**
 * Where a rendition lives: under cover-art/, mirroring the original's folder
 * (videos/singles/w2d/w2d.mp4 -> cover-art/singles/w2d/<version>/square-720.mp4).
 */
export function renditionKey(sourceKey, sourceEtag, renditionId) {
  const folder = sourceKey.replace(/^videos\//, "").split("/").slice(0, -1).join("/");
  const version = cleanEtag(sourceEtag).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "v";
  return `${RENDITION_PREFIX}${folder ? `${folder}/` : ""}${version}/${renditionId}.mp4`;
}

/** The original's current ETag (null when it no longer exists). */
export async function sourceEtag(key) {
  try {
    const head = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return cleanEtag(head.ETag);
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return null;
    throw error;
  }
}

/** Download an original to `file`; returns its ETag. */
export async function download(key, file) {
  const object = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  await pipeline(object.Body, createWriteStream(file));
  return cleanEtag(object.ETag);
}

/** Upload a rendition: immutable (a new cover version gets new keys). */
export async function upload(key, file) {
  if (!key.startsWith(RENDITION_PREFIX)) throw new Error(`refusing to write outside ${RENDITION_PREFIX}: ${key}`);
  const bytes = statSync(file).size;
  await s3().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    Body: createReadStream(file),
    ContentLength: bytes,
    ContentType: "video/mp4",
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return bytes;
}
