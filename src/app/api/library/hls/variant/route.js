/**
 * GET /api/library/hls/variant?slug=&bitrate=&token=&[trackSlug=]
 *
 * Serves an HLS variant playlist for a single bitrate tier.
 * Auth is via the HMAC variant token issued by /api/library/hls — no DB round-trip.
 *
 * The variant playlist lists all segments as presigned R2 URLs (1 h TTL).
 * Segments are AES-128 encrypted; the decryption key is delivered by
 * /api/library/hls/key on a separate short-lived token (10 min).
 *
 * Segment files follow the naming convention set by the worker:
 *   hls/<releaseType>/<slug>/[<trackSlug>/]<bitrate>/init.mp4
 *   hls/<releaseType>/<slug>/[<trackSlug>/]<bitrate>/seg_00001.m4s
 *   ...
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { verifyVariantToken, signKeyToken } from "@/lib/hls/token";
import { createAdminClient } from "@/lib/supabase/admin";
import { createR2SignedGetUrl } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// Segment presigned URL TTL — long enough to survive a full streaming session
const SEGMENT_URL_TTL_SECONDS = 3600; // 1 hour

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

  // Fetch manifest metadata from DB
  const admin = createAdminClient();
  const { data: manifest, error } = await admin
    .from("hls_manifests")
    .select("hls_prefix, segment_duration_secs, duration_seconds, segment_counts")
    .eq("slug", slug)
    .eq("track_slug", trackSlug ?? "")
    .maybeSingle();

  if (error) {
    console.error("[hls/variant] DB error", { slug, trackSlug, message: error.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
  if (!manifest) {
    return cors(req, NextResponse.json({ error: "Manifest not found" }, { status: 404 }));
  }

  const prefix       = manifest.hls_prefix;                    // "hls/singles/my-slug/"
  const segCount     = (manifest.segment_counts?.[bitrate]) ?? 0;
  const segDuration  = manifest.segment_duration_secs ?? 6;
  const totalDur     = manifest.duration_seconds ?? 0;

  if (segCount === 0) {
    return cors(req, NextResponse.json({ error: "No segments for this bitrate" }, { status: 404 }));
  }

  // Build R2 keys for all segments of this bitrate (MPEG-TS)
  const segKeys = Array.from({ length: segCount }, (_, i) =>
    `${prefix}${bitrate}/seg_${String(i + 1).padStart(5, "0")}.ts`
  );

  // Sign all presigned URLs concurrently
  const segUrls = await Promise.all(
    segKeys.map((k) => createR2SignedGetUrl(k, SEGMENT_URL_TTL_SECONDS))
  );

  // Issue a key-delivery token (10 min) for the AES-128 decryption key
  const keyToken  = await signKeyToken({ slug, trackSlug, userId: payload.userId });
  const keyParams = new URLSearchParams({ token: keyToken });
  const keyUrl    = `${origin}/api/library/hls/key?${keyParams}`;

  // Derive the IV for this track (hex, 32 chars = 16 bytes)
  // IV is derived server-side and embedded in the playlist — no DB storage.
  const { deriveHLSIV } = await import("@/lib/hls/derive-key");
  const ivBuf = await deriveHLSIV(slug, trackSlug);
  const ivHex = ivBuf.toString("hex");

  // Build variant playlist (MPEG-TS, HLS v3 — no init segment needed)
  const targetDuration = segDuration;
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "",
    // AES-128 encryption — key rotates per track, not per segment
    `#EXT-X-KEY:METHOD=AES-128,URI="${keyUrl}",IV=0x${ivHex}`,
    "",
  ];

  for (let i = 0; i < segUrls.length; i++) {
    // Last segment may be shorter than segDuration
    const isLast = i === segUrls.length - 1;
    const segDur = isLast && totalDur > 0
      ? Math.max(0.001, totalDur - (segDuration * i)).toFixed(6)
      : segDuration.toFixed(6);

    lines.push(`#EXTINF:${segDur},`, segUrls[i]);
  }

  lines.push("#EXT-X-ENDLIST");

  return cors(
    req,
    new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/x-mpegURL",
        // Allow hls.js to cache variant playlists briefly (segments are immutable)
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}
