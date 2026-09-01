#!/usr/bin/env node
/**
 * Phase 5.3.4 — Tracklist + catalog surface resolver validation.
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

const { resolvePlaybackKey, clearPlaybackKeyCache } = await import(
  "@/lib/playback/resolve-playback-key.js"
);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const SAMPLES = [
  { surface: "singles", slug: "hour-glass", trackSlug: null },
  { surface: "singles", slug: "artificial", trackSlug: null },
  { surface: "features", slug: "2-heavy", trackSlug: null },
  { surface: "features", slug: "i-dont-believe-you", trackSlug: null },
  { surface: "ad", album: "ad", track: 1, slug: "01-2mrrws-ntro" },
  { surface: "ad", album: "ad", track: 3, slug: "03-said-n-done" },
  { surface: "ad", album: "ad", track: 5, slug: "05-perspective" },
  { surface: "ad", album: "ad", track: 7, slug: "07-a2b" },
  { surface: "ad", album: "ad", track: 11, slug: "11-like-me-or-not" },
  { surface: "love-hz-vol-1", album: "love-hz-vol-1", track: 2, slug: "02-w-2-d" },
  { surface: "love-hz-vol-1", album: "love-hz-vol-1", track: 5, slug: "05-like-u-do" },
  { surface: "love-hz-vol-1", album: "love-hz-vol-1", track: 7, slug: "07-stayed-2-long" },
  { surface: "love-hz-vol-1", album: "love-hz-vol-1", track: 9, slug: "09-hour-glass" },
  { surface: "tbh", album: "tbh", track: 3, slug: "03-unxpcted" },
  { surface: "tbh", album: "tbh", track: 5, slug: "05-locomotive" },
  { surface: "tbh", album: "tbh", track: 8, slug: "08-2late" },
  { surface: "tbh", album: "tbh", track: 9, slug: "09-artificial" },
];

const results = [];
for (const sample of SAMPLES) {
  clearPlaybackKeyCache();
  const productSlug = sample.album || sample.slug;
  const trackSlug = sample.slug && sample.album ? sample.slug : null;
  const resolved = await resolvePlaybackKey(admin, productSlug, { trackSlug });
  results.push({
    surface: sample.surface,
    productSlug,
    trackSlug,
    trackNum: sample.track || null,
    playbackSource: resolved?.playbackSource || null,
    resolverResult: resolved?.resolverResult || null,
    key: resolved?.key || null,
    streamFallbackReason: resolved?.streamFallbackReason || null,
    pass:
      resolved?.playbackSource === "stream" ||
      (sample.album === "love-hz-vol-1" && sample.track === 2
        ? resolved?.playbackSource === "stream"
        : false),
    status:
      resolved?.playbackSource === "stream"
        ? "PASS"
        : resolved?.playbackSource === "master"
          ? "FALLBACK"
          : resolved?.playbackSource === "preview"
            ? "PREVIEW"
            : "FAIL",
  });
}

const streamHits = results.filter((r) => r.playbackSource === "stream").length;
const fallbacks = results.filter((r) => r.playbackSource === "master").length;
const fails = results.filter((r) => !r.key).length;

console.log(
  JSON.stringify(
    {
      flags: { HYBRID_STREAMING_ENABLED: "1", STREAM_PLAYBACK_PREFERRED: "1" },
      total: results.length,
      stream_hits: streamHits,
      master_fallbacks: fallbacks,
      fails,
      results,
    },
    null,
    2
  )
);
