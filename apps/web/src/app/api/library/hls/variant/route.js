/**
 * GET /api/library/hls/variant?slug=&bitrate=&token=&[trackSlug=]
 *
 * Serves an HLS variant playlist for a single bitrate tier.
 * Auth is via the HMAC variant token issued by /api/library/hls — no DB round-trip.
 *
 * Segments are listed as public Cloudflare CDN URLs (no presigning).
 * Content is AES-128 encrypted — public URLs are useless without the decryption key.
 * The key is delivered by /api/library/hls/key (auth-gated, 60 min token).
 *
 * This architecture scales to millions of users:
 *   - Cloudflare CDN caches the encrypted segments at edge globally
 *   - Zero server involvement for segment delivery
 *   - Key server is the single entitlement checkpoint
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { verifyVariantToken, signKeyToken } from "@/lib/hls/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// Public Cloudflare R2 CDN base — no auth required, content is AES-128 encrypted
const R2_CDN = process.env.NEXT_PUBLIC_R2_CDN_URL?.replace(/\/$/, "") ||
               "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev";

function cors(req, res) {
  return applyMediaCors(req, res);
}

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

export async function GET(req) {
  const { searchParams, origin } = req.nextUrl;
  const slug      = searchParams.get("slug");
  const trackSlug = searchParams.get("trackSlug") || null;
  const bitrate   = searchParams.get("bitrate");
  const token     = searchParams.get("token");

  if (!slug || !bitrate || !token) {
    return cors(req, NextResponse.json({ error: "slug, bitrate, and token required" }, { status: 400 }));
  }

  // Verify variant token — covers both auth and entitlement (signed at master-manifest time)
  const payload = await verifyVariantToken(token);
  if (!payload || payload.slug !== slug || payload.bitrate !== bitrate ||
      (payload.trackSlug || null) !== trackSlug) {
    return cors(req, NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }));
  }

  // Rate limit keyed by user ID extracted from the token
  const rl = await checkRateLimit(req, {
    routeKey: "library.hls.variant",
    limit: 120,
    windowSeconds: 60,
    identifier: payload.userId,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  // Fetch manifest metadata from DB — single query, no presigning needed
  const admin = createAdminClient();
  let manifestQ = admin
    .from("hls_manifests")
    .select("hls_prefix, segment_duration_secs, duration_seconds, segment_counts")
    .eq("slug", slug);
  manifestQ = trackSlug ? manifestQ.eq("track_slug", trackSlug) : manifestQ.is("track_slug", null);
  const { data: manifest, error } = await manifestQ.maybeSingle();

  if (error) {
    console.error("[hls/variant] DB error", { slug, trackSlug, message: error.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
  if (!manifest) {
    return cors(req, NextResponse.json({ error: "Manifest not found" }, { status: 404 }));
  }

  const prefix      = manifest.hls_prefix;
  const segCount    = (manifest.segment_counts?.[bitrate]) ?? 0;
  const segDuration = manifest.segment_duration_secs ?? 6;
  const totalDur    = manifest.duration_seconds ?? 0;

  if (segCount === 0) {
    return cors(req, NextResponse.json({ error: "No segments for this bitrate" }, { status: 404 }));
  }

  // Issue a key-delivery token (60 min, matches variant token lifetime)
  const keyToken  = await signKeyToken({ slug, trackSlug, userId: payload.userId });
  const keyParams = new URLSearchParams({ token: keyToken });
  const keyUrl    = `${origin}/api/library/hls/key?${keyParams}`;

  // Derive the IV for this track — embedded in playlist, never stored in DB
  const { deriveHLSIV } = await import("@/lib/hls/derive-key");
  const ivBuf = await deriveHLSIV(slug, trackSlug);
  const ivHex = ivBuf.toString("hex");

  // Build variant playlist (MPEG-TS, HLS v3)
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${segDuration}`,
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "",
    `#EXT-X-KEY:METHOD=AES-128,URI="${keyUrl}",IV=0x${ivHex}`,
    "",
  ];

  for (let i = 0; i < segCount; i++) {
    const segNum  = String(i + 1).padStart(5, "0");
    const segUrl  = `${R2_CDN}/${prefix}${bitrate}/seg_${segNum}.ts`;
    const isLast  = i === segCount - 1;
    const segDur  = isLast && totalDur > 0
      ? Math.max(0.001, totalDur - (segDuration * i)).toFixed(6)
      : segDuration.toFixed(6);

    lines.push(`#EXTINF:${segDur},`, segUrl);
  }

  lines.push("#EXT-X-ENDLIST");

  return cors(
    req,
    new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/x-mpegURL",
        // Segment URLs are stable CDN paths — cache variant playlist for key token lifetime
        "Cache-Control": "private, max-age=3300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}
