#!/usr/bin/env node
/**
 * Phase 5.3.3B — Canonical R2 path remediation (copy+verify+delete).
 * Aligns mismatched master folders with catalog storage_path slugs.
 *
 * Usage:
 *   node scripts/phase533b-remediate-r2-paths.mjs --dry-run
 *   node scripts/phase533b-remediate-r2-paths.mjs --yes
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const { values: cli } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (cli.help) {
  console.log(`Usage: node scripts/phase533b-remediate-r2-paths.mjs [--dry-run] [--yes]`);
  process.exit(0);
}

function loadDotenvLocal() {
  const envPath = resolve(ROOT, ".env.local");
  if (!existsSync(envPath)) {
    console.error("[remediate] Missing .env.local");
    process.exit(1);
  }
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

loadDotenvLocal();

const BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const endpoint = (process.env.CLOUDFLARE_R2_ENDPOINT || "").replace(/\/$/, "");
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

if (!BUCKET || !endpoint || !accessKeyId || !secretAccessKey) {
  console.error("[remediate] Missing R2 credentials in .env.local");
  process.exit(1);
}

const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

/** Category A — simple folder renames (fromPrefix → toPrefix, relative to digital-assets/mixtapes-and-eps/) */
const CATEGORY_A = [
  {
    track: "ad/03-said-n-done",
    from: "digital-assets/mixtapes-and-eps/ad/03-said-n-done ",
    to: "digital-assets/mixtapes-and-eps/ad/03-said-n-done",
    category: "A",
    reason: "R2_SLUG_TRAILING_SPACE",
  },
  {
    track: "ad/04-a-d-d",
    from: "digital-assets/mixtapes-and-eps/ad/04-a.d.d",
    to: "digital-assets/mixtapes-and-eps/ad/04-a-d-d",
    category: "A",
    reason: "R2_SLUG_PUNCTUATION",
  },
  {
    track: "ad/08-life-changes-ft-gwendolyn",
    from: "digital-assets/mixtapes-and-eps/ad/08-life-changes ft. gwendolyn",
    to: "digital-assets/mixtapes-and-eps/ad/08-life-changes-ft-gwendolyn",
    category: "A",
    reason: "R2_SLUG_SPACES_NOT_HYPHENS",
  },
  {
    track: "love-hz-vol-1/02-w-2-d",
    from: "digital-assets/mixtapes-and-eps/love-hz-vol-1/02-w2d",
    to: "digital-assets/mixtapes-and-eps/love-hz-vol-1/02-w-2-d",
    category: "A",
    reason: "R2_SLUG_COMPACT",
  },
  {
    track: "tbh/03-unxpcted",
    from: "digital-assets/mixtapes-and-eps/tbh/03-unxpected",
    to: "digital-assets/mixtapes-and-eps/tbh/03-unxpcted",
    category: "A",
    reason: "R2_SLUG_SPELLING",
  },
  {
    track: "tbh/08-2late",
    from: "digital-assets/mixtapes-and-eps/tbh/08-2late?",
    to: "digital-assets/mixtapes-and-eps/tbh/08-2late",
    category: "A",
    reason: "R2_SLUG_PUNCTUATION",
  },
];

/** Category C — love-hz track number realignment (via staging to avoid collisions) */
const STAGING = "digital-assets/.tmp-phase533b-staging";
const CATEGORY_C = [
  {
    track: "love-hz-vol-1/07-stayed-2-long",
    from: "digital-assets/mixtapes-and-eps/love-hz-vol-1/09-stayed-2-long",
    to: "digital-assets/mixtapes-and-eps/love-hz-vol-1/07-stayed-2-long",
    category: "C",
    reason: "R2_TRACK_NUMBER_DRIFT",
  },
  {
    track: "love-hz-vol-1/08-knock-on-wood",
    from: "digital-assets/mixtapes-and-eps/love-hz-vol-1/07-knock-on-wood",
    to: "digital-assets/mixtapes-and-eps/love-hz-vol-1/08-knock-on-wood",
    category: "C",
    reason: "R2_TRACK_NUMBER_DRIFT",
  },
  {
    track: "love-hz-vol-1/09-hour-glass",
    from: "digital-assets/mixtapes-and-eps/love-hz-vol-1/08-hour-glass",
    to: "digital-assets/mixtapes-and-eps/love-hz-vol-1/09-hour-glass",
    category: "C",
    reason: "R2_TRACK_NUMBER_DRIFT",
  },
];

function encodeCopySource(bucket, key) {
  return `${bucket}/${encodeURIComponent(key).replace(/%2F/g, "/")}`;
}

function folderPrefix(prefix) {
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

async function listAllKeys(prefix) {
  const listPrefix = folderPrefix(prefix);
  const keys = [];
  let continuationToken;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: listPrefix,
        ContinuationToken: continuationToken,
      })
    );
    for (const item of response.Contents || []) {
      if (item?.Key && !item.Key.endsWith("/")) keys.push(item.Key);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function headSize(key) {
  const out = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  return out.ContentLength ?? 0;
}

async function moveFolder(fromPrefix, toPrefix, dryRun) {
  const from = folderPrefix(fromPrefix).replace(/\/$/, "");
  const to = folderPrefix(toPrefix).replace(/\/$/, "");
  const keys = await listAllKeys(from);
  const moves = keys.map((key) => {
    const filename = key.slice(folderPrefix(from).length);
    return { fromKey: key, toKey: `${to}/${filename}` };
  });

  if (moves.length === 0) {
    return { ok: false, error: "source_empty", moves: [] };
  }

  if (dryRun) {
    return { ok: true, dryRun: true, moves };
  }

  const results = [];
  for (const { fromKey, toKey } of moves) {
    const srcSize = await headSize(fromKey);
    await client.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        Key: toKey,
        CopySource: encodeCopySource(BUCKET, fromKey),
      })
    );
    const destSize = await headSize(toKey);
    if (destSize !== srcSize) {
      return { ok: false, error: `size_mismatch ${fromKey}`, moves: results };
    }
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: fromKey }));
    results.push({ fromKey, toKey, bytes: srcSize });
  }
  return { ok: true, moves: results };
}

async function remediateCategoryC(dryRun) {
  const stagingMoves = [];
  /** @type {Array<{ track: string, stage: string, result: object }>} */
  const log = [];

  // Stage 1: move all sources to staging
  for (const item of CATEGORY_C) {
    const stagePrefix = `${STAGING}/${item.track.replace("/", "--")}`;
    const result = await moveFolder(item.from, stagePrefix, dryRun);
    log.push({ track: item.track, phase: "stage", from: item.from, to: stagePrefix, result });
    if (!result.ok && !dryRun) return { ok: false, log };
    stagingMoves.push({ ...item, stagePrefix });
  }

  // Stage 2: move from staging to canonical
  for (const item of stagingMoves) {
    const result = await moveFolder(item.stagePrefix, item.to, dryRun);
    log.push({ track: item.track, phase: "finalize", from: item.stagePrefix, to: item.to, result });
    if (!result.ok && !dryRun) return { ok: false, log };
  }

  return { ok: true, log };
}

async function main() {
  const dryRun = cli["dry-run"] || !cli.yes;
  if (!cli.yes && !cli["dry-run"]) {
    console.error("[remediate] Pass --yes to execute or --dry-run to preview.");
    process.exit(1);
  }

  console.log(`[remediate] Phase 5.3.3B R2 path remediation (bucket=${BUCKET}, dryRun=${dryRun})`);

  /** @type {Array<object>} */
  const report = [];

  for (const item of CATEGORY_A) {
    console.log(`[A] ${item.track}: ${item.from} → ${item.to}`);
    const result = await moveFolder(item.from, item.to, dryRun);
    report.push({ ...item, result });
    if (!result.ok) {
      console.error(`  FAIL: ${result.error}`);
    } else {
      console.log(`  OK: ${result.moves?.length || 0} object(s)`);
    }
  }

  console.log("[C] love-hz-vol-1 track number realignment (via staging)...");
  const cResult = await remediateCategoryC(dryRun);
  for (const entry of cResult.log || []) {
    report.push({
      track: entry.track,
      category: "C",
      phase: entry.phase,
      from: entry.from,
      to: entry.to,
      result: entry.result,
    });
    const status = entry.result?.ok ? "OK" : "FAIL";
    console.log(`  [${status}] ${entry.track} (${entry.phase}): ${entry.result?.moves?.length || 0} object(s)`);
  }

  const outPath = resolve(ROOT, ".tmp-phase533b-remediation-targeted-backfill-20260530/remediation-log.json");
  writeFileSync(outPath, `${JSON.stringify({ dryRun, report, categoryC: cResult }, null, 2)}\n`);

  const failed = report.filter((r) => r.result && !r.result.ok);
  console.log(`[remediate] done: ${report.length} operations, ${failed.length} failed`);
  console.log(`[remediate] log: ${outPath}`);

  if (failed.length > 0 && !dryRun) process.exit(1);
}

main().catch((err) => {
  console.error("[remediate] fatal:", err);
  process.exit(1);
});
