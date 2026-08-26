import { createHash } from "node:crypto";
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const bucket = process.env.R2_BUCKET_NAME || process.env.BUCKET_NAME;
const endpoint = process.env.AWS_ENDPOINT_URL_S3 ||
  (process.env.R2_ACCOUNT_ID
    ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : "");
const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
const targetPrefix = (process.env.F0_R2_RESTORE_PREFIX || "").replace(/^\/+|\/+$/g, "");

if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  throw new Error("R2 certification credentials are incomplete");
}
if (!/^f0-restore\/[0-9]{8}t[0-9]{6}z-[a-z0-9-]+$/i.test(targetPrefix)) {
  throw new Error("F0_R2_RESTORE_PREFIX must be a unique f0-restore/<UTC>-<suffix> prefix");
}

const client = new S3Client({
  region: process.env.AWS_REGION || "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

async function listAll(prefix = "") {
  const objects = [];
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    objects.push(...(page.Contents || []));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return objects;
}

function objectClass(key) {
  const lower = key.toLowerCase();
  if (lower.endsWith(".m3u8")) return "hls_manifest";
  if (/\.(m4s|ts)$/.test(lower)) return "hls_segment";
  if (/\.(wav|flac|aiff|aif)$/.test(lower)) return "original_audio";
  if (/\.(mp3|m4a|aac|ogg|opus)$/.test(lower)) return "progressive_audio";
  if (/\.(jpg|jpeg|png|webp|avif)$/.test(lower)) return "cover_art";
  if (/\.(mp4|mov|webm)$/.test(lower)) return "video";
  return "other";
}

function identity(key) {
  return createHash("sha256").update(key).digest("hex").slice(0, 20);
}

async function bytesAndHash(key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  const hash = createHash("sha256");
  let length = 0;
  for await (const chunk of response.Body) {
    const buffer = Buffer.from(chunk);
    chunks.push(buffer);
    hash.update(buffer);
    length += buffer.length;
  }
  return { bytes: Buffer.concat(chunks), sha256: hash.digest("hex"), length };
}

async function restoreAndVerify(sourceKey, objectClassName) {
  const targetKey = `${targetPrefix}/${sourceKey}`;
  const source = await bytesAndHash(sourceKey);
  await client.send(new CopyObjectCommand({
    Bucket: bucket,
    Key: targetKey,
    CopySource: `${bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`,
    MetadataDirective: "COPY",
  }));
  const target = await bytesAndHash(targetKey);
  const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: targetKey }));
  if (source.sha256 !== target.sha256 || source.length !== target.length) {
    throw new Error(`restored bytes mismatch for ${identity(sourceKey)}`);
  }
  return {
    class: objectClassName,
    sourceIdentity: identity(sourceKey),
    targetIdentity: identity(targetKey),
    bytes: source.length,
    sha256: source.sha256,
    targetEtag: String(head.ETag || "").replaceAll('"', ""),
    verified: true,
  };
}

const inventory = (await listAll()).filter((item) =>
  item.Key && !item.Key.startsWith("f0-restore/") && Number(item.Size || 0) > 0
);
const byClass = new Map();
for (const item of inventory) {
  const type = objectClass(item.Key);
  if (!byClass.has(type)) byClass.set(type, []);
  byClass.get(type).push(item);
}
for (const items of byClass.values()) items.sort((a, b) => Number(a.Size) - Number(b.Size));

const requiredClasses = ["original_audio", "progressive_audio", "cover_art", "video"];
const restored = [];
for (const type of requiredClasses) {
  const sample = byClass.get(type)?.[0];
  if (sample) restored.push(await restoreAndVerify(sample.Key, type));
}

let hls = { present: false, references: 0, restoredReferences: 0, verified: false };
const manifestItem = byClass.get("hls_manifest")?.[0];
if (manifestItem) {
  const manifestSource = await bytesAndHash(manifestItem.Key);
  const manifestText = manifestSource.bytes.toString("utf8");
  const base = manifestItem.Key.includes("/")
    ? manifestItem.Key.slice(0, manifestItem.Key.lastIndexOf("/") + 1)
    : "";
  const references = [...new Set(manifestText.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^https?:\/\//i.test(line))
    .map((line) => `${base}${line}`))];
  const known = new Set(inventory.map((item) => item.Key));
  const missing = references.filter((key) => !known.has(key));
  if (missing.length) throw new Error(`HLS manifest has ${missing.length} unresolved source references`);
  restored.push(await restoreAndVerify(manifestItem.Key, "hls_manifest"));
  for (const key of references) restored.push(await restoreAndVerify(key, objectClass(key)));
  hls = {
    present: true,
    manifestIdentity: identity(manifestItem.Key),
    references: references.length,
    restoredReferences: references.length,
    verified: true,
  };
}

const classInventory = {};
for (const [type, items] of byClass) {
  classInventory[type] = {
    count: items.length,
    bytes: items.reduce((sum, item) => sum + Number(item.Size || 0), 0),
  };
}

console.log(JSON.stringify({
  certification: "F0_R2_ISOLATED_PREFIX_RESTORE",
  completedAt: new Date().toISOString(),
  targetPrefix,
  sourceObjectCount: inventory.length,
  inventory: classInventory,
  restored,
  hls,
  verdict: restored.length > 0 && (!hls.present || hls.verified) ? "PASS" : "FAIL",
}, null, 2));
