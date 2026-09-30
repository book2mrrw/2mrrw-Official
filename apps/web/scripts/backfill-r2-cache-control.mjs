#!/usr/bin/env node
/**
 * Stamp Cache-Control onto R2 objects that were written before the policy
 * existed.
 *
 * Every catalog object uploaded before 2026-09-27 carries no Cache-Control at
 * all, so it is re-downloaded by every visitor on every visit. This repairs
 * them in place: a server-side COPY onto the same key with MetadataDirective
 * REPLACE, which rewrites metadata WITHOUT transferring the bytes. Re-stamping
 * a 2.6 MB motion cover moves no video data.
 *
 * Safe to re-run: stamping an already-stamped object is a no-op in effect.
 * Only prefixes in src/lib/storage/r2-cache-policy.js are touched — that is an
 * allow-list, and digital-assets/ (paid masters, signed-URL only) is
 * explicitly excluded there. This script never widens it.
 *
 * Usage:
 *   node scripts/backfill-r2-cache-control.mjs --dry-run      # report only
 *   node scripts/backfill-r2-cache-control.mjs                # apply
 *   node scripts/backfill-r2-cache-control.mjs --prefix images/
 *
 * Requires CLOUDFLARE_R2_* in .env.local (or the environment).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CopyObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    const val = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key] && val) process.env[key] = val;
  }
}
loadEnvLocal();

// Mirrors src/lib/storage/r2-cache-policy.js. Kept in sync by
// src/lib/storage/__tests__/r2-cache-policy.test.js, because this script runs
// as plain Node with no "@/" alias available.
const PUBLIC_CATALOG_MEDIA = "public, max-age=86400";
const POLICY = [
  { prefix: "images/", cacheControl: PUBLIC_CATALOG_MEDIA },
  { prefix: "videos/", cacheControl: PUBLIC_CATALOG_MEDIA },
  { prefix: "previews/", cacheControl: PUBLIC_CATALOG_MEDIA },
  // Audio Visualz DISPLAY ART ONLY — never the master alongside it.
  {
    pattern: /^2MRRW Studios\/[^/]+\/(?:.+\/)?(?:poster|motion-cover)\.[a-z0-9]+$/i,
    cacheControl: PUBLIC_CATALOG_MEDIA,
  },
];
const NEVER_PUBLIC = ["digital-assets/", "videos/vault/"];
const AV_MASTER_RE = /^2MRRW Studios\/.*\/master-\d+\.[a-z0-9]+$/i;

// Listed, but not necessarily stamped: "2MRRW Studios/" is scanned so its
// display art is reachable, while every master inside it is still refused.
const SCAN_PREFIXES = ["images/", "videos/", "previews/", "2MRRW Studios/"];

function cacheControlForKey(key) {
  const k = String(key || "").replace(/^\/+/, "");
  if (!k || k.endsWith("/")) return null;               // folder marker
  if (NEVER_PUBLIC.some((p) => k.startsWith(p))) return null;
  if (AV_MASTER_RE.test(k)) return null;
  const rule = POLICY.find((r) => (r.prefix ? k.startsWith(r.prefix) : r.pattern.test(k)));
  return rule?.cacheControl ?? null;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const prefixArg = args.includes("--prefix") ? args[args.indexOf("--prefix") + 1] : null;
const prefixes = prefixArg ? [prefixArg] : SCAN_PREFIXES;

const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
  console.error("backfill-r2-cache-control: CLOUDFLARE_R2_* not configured — set them in .env.local");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

async function listAll(prefix) {
  const keys = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const o of res.Contents || []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

let scanned = 0, alreadyOk = 0, stamped = 0, skipped = 0, failed = 0;
const failures = [];

for (const prefix of prefixes) {
  const keys = await listAll(prefix);
  console.log(`\n${prefix}  —  ${keys.length} object(s)`);

  for (const key of keys) {
    scanned += 1;
    const desired = cacheControlForKey(key);
    if (!desired) { skipped += 1; continue; }

    let current = null;
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      current = head.CacheControl || null;
    } catch (err) {
      failed += 1; failures.push(`${key}: HEAD failed — ${err?.message}`);
      continue;
    }

    if (current === desired) { alreadyOk += 1; continue; }

    if (dryRun) {
      console.log(`  would stamp  ${key}  (${current || "no cache-control"} -> ${desired})`);
      stamped += 1;
      continue;
    }

    try {
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
        Key: key,
        CacheControl: desired,
        ContentType: (await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentType,
        MetadataDirective: "REPLACE",
      }));
      stamped += 1;
      console.log(`  stamped      ${key}`);
    } catch (err) {
      failed += 1; failures.push(`${key}: COPY failed — ${err?.message}`);
    }
  }
}

console.log(`\n${dryRun ? "DRY RUN — nothing changed" : "APPLIED"}`);
console.log(`  scanned:     ${scanned}`);
console.log(`  stamped:     ${stamped}`);
console.log(`  already ok:  ${alreadyOk}`);
console.log(`  skipped:     ${skipped}  (prefix not in the public policy)`);
console.log(`  failed:      ${failed}`);
for (const f of failures) console.error(`    ${f}`);
process.exit(failed > 0 ? 1 : 0);
