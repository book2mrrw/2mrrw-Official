import { NextResponse } from "next/server";
import { requireAdminOrCapability, ServiceCapability } from "@/lib/auth/admin-api-guard";
import { getAdminClient } from "@/lib/supabase/admin";
import { resolvePlaybackKey } from "@/lib/playback/resolve-playback-key";
import { getHybridStreamingFeatureFlags } from "@/lib/feature-flags";
import { createR2SignedGetUrl } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One-time/rerunnable admin trigger for the playback-key eager backfill (see
 * scripts/backfill-playback-keys.mjs — same resolver, run server-side since production
 * secrets are Vercel "Sensitive" vars and can't be pulled to run the script locally).
 * Dedicated secret (not ADMIN_SEED_SECRET) so triggering this doesn't depend on a
 * value already locked behind Vercel's Sensitive-var write-only restriction.
 */
async function isAuthorized(req) {
  return (await requireAdminOrCapability(req, ServiceCapability.PLAYBACK_BACKFILL)).ok;
}

export async function POST(req) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const admin = getAdminClient();

  const { data: products, error: productsError } = await admin
    .from("products")
    .select("slug")
    .not("slug", "is", null);
  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 });
  }

  const { data: tracks, error: tracksError } = await admin
    .from("catalog_tracks")
    .select("album_slug, slug");
  if (tracksError) {
    return NextResponse.json({ error: tracksError.message }, { status: 500 });
  }

  const items = [
    ...(products || []).map((p) => ({ slug: p.slug, trackSlug: null, label: p.slug })),
    ...(tracks || []).map((t) => ({
      slug: t.album_slug,
      trackSlug: t.slug,
      label: `${t.album_slug}:${t.slug}`,
    })),
  ];

  const stats = { resolved: 0, missing: 0, failed: 0 };
  const details = [];

  for (const item of items) {
    try {
      const result = await resolvePlaybackKey(admin, item.slug, {
        trackSlug: item.trackSlug || undefined,
      });
      if (result?.key) {
        stats.resolved += 1;
      } else {
        stats.missing += 1;
        details.push({ label: item.label, status: "missing" });
      }
    } catch (err) {
      stats.failed += 1;
      details.push({ label: item.label, status: "failed", error: err?.message });
    }
  }

  return NextResponse.json({ candidates: items.length, stats, details });
}

/** Diagnostic: ?slug=&trackSlug= — reports which file/path actually serves, with no playback. */
export async function GET(req) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const slug = req.nextUrl.searchParams.get("slug");
  const trackSlug = req.nextUrl.searchParams.get("trackSlug") || undefined;
  if (!slug) {
    return NextResponse.json({ flags: getHybridStreamingFeatureFlags() });
  }

  const admin = getAdminClient();
  const resolved = await resolvePlaybackKey(admin, slug, { trackSlug });
  if (!resolved?.key) {
    return NextResponse.json({ flags: getHybridStreamingFeatureFlags(), resolved: null });
  }

  const signedUrl = await createR2SignedGetUrl(resolved.key, 300);
  return NextResponse.json({
    flags: getHybridStreamingFeatureFlags(),
    resolved: {
      key: resolved.key,
      source: resolved.source,
      playbackSource: resolved.playbackSource,
      resolverResult: resolved.resolverResult,
      resolverDurationMs: resolved.resolverDurationMs,
      streamFallbackReason: resolved.streamFallbackReason || null,
    },
    signedUrl,
  });
}
