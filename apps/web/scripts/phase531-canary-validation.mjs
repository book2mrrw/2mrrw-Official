#!/usr/bin/env node
/**
 * Phase 5.3.1 — Stream backfill canary validation (DB + resolver hits).
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

const CANARY_SLUGS = [
  "hour-glass",
  "2-heavy",
  "artificial",
  "i-dont-believe-you",
  "turnt-me-2-dis",
  "w2d",
];

const CANARY_TRACKS = [
  { album_slug: "ad", slug: "01-2mrrws-ntro" },
  { album_slug: "tbh", slug: "01-glass-full" },
];

async function validateProducts() {
  const { data, error } = await admin
    .from("products")
    .select("slug, stream_path, stream_key, storage_path, product_type")
    .in("slug", CANARY_SLUGS);
  if (error) throw error;

  const results = [];
  for (const slug of CANARY_SLUGS) {
    const row = data?.find((r) => r.slug === slug) || null;
    results.push({
      kind: "product",
      slug,
      registered: Boolean(row?.stream_key && row?.stream_path),
      stream_key: row?.stream_key || null,
      stream_path: row?.stream_path || null,
    });
  }
  return results;
}

async function validateTracks() {
  const results = [];
  for (const { album_slug, slug } of CANARY_TRACKS) {
    const { data, error } = await admin
      .from("catalog_tracks")
      .select("album_slug, slug, stream_path, stream_key, storage_path")
      .eq("album_slug", album_slug)
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    results.push({
      kind: "catalog_track",
      album_slug,
      slug,
      registered: Boolean(data?.stream_key && data?.stream_path),
      stream_key: data?.stream_key || null,
      stream_path: data?.stream_path || null,
    });
  }
  return results;
}

async function resolverHits(rows) {
  const hits = [];
  for (const row of rows) {
    if (row.kind === "product") {
      const { data: product } = await admin
        .from("products")
        .select("*")
        .eq("slug", row.slug)
        .maybeSingle();
      const result = await tryResolveStreamPlaybackKey(admin, product, null, {
        headCheck: async (k) => (await headR2ObjectKey(k)) ? k : null,
      });
      hits.push({
        id: `product:${row.slug}`,
        registered: row.registered,
        resolverOk: result.ok,
        key: result.key || null,
        fallbackReason: result.fallbackReason || null,
      });
    } else {
      const { data: track } = await admin
        .from("catalog_tracks")
        .select("*")
        .eq("album_slug", row.album_slug)
        .eq("slug", row.slug)
        .maybeSingle();
      const { data: album } = await admin
        .from("products")
        .select("*")
        .eq("slug", row.album_slug)
        .maybeSingle();
      const result = await tryResolveStreamPlaybackKey(admin, album, row.slug, {
        headCheck: async (k) => (await headR2ObjectKey(k)) ? k : null,
      });
      hits.push({
        id: `track:${row.album_slug}/${row.slug}`,
        registered: row.registered,
        resolverOk: result.ok,
        key: result.key || null,
        fallbackReason: result.fallbackReason || null,
      });
    }
  }
  return hits;
}

async function countCatalogState() {
  const { data: products } = await admin
    .from("products")
    .select("slug, stream_key")
    .not("storage_path", "is", null);
  const { data: tracks } = await admin
    .from("catalog_tracks")
    .select("album_slug, slug, stream_key")
    .not("storage_path", "is", null);

  const productRegistered = (products || []).filter((r) => r.stream_key).length;
  const trackRegistered = (tracks || []).filter((r) => r.stream_key).length;
  const productTotal = (products || []).length;
  const trackTotal = (tracks || []).length;

  return {
    products: { registered: productRegistered, total: productTotal },
    tracks: { registered: trackRegistered, total: trackTotal },
  };
}

const registration = [...(await validateProducts()), ...(await validateTracks())];
const hits = await resolverHits(registration);
const catalog = await countCatalogState();

const streamHits = hits.filter((h) => h.resolverOk).length;
const registeredCount = registration.filter((r) => r.registered).length;

console.log(JSON.stringify({ registration, hits, catalog, streamHits, registeredCount }, null, 2));
