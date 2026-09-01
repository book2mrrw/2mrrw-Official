#!/usr/bin/env node
/**
 * Phase 5.2 Stage 6 — Resumable catalog stream backfill (manual CLI only).
 *
 * Reuses Stage 3 transcode/upload pipeline. Never modifies masters in digital-assets/.
 *
 * Run:
 *   npm run backfill:stream-assets -- --dry-run
 *   npm run backfill:stream-assets -- --yes --dry-run
 *
 * Requires HYBRID_STREAMING_ENABLED=1 + AUTO_GENERATE_STREAM_ASSETS=1 in env,
 * or explicit --yes to enable flags for this run only.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { normalizeReleaseType } from "@/lib/media/utils/normalize-release-type.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_CHECKPOINT = resolve(ROOT, ".backfill-stream-checkpoint.json");

const { values: cli } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    slug: { type: "string" },
    "album-slug": { type: "string" },
    limit: { type: "string" },
    checkpoint: { type: "string", default: DEFAULT_CHECKPOINT },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

if (cli.help) {
  console.log(`Usage: npm run backfill:stream-assets -- [options]

Options:
  --dry-run          List candidates and planned actions; no transcode or R2 writes
  --force            Reprocess items that already have stream_path / R2 stream object
  --yes              Enable HYBRID_STREAMING_ENABLED + AUTO_GENERATE_STREAM_ASSETS for this run
  --slug <slug>      Filter products by slug (or track slug when --album-slug set)
  --album-slug <slug> Filter catalog_tracks to one album
  --limit <n>        Process at most n items this run
  --checkpoint <path> Checkpoint file (default: .backfill-stream-checkpoint.json)
  -h, --help         Show this help

Gate: HYBRID_STREAMING_ENABLED=1 AND AUTO_GENERATE_STREAM_ASSETS=1, or --yes.
Resume: completed slugs in checkpoint are skipped unless --force.
`);
  process.exit(0);
}

function loadDotenvLocal() {
  const envPath = resolve(ROOT, ".env.local");
  if (!existsSync(envPath)) {
    console.error("[backfill] Missing .env.local — required for Supabase + R2 credentials.");
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

if (cli.yes) {
  process.env.HYBRID_STREAMING_ENABLED = "1";
  process.env.AUTO_GENERATE_STREAM_ASSETS = "1";
}

const {
  isHybridStreamingEnabled,
  isAutoGenerateStreamAssetsEnabled,
} = await import("@/lib/feature-flags/hybrid-streaming.js");
const {
  generateStreamAssetForCatalogEntity,
  generateStreamAssetForCatalogTrack,
  resolveReleaseTypeFromCatalogRow,
} = await import("@/lib/media/stream-upload-pipeline.js");
const { isFfmpegAvailable } = await import("@/lib/media/stream-transcode.js");

function readHybridEnvBool(raw) {
  if (raw == null || raw === "") return false;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

function gateAllowed() {
  return (
    cli.yes ||
    (readHybridEnvBool(process.env.HYBRID_STREAMING_ENABLED) &&
      readHybridEnvBool(process.env.AUTO_GENERATE_STREAM_ASSETS))
  );
}

if (!gateAllowed()) {
  console.error(
    "[backfill] Refusing to run: set HYBRID_STREAMING_ENABLED=1 and AUTO_GENERATE_STREAM_ASSETS=1, or pass --yes."
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("[backfill] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** @typedef {{ version: number, updatedAt: string, completed: object[], failed: object[] }} Checkpoint */

function loadCheckpoint(path) {
  if (!existsSync(path)) {
    return { version: 1, updatedAt: new Date().toISOString(), completed: [], failed: [] };
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: 1,
      updatedAt: data.updatedAt || new Date().toISOString(),
      completed: Array.isArray(data.completed) ? data.completed : [],
      failed: Array.isArray(data.failed) ? data.failed : [],
    };
  } catch (err) {
    console.warn("[backfill] Could not parse checkpoint — starting fresh:", err?.message);
    return { version: 1, updatedAt: new Date().toISOString(), completed: [], failed: [] };
  }
}

function saveCheckpoint(path, checkpoint) {
  checkpoint.updatedAt = new Date().toISOString();
  writeFileSync(path, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

function checkpointKey(item) {
  return item.kind === "catalog_track"
    ? `track:${item.album_slug}:${item.slug}`
    : `product:${item.slug}`;
}

function isCompleted(checkpoint, item) {
  const key = checkpointKey(item);
  return checkpoint.completed.some((entry) => checkpointKey(entry) === key);
}

function hasStreamRegistration(row) {
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return Boolean(
    String(row.stream_path || "").trim() ||
      String(row.stream_key || "").trim() ||
      String(meta.stream_path || "").trim() ||
      String(meta.stream_key || "").trim()
  );
}

const RELEASE_TYPES = ["singles", "features", "albums", "mixtapes-and-eps"];

function resolveReleaseTypeFromAlbumProduct(albumRow) {
  if (!albumRow) return null;
  const meta = albumRow.metadata && typeof albumRow.metadata === "object" ? albumRow.metadata : {};
  const candidate = meta.release_type || albumRow.product_type || null;
  return candidate ? normalizeReleaseType(String(candidate)) : null;
}

/** Infer canonical release folder from storage_path when DB metadata is stale. */
function inferReleaseTypeFromStoragePath(storagePath) {
  const normalized = String(storagePath || "")
    .replace(/^\//, "")
    .toLowerCase();
  if (!normalized) return null;

  const withoutRoot = normalized.startsWith("digital-assets/")
    ? normalized.slice("digital-assets/".length)
    : normalized;
  const segment = withoutRoot.split("/")[0];
  return RELEASE_TYPES.includes(segment) ? segment : null;
}

function resolveTrackReleaseType(row) {
  const meta =
    row.albumProduct?.metadata && typeof row.albumProduct.metadata === "object"
      ? row.albumProduct.metadata
      : {};
  const fromMeta = meta.release_type ? normalizeReleaseType(String(meta.release_type)) : null;
  if (fromMeta) return fromMeta;
  const fromPath = inferReleaseTypeFromStoragePath(row.storage_path);
  if (fromPath) return fromPath;
  return resolveReleaseTypeFromAlbumProduct(row.albumProduct);
}

async function fetchProductCandidates() {
  const selectWithStream =
    "slug, title, product_type, storage_path, stream_path, stream_key, metadata";
  const selectBase = "slug, title, product_type, storage_path, metadata";

  async function runQuery(select) {
    let query = admin.from("products").select(select).not("storage_path", "is", null);
    if (cli.slug && !cli["album-slug"]) {
      query = query.eq("slug", cli.slug);
    }
    return query.order("slug");
  }

  let { data, error } = await runQuery(selectWithStream);
  if (error?.message?.includes("stream_path") || error?.message?.includes("stream_key")) {
    console.warn("[backfill] stream columns missing on products — using metadata-only stream detection");
    ({ data, error } = await runQuery(selectBase));
  }
  if (error) throw new Error(`products query failed: ${error.message}`);

  return (data || []).filter((row) => {
    const storagePath = String(row.storage_path || "").trim();
    if (!storagePath) return false;
    if (!cli.force && hasStreamRegistration(row)) return false;
    return true;
  });
}

async function fetchTrackCandidates() {
  if (cli.slug && !cli["album-slug"]) {
    return [];
  }

  const selectWithStream =
    "album_slug, slug, title, storage_path, stream_path, stream_key";
  const selectBase = "album_slug, slug, title, storage_path";

  async function runQuery(select) {
    let query = admin.from("catalog_tracks").select(select).not("storage_path", "is", null);
    if (cli["album-slug"]) {
      query = query.eq("album_slug", cli["album-slug"]);
    }
    if (cli.slug && cli["album-slug"]) {
      query = query.eq("slug", cli.slug);
    }
    return query.order("album_slug").order("slug");
  }

  let { data, error } = await runQuery(selectWithStream);
  if (error?.message?.includes("stream_path") || error?.message?.includes("stream_key")) {
    console.warn(
      "[backfill] stream columns missing on catalog_tracks — using storage_path-only candidate detection"
    );
    ({ data, error } = await runQuery(selectBase));
  }
  if (error) throw new Error(`catalog_tracks query failed: ${error.message}`);

  const albumSlugs = [...new Set((data || []).map((r) => r.album_slug))];
  /** @type {Map<string, object>} */
  const albumBySlug = new Map();

  if (albumSlugs.length) {
    const { data: albums, error: albumError } = await admin
      .from("products")
      .select("slug, product_type, metadata")
      .in("slug", albumSlugs);
    if (albumError) throw new Error(`album products query failed: ${albumError.message}`);
    for (const row of albums || []) {
      albumBySlug.set(row.slug, row);
    }
  }

  return (data || [])
    .filter((row) => {
      const storagePath = String(row.storage_path || "").trim();
      if (!storagePath) return false;
      if (!cli.force && hasStreamRegistration(row)) return false;
      return true;
    })
    .map((row) => ({
      ...row,
      albumProduct: albumBySlug.get(row.album_slug) || null,
    }));
}

async function processProduct(row, checkpoint, checkpointPath, dryRun) {
  const item = { kind: "product", slug: row.slug };
  if (!cli.force && isCompleted(checkpoint, item)) {
    console.log(`[skip] product:${row.slug} (checkpoint)`);
    return { status: "skipped_checkpoint" };
  }

  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const fromMeta = meta.release_type ? normalizeReleaseType(String(meta.release_type)) : null;
  const releaseType =
    fromMeta ||
    inferReleaseTypeFromStoragePath(row.storage_path) ||
    resolveReleaseTypeFromCatalogRow(row);

  console.log(`[product] ${row.slug} storage=${row.storage_path} release_type=${releaseType || "?"}`);

  if (dryRun) {
    console.log(`  dry-run: would transcode master → streaming/ and register stream_path`);
    return { status: "dry_run" };
  }

  const outcome = await generateStreamAssetForCatalogEntity({
    adminClient: admin,
    slug: row.slug,
    storagePath: row.storage_path,
    releaseType,
    metadata: meta,
    force: cli.force,
  });

  if (outcome.skipped && outcome.reason === "auto_generate_disabled") {
    console.error("[backfill] auto_generate_disabled despite gate — aborting.");
    process.exit(1);
  }

  if (outcome.ok && !outcome.error) {
    const entry = {
      ...item,
      completedAt: new Date().toISOString(),
      skipped: Boolean(outcome.skipped),
      reason: outcome.reason || null,
      stream_key: outcome.stream?.stream_key || null,
    };
    checkpoint.completed.push(entry);
    checkpoint.failed = checkpoint.failed.filter((f) => checkpointKey(f) !== checkpointKey(item));
    saveCheckpoint(checkpointPath, checkpoint);
    console.log(`  ok${outcome.skipped ? ` (skipped: ${outcome.reason})` : ""}`);
    return { status: outcome.skipped ? "skipped" : "success", outcome };
  }

  const failEntry = {
    ...item,
    failedAt: new Date().toISOString(),
    error: outcome.error || "unknown_error",
  };
  checkpoint.failed = [
    ...checkpoint.failed.filter((f) => checkpointKey(f) !== checkpointKey(item)),
    failEntry,
  ];
  saveCheckpoint(checkpointPath, checkpoint);
  console.error(`  failed: ${failEntry.error}`);
  return { status: "failed", outcome };
}

async function processTrack(row, checkpoint, checkpointPath, dryRun) {
  const item = { kind: "catalog_track", album_slug: row.album_slug, slug: row.slug };
  if (!cli.force && isCompleted(checkpoint, item)) {
    console.log(`[skip] track:${row.album_slug}/${row.slug} (checkpoint)`);
    return { status: "skipped_checkpoint" };
  }

  const releaseType = resolveTrackReleaseType(row);
  console.log(
    `[track] ${row.album_slug}/${row.slug} storage=${row.storage_path} release_type=${releaseType || "?"}`
  );

  if (dryRun) {
    console.log(`  dry-run: would transcode master → streaming/ and register stream_path`);
    return { status: "dry_run" };
  }

  const outcome = await generateStreamAssetForCatalogTrack({
    adminClient: admin,
    albumSlug: row.album_slug,
    trackSlug: row.slug,
    storagePath: row.storage_path,
    releaseType,
    force: cli.force,
  });

  if (outcome.ok && !outcome.error) {
    const entry = {
      ...item,
      completedAt: new Date().toISOString(),
      skipped: Boolean(outcome.skipped),
      reason: outcome.reason || null,
      stream_key: outcome.stream?.stream_key || null,
    };
    checkpoint.completed.push(entry);
    checkpoint.failed = checkpoint.failed.filter((f) => checkpointKey(f) !== checkpointKey(item));
    saveCheckpoint(checkpointPath, checkpoint);
    console.log(`  ok${outcome.skipped ? ` (skipped: ${outcome.reason})` : ""}`);
    return { status: outcome.skipped ? "skipped" : "success", outcome };
  }

  const failEntry = {
    ...item,
    failedAt: new Date().toISOString(),
    error: outcome.error || "unknown_error",
  };
  checkpoint.failed = [
    ...checkpoint.failed.filter((f) => checkpointKey(f) !== checkpointKey(item)),
    failEntry,
  ];
  saveCheckpoint(checkpointPath, checkpoint);
  console.error(`  failed: ${failEntry.error}`);
  return { status: "failed", outcome };
}

async function main() {
  const dryRun = cli["dry-run"];
  const checkpointPath = resolve(cli.checkpoint);
  const limit = cli.limit ? Math.max(1, parseInt(cli.limit, 10) || 0) : null;

  console.log("[backfill] Phase 5.2 Stage 6 — catalog stream backfill");
  console.log("[backfill] flags:", {
    hybridStreamingEnabled: isHybridStreamingEnabled(),
    autoGenerateStreamAssets: isAutoGenerateStreamAssetsEnabled(),
    dryRun,
    force: cli.force,
    checkpoint: checkpointPath,
  });

  if (!dryRun) {
    const ffmpegOk = await isFfmpegAvailable();
    if (!ffmpegOk) {
      console.warn(
        "[backfill] ffmpeg not available — live runs will fail per-item. Use --dry-run to enumerate candidates without transcode."
      );
    }
  }

  const checkpoint = loadCheckpoint(checkpointPath);
  const products = await fetchProductCandidates();
  const tracks = await fetchTrackCandidates();

  const queue = [
    ...products.map((row) => ({ type: "product", row })),
    ...tracks.map((row) => ({ type: "track", row })),
  ];

  console.log(
    `[backfill] candidates: ${products.length} products, ${tracks.length} catalog_tracks (${queue.length} total)`
  );

  if (limit) {
    console.log(`[backfill] limit: ${limit}`);
  }

  const stats = {
    processed: 0,
    success: 0,
    skipped: 0,
    skipped_checkpoint: 0,
    failed: 0,
    dry_run: 0,
  };

  let processedCount = 0;
  for (const entry of queue) {
    if (limit && processedCount >= limit) break;

    let result;
    if (entry.type === "product") {
      result = await processProduct(entry.row, checkpoint, checkpointPath, dryRun);
    } else {
      result = await processTrack(entry.row, checkpoint, checkpointPath, dryRun);
    }

    stats[result.status] = (stats[result.status] || 0) + 1;
    if (result.status !== "skipped_checkpoint") {
      processedCount += 1;
      stats.processed += 1;
    }
  }

  console.log("[backfill] summary:", stats);
  console.log(
    `[backfill] checkpoint: ${checkpoint.completed.length} completed, ${checkpoint.failed.length} failed entries`
  );

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[backfill] fatal:", err?.message || err);
  process.exit(1);
});
