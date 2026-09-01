/**
 * GET /api/library/hls?slug=<slug>[&trackSlug=<trackSlug>]
 *
 * Serves an HLS master playlist for an entitled user.
 * Returns 404 when no HLS manifest has been transcoded for this track yet
 * (client falls back to progressive download automatically).
 *
 * Master playlist → 3 variant playlists (320k / 160k / 96k)
 * Each variant URL carries a signed token (HMAC, 60 min TTL) that
 * authorises the /api/library/hls/variant endpoint without a DB round-trip.
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getGuestUser } from "@/lib/guest-session";
import { userCanStreamProduct } from "@/lib/commerce/entitlements";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { signVariantToken } from "@/lib/hls/token";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getOrFetchManifest } from "@/lib/server/hls-manifest-cache";
import { resolveReleaseAccessForProduct } from "@/lib/releases/release-availability-server";

export const dynamic = "force-dynamic";

// Bitrate → approximate bandwidth in bits/second (for ABR hint in master playlist)
const BITRATE_BANDWIDTH = {
  "320k": 360_000,
  "160k": 180_000,
  "96k":  108_000,
};

function cors(req, res) {
  return applyMediaCors(req, res);
}

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

export async function GET(req) {
  const { searchParams } = req.nextUrl;
  const slug      = searchParams.get("slug");
  const trackSlug = searchParams.get("trackSlug") || null;

  if (!slug) {
    return cors(req, NextResponse.json({ error: "slug required" }, { status: 400 }));
  }

  // Auth
  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  if (!user) {
    return cors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  // Rate limit — looser than /stream since manifests are small and cached by hls.js
  const rl = await checkRateLimit(req, {
    routeKey: "library.hls.manifest",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  // Entitlement — admins bypass; all others must have canStream
  if (!isAdminUser(user)) {
    const releaseAccess = await resolveReleaseAccessForProduct({ slug, user, trackId: trackSlug });
    const canStream = releaseAccess.availability
      ? releaseAccess.availability.canPlayFull
      : await userCanStreamProduct(user.id, slug, user);
    if (!canStream) {
      return cors(req, NextResponse.json({ error: "Not entitled" }, { status: 403 }));
    }
  }

  // Look up completed HLS manifest — served from L1/L2 cache on all warm requests.
  // Normalize trackSlug: singles have track_slug IS NULL in the DB. Some callers pass
  // trackSlug === slug as a fallback (no real sub-track identifier) — treat that as null.
  const effectiveTrackSlug = (trackSlug && trackSlug !== slug) ? trackSlug : null;

  let manifest;
  try {
    manifest = await getOrFetchManifest(slug, effectiveTrackSlug, async () => {
      const admin = getAdminClient();
      let q = admin
        .from("hls_manifests")
        .select("bitrates, segment_duration_secs, duration_seconds, hls_prefix, segment_counts")
        .eq("slug", slug);
      q = effectiveTrackSlug ? q.eq("track_slug", effectiveTrackSlug) : q.is("track_slug", null);
      const { data, error } = await q.maybeSingle();
      if (error) throw error;
      return data ?? null;
    });
  } catch (err) {
    console.error("[hls/manifest] DB error", { slug, trackSlug, message: err.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }

  // No manifest → track not yet transcoded; client falls back to progressive download
  if (!manifest) {
    return cors(req, NextResponse.json({ error: "HLS not available for this track" }, { status: 404 }));
  }

  const bitrates = manifest.bitrates ?? ["320k", "160k", "96k"];
  const origin   = req.nextUrl.origin;

  // Sign variant tokens concurrently
  const variantTokens = await Promise.all(
    bitrates.map((br) =>
      signVariantToken({ slug, trackSlug: effectiveTrackSlug, userId: user.id, bitrate: br })
    )
  );

  // Build HLS master playlist (HLS spec §4.3.4)
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "",
  ];

  for (let i = 0; i < bitrates.length; i++) {
    const br        = bitrates[i];
    const bandwidth = BITRATE_BANDWIDTH[br] ?? 160_000;
    const token     = variantTokens[i];
    const params    = new URLSearchParams({ slug, bitrate: br, token });
    if (effectiveTrackSlug) params.set("trackSlug", effectiveTrackSlug);
    const variantUrl = `${origin}/api/library/hls/variant?${params}`;

    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="mp4a.40.2",CHANNELS="2"`,
      variantUrl
    );
  }

  return cors(
    req,
    new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/x-mpegURL",
        // Never cache manifests — segment URLs have their own TTL,
        // and we need fresh tokens on every session start.
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}
