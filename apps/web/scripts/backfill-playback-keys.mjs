#!/usr/bin/env node
/**
 * Eager catalog-wide backfill for playback_key_resolution_cache.
 *
 * resolvePlaybackKey() normally only persists a track's discovered R2 key the first time
 * someone plays it (cache-on-miss). That still means the very first listener for every
 * existing catalog item pays a live R2 folder-discovery scan. This script calls the exact
 * same resolver for every product/track in the catalog right now, so the discovery cost is
 * paid once, here, instead of once per item per cold start in production.
 *
 * Run:
 *   npm run backfill:playback-keys -- --dry-run
 *   npm run backfill:playback-keys
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY + CLOUDFLARE_R2_* in .env.local.
 * Safe to re-run any time (idempotent — resolvePlaybackKey just confirms the persisted key).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const { values: cli } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    slug: { type: "string" },
    "album-slug": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

if (cli.help) {
  console.log(`Usage: npm run backfill:playback-keys -- [options]

Options:
  --dry-run            List candidates only; do not call the resolver
  --slug <slug>         Filter products by slug
  --album-slug <slug>   Filter catalog_tracks to one album
  -h, --help            Show this help
`);
  process.exit(0);
}

function loadDotenvLocal() {
  const envPath = resolve(ROOT, ".env.local");
  if (!existsSync(envPath)) {
    console.error("[backfill-playback-keys] Missing .env.local — required for Supabase + R2 credentials.");
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

const { resolvePlaybackKey } = await import("@/lib/playback/resolve-playback-key.js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("[backfill-playback-keys] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchProducts() {
  let query = admin.from("products").select("slug").not("slug", "is", null).order("slug");
  if (cli.slug && !cli["album-slug"]) query = query.eq("slug", cli.slug);
  const { data, error } = await query;
  if (error) throw new Error(`products query failed: ${error.message}`);
  return data || [];
}

async function fetchTracks() {
  if (cli.slug && !cli["album-slug"]) return [];
  let query = admin.from("catalog_tracks").select("album_slug, slug").order("album_slug").order("slug");
  if (cli["album-slug"]) query = query.eq("album_slug", cli["album-slug"]);
  if (cli.slug && cli["album-slug"]) query = query.eq("slug", cli.slug);
  const { data, error } = await query;
  if (error) throw new Error(`catalog_tracks query failed: ${error.message}`);
  return data || [];
}

async function main() {
  const products = await fetchProducts();
  const tracks = await fetchTracks();
  const items = [
    ...products.map((p) => ({ slug: p.slug, trackSlug: null, label: p.slug })),
    ...tracks.map((t) => ({ slug: t.album_slug, trackSlug: t.slug, label: `${t.album_slug}:${t.slug}` })),
  ];

  console.log(`[backfill-playback-keys] candidates: ${products.length} products, ${tracks.length} tracks`);
  if (cli["dry-run"]) {
    items.forEach((item) => console.log(`  dry-run: ${item.label}`));
    return;
  }

  const stats = { resolved: 0, missing: 0, failed: 0 };
  for (const item of items) {
    try {
      const result = await resolvePlaybackKey(admin, item.slug, { trackSlug: item.trackSlug || undefined });
      if (result?.key) {
        stats.resolved += 1;
        console.log(`  ok: ${item.label} -> ${result.playbackSource} (${result.source})`);
      } else {
        stats.missing += 1;
        console.warn(`  missing: ${item.label} (no audio found)`);
      }
    } catch (err) {
      stats.failed += 1;
      console.error(`  failed: ${item.label} - ${err?.message || err}`);
    }
  }

  console.log("[backfill-playback-keys] summary:", stats);
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("[backfill-playback-keys] fatal:", err?.message || err);
  process.exit(1);
});
