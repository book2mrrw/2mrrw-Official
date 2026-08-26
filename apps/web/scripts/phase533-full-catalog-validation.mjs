#!/usr/bin/env node
/**
 * Phase 5.3.3 — Full catalog stream inventory validation (DB + R2 + resolver).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadDotenvLocal() {
  const envPath = resolve(ROOT, ".env.local");
  if (!existsSync(envPath)) throw new Error("Missing .env.local");
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

process.env.HYBRID_STREAMING_ENABLED = "1";
process.env.STREAM_PLAYBACK_PREFERRED = "1";

const { tryResolveStreamPlaybackKey } = await import("@/lib/playback/resolve-stream-playback.js");
const { headR2ObjectKey } = await import("@/lib/storage/r2.js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function hasStreamRegistration(row) {
  return Boolean(String(row.stream_key || "").trim() && String(row.stream_path || "").trim());
}

async function fetchPlayableCatalog() {
  const { data: products, error: pErr } = await admin
    .from("products")
    .select("slug, title, product_type, storage_path, stream_path, stream_key, metadata")
    .not("storage_path", "is", null)
    .order("slug");
  if (pErr) throw pErr;

  const { data: tracks, error: tErr } = await admin
    .from("catalog_tracks")
    .select("album_slug, slug, title, storage_path, stream_path, stream_key")
    .not("storage_path", "is", null)
    .order("album_slug")
    .order("slug");
  if (tErr) throw tErr;

  const albumSlugs = [...new Set((tracks || []).map((r) => r.album_slug))];
  const { data: albums } = await admin
    .from("products")
    .select("slug, product_type, metadata")
    .in("slug", albumSlugs.length ? albumSlugs : ["__none__"]);

  const albumBySlug = new Map((albums || []).map((a) => [a.slug, a]));

  return {
    products: products || [],
    tracks: (tracks || []).map((t) => ({ ...t, albumProduct: albumBySlug.get(t.album_slug) || null })),
  };
}

async function validateR2(streamKey) {
  if (!streamKey) return { exists: false, error: "no_key" };
  try {
    const head = await headR2ObjectKey(streamKey);
    return { exists: Boolean(head), contentLength: head?.contentLength || null };
  } catch (err) {
    return { exists: false, error: err?.message || "head_failed" };
  }
}

async function resolverForProduct(product) {
  const result = await tryResolveStreamPlaybackKey(admin, product, null, {
    headCheck: async (k) => ((await headR2ObjectKey(k)) ? k : null),
  });
  return {
    ok: result.ok,
    key: result.key || null,
    fallbackReason: result.fallbackReason || null,
  };
}

async function resolverForTrack(album, trackSlug) {
  const result = await tryResolveStreamPlaybackKey(admin, album, trackSlug, {
    headCheck: async (k) => ((await headR2ObjectKey(k)) ? k : null),
  });
  return {
    ok: result.ok,
    key: result.key || null,
    fallbackReason: result.fallbackReason || null,
  };
}

const { products, tracks } = await fetchPlayableCatalog();

const productResults = [];
for (const p of products) {
  const registered = hasStreamRegistration(p);
  const r2 = registered ? await validateR2(p.stream_key) : { exists: false, error: "not_registered" };
  const resolver = await resolverForProduct(p);
  productResults.push({
    kind: "product",
    slug: p.slug,
    title: p.title,
    product_type: p.product_type,
    registered,
    stream_key: p.stream_key || null,
    r2_exists: r2.exists,
    r2_content_length: r2.contentLength || null,
    resolver_hit: resolver.ok,
    fallback_reason: resolver.fallbackReason,
  });
}

const trackResults = [];
for (const t of tracks) {
  const registered = hasStreamRegistration(t);
  const r2 = registered ? await validateR2(t.stream_key) : { exists: false, error: "not_registered" };
  const resolver = await resolverForTrack(t.albumProduct, t.slug);
  trackResults.push({
    kind: "catalog_track",
    album_slug: t.album_slug,
    slug: t.slug,
    title: t.title,
    registered,
    stream_key: t.stream_key || null,
    r2_exists: r2.exists,
    r2_content_length: r2.contentLength || null,
    resolver_hit: resolver.ok,
    fallback_reason: resolver.fallbackReason,
  });
}

const all = [...productResults, ...trackResults];
const total = all.length;
const registered = all.filter((r) => r.registered).length;
const r2Ok = all.filter((r) => r.r2_exists).length;
const resolverHits = all.filter((r) => r.resolver_hit).length;
const resolverFallbacks = all.filter((r) => !r.resolver_hit).length;
const unregistered = all.filter((r) => !r.registered);

const checkpointPath = resolve(ROOT, ".backfill-stream-phase533.json");
const canaryCheckpointPath = resolve(ROOT, ".backfill-stream-canary-phase531.json");
let checkpoint = { completed: [], failed: [] };
let canaryCheckpoint = { completed: [], failed: [] };
if (existsSync(checkpointPath)) checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
if (existsSync(canaryCheckpointPath)) canaryCheckpoint = JSON.parse(readFileSync(canaryCheckpointPath, "utf8"));

const summary = {
  total_playable: total,
  products: { total: products.length, registered: productResults.filter((r) => r.registered).length },
  tracks: { total: tracks.length, registered: trackResults.filter((r) => r.registered).length },
  registration_pct: total ? Math.round((registered / total) * 1000) / 10 : 0,
  r2_validated: r2Ok,
  r2_pct: registered ? Math.round((r2Ok / registered) * 1000) / 10 : 0,
  resolver_hits: resolverHits,
  resolver_hit_pct: total ? Math.round((resolverHits / total) * 1000) / 10 : 0,
  resolver_fallbacks: resolverFallbacks,
  unregistered_items: unregistered.map((r) =>
    r.kind === "product" ? `product:${r.slug}` : `track:${r.album_slug}/${r.slug}`
  ),
  backfill_run: {
    phase533_completed: checkpoint.completed?.length || 0,
    phase533_failed: checkpoint.failed?.length || 0,
    canary_completed: canaryCheckpoint.completed?.length || 0,
    canary_failed: canaryCheckpoint.failed?.length || 0,
  },
  products: productResults,
  tracks: trackResults,
};

console.log(JSON.stringify(summary, null, 2));
