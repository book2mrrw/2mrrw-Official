#!/usr/bin/env node
/**
 * One-time R2 bucket migration: 2mrrrw-media → 2mrrw-media (same keys).
 * Copy + verify all keys before deleting any from source.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "node:process";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const SOURCE_BUCKET = "2mrrrw-media";
const DEST_BUCKET = "2mrrw-media";

const KEYS = [
  "digital-assets/singles/hour-glass/audio.mp3",
  "digital-assets/singles/w2d/audio.mp3",
  "digital-assets/singles/artificial/audio.mp3",
  "digital-assets/singles/turnt-me-2-dis/audio.mp3",
  "digital-assets/features/2-heavy/audio.wav",
  "digital-assets/features/i-dont-believe-you/audio.wav",
  "previews/features/2-heavy/2-heavy-preview.wav",
  "previews/features/i-dont-believe-you/i-dont-believe-you-preview.wav",
  "previews/hourglass-preview.mp3",
  "previews/w2d-preview.mp3",
  "previews/artificial-preview.mp3",
  "previews/turntme2dis-preview.mp3",
  "previews/2-heavy-preview.wav",
  "previews/i-dont-believe-you-preview.wav",
  "images/singles/hourglass.jpg",
  "images/singles/w2d.jpg",
  "images/singles/artificial.jpg",
  "images/singles/turnt.jpg",
  "images/albums/tbh.jpg",
  "images/albums/ad.jpg",
  "images/albums/lovehz.jpg",
  "images/features/2heavy.jpg",
  "images/features/idbu.jpg",
  "videos/A2B.mp4",
  "videos/singles/hourglass.mp4",
  "videos/singles/artificial.mp4",
  "videos/singles/w2d.mp4",
  "videos/singles/turntme2dis.mp4",
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Load .env.local (dotenv-compatible; does not use CLOUDFLARE_R2_BUCKET_NAME for routing). */
function loadDotenvLocal() {
  const envPath = resolve(ROOT, ".env.local");
  try {
    loadEnvFile(envPath);
  } catch (err) {
    if (err?.code === "ENOENT") {
      console.error("Missing .env.local at", envPath);
      process.exit(1);
    }
    throw err;
  }
}

/** S3 API base URL — never bucket-scoped; not derived from CLOUDFLARE_R2_BUCKET_NAME. */
function resolveR2Endpoint() {
  const explicit = (process.env.CLOUDFLARE_R2_ENDPOINT || "").trim();
  if (/^https?:\/\//i.test(explicit)) {
    return explicit.replace(/\/$/, "");
  }
  const accountId = (process.env.CLOUDFLARE_R2_ACCOUNT_ID || "").trim();
  if (accountId) {
    return `https://${accountId}.r2.cloudflarestorage.com`;
  }
  return null;
}

function encodeCopySource(bucket, key) {
  return `${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

async function headSize(client, bucket, key) {
  try {
    const out = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    );
    const size = out.ContentLength;
    if (size == null || size < 0) return { ok: false, error: "missing ContentLength" };
    return { ok: true, size };
  } catch (err) {
    const code = err?.name || err?.Code || err?.code;
    if (code === "NotFound" || code === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return { ok: false, error: "not found" };
    }
    const status = err?.$metadata?.httpStatusCode;
    if (status === 403) return { ok: false, error: "forbidden (check R2 token bucket scope)" };
    return { ok: false, error: err?.message || String(err) };
  }
}

async function main() {
  loadDotenvLocal();

  const endpoint = resolveR2Endpoint();
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error(
      "Missing R2 config in .env.local: need CLOUDFLARE_R2_ACCESS_KEY_ID, CLOUDFLARE_R2_SECRET_ACCESS_KEY, and CLOUDFLARE_R2_ENDPOINT or CLOUDFLARE_R2_ACCOUNT_ID"
    );
    process.exit(1);
  }

  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.error(`R2 endpoint: ${endpoint}`);
  console.error(`Migration: ${SOURCE_BUCKET} → ${DEST_BUCKET}`);

  const results = [];

  for (const key of KEYS) {
    const row = { key, copy: "—", verify: "—", delete: "—", error: "" };

    const srcHead = await headSize(client, SOURCE_BUCKET, key);
    if (!srcHead.ok) {
      row.copy = "fail";
      row.verify = "—";
      row.error = srcHead.error === "not found" ? "source empty" : `source head: ${srcHead.error}`;
      results.push(row);
      continue;
    }

    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: DEST_BUCKET,
          Key: key,
          CopySource: encodeCopySource(SOURCE_BUCKET, key),
        })
      );
      row.copy = "ok";
    } catch (err) {
      row.copy = "fail";
      row.error = `copy: ${err?.message || String(err)}`;
      results.push(row);
      continue;
    }

    const destHead = await headSize(client, DEST_BUCKET, key);
    if (!destHead.ok) {
      row.verify = "fail";
      row.error = `dest head: ${destHead.error}`;
      results.push(row);
      continue;
    }
    if (destHead.size !== srcHead.size) {
      row.verify = "fail";
      row.error = `size mismatch src=${srcHead.size} dest=${destHead.size}`;
      results.push(row);
      continue;
    }

    row.verify = "ok";
    results.push(row);
  }

  const verified = results.filter((r) => r.copy === "ok" && r.verify === "ok");
  const allVerified = verified.length === KEYS.length;

  if (allVerified) {
    for (const row of results) {
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: SOURCE_BUCKET,
            Key: row.key,
          })
        );
        row.delete = "ok";
      } catch (err) {
        row.delete = "fail";
        row.error = row.error
          ? `${row.error}; delete: ${err?.message || String(err)}`
          : `delete: ${err?.message || String(err)}`;
      }
    }
  } else {
    for (const row of results) {
      if (row.copy === "ok" && row.verify === "ok") row.delete = "skipped";
      else row.delete = "—";
    }
  }

  const migrated = results.filter(
    (r) => r.copy === "ok" && r.verify === "ok" && r.delete === "ok"
  ).length;
  const failed = KEYS.length - migrated;

  console.log("\nPer-key status:");
  console.log("key\tcopy\tverify\tdelete\terror");
  for (const r of results) {
    console.log(`${r.key}\t${r.copy}\t${r.verify}\t${r.delete}\t${r.error || ""}`);
  }

  const summary = {
    migrated,
    failed,
    from: SOURCE_BUCKET,
    to: DEST_BUCKET,
    endpoint,
  };
  console.log(JSON.stringify(summary));

  if (failed > 0) {
    const failedKeys = results
      .filter((r) => !(r.copy === "ok" && r.verify === "ok" && r.delete === "ok"))
      .map((r) => r.key);
    console.error("\nFailed keys:", failedKeys.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
