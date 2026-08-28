/**
 * GET /api/vault/video/variant?slug=&bitrate=&token=
 *
 * Serves an HLS variant playlist for a single bitrate tier of a vault video.
 * Auth is via the vault-specific HMAC variant token issued by /api/vault/video/manifest.
 * No DB round-trip on the critical path — the token carries entitlement proof.
 *
 * Segments are served as public Cloudflare CDN URLs (encrypted with AES-128).
 * The decryption key is delivered by /api/vault/video/key — auth-gated endpoint.
 * Public CDN URLs for encrypted content are safe: without the key they are useless.
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { verifyVaultVideoVariantToken, signVaultVideoKeyToken } from "@/lib/hls/vault-video-token";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getOrFetchManifest } from "@/lib/server/hls-manifest-cache";
import { deriveHLSIV } from "@/lib/hls/derive-key";

export const dynamic = "force-dynamic";

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
  const contentSlug = searchParams.get("slug");
  const bitrate     = searchParams.get("bitrate");
  const token       = searchParams.get("token");

  if (!contentSlug || !bitrate || !token) {
    return cors(req, NextResponse.json({ error: "slug, bitrate, and token required" }, { status: 400 }));
  }

  // Verify vault variant token — type-checks "vault_v" so audio tokens are rejected
  const payload = await verifyVaultVideoVariantToken(token);
  if (!payload || payload.contentSlug !== contentSlug || payload.bitrate !== bitrate) {
    return cors(req, NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }));
  }

  const rl = await checkRateLimit(req, {
    routeKey: "vault.video.variant",
    limit: 120,
    windowSeconds: 60,
    identifier: payload.userId,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  // Fetch manifest from cache — O(1) on warm paths
  let manifest;
  try {
    manifest = await getOrFetchManifest(contentSlug, null, async () => {
      const admin = getAdminClient();
      const { data, error } = await admin
        .from("hls_manifests")
        .select("bitrates, segment_duration_secs, duration_seconds, hls_prefix, segment_counts, poster_key, vtt_key, media_kind, segment_durations, rendition_metadata, source_metadata, transcode_profile_version")
        .eq("slug", contentSlug)
        .is("track_slug", null)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    });
  } catch (err) {
    console.error("[vault/video/variant] DB error", { contentSlug, error: err.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }

  if (!manifest) {
    return cors(req, NextResponse.json({ error: "Manifest not found" }, { status: 404 }));
  }
  if (manifest.media_kind && manifest.media_kind !== "video") {
    return cors(req, NextResponse.json({ error: "Video manifest not found" }, { status: 404 }));
  }

  const prefix     = manifest.hls_prefix;
  const segCount   = (manifest.segment_counts?.[bitrate]) ?? 0;
  const segDuration = manifest.segment_duration_secs ?? 6;
  const totalDur   = manifest.duration_seconds ?? 0;
  const exactDurations = Array.isArray(manifest.segment_durations?.[bitrate])
    && manifest.segment_durations[bitrate].length === segCount
    ? manifest.segment_durations[bitrate]
    : null;

  if (segCount === 0) {
    return cors(req, NextResponse.json({ error: "No segments for this bitrate" }, { status: 404 }));
  }

  // Issue a vault key-delivery token — separate namespace from audio keys
  const keyToken = await signVaultVideoKeyToken({ contentSlug, userId: payload.userId });
  const keyParams = new URLSearchParams({ token: keyToken });
  const keyUrl   = `${origin}/api/vault/video/key?${keyParams}`;

  // Derive the AES-128 IV deterministically from the content slug
  // Using the same HKDF derivation as the audio pipeline (slug is the discriminator)
  const ivBuf = await deriveHLSIV(contentSlug, null);
  const ivHex = ivBuf.toString("hex");

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    `#EXT-X-TARGETDURATION:${segDuration}`,
    "#EXT-X-INDEPENDENT-SEGMENTS",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "",
    `#EXT-X-KEY:METHOD=AES-128,URI="${keyUrl}",IV=0x${ivHex}`,
    "",
  ];

  for (let i = 0; i < segCount; i++) {
    const segNum  = String(i + 1).padStart(5, "0");
    const segUrl  = `${R2_CDN}/${prefix}${bitrate}/seg_${segNum}.ts`;
    const isLast  = i === segCount - 1;
    const exactDuration = Number(exactDurations?.[i]);
    const segDur = Number.isFinite(exactDuration) && exactDuration > 0
      ? exactDuration.toFixed(6)
      : isLast && totalDur > 0
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
        "Cache-Control": "private, max-age=28500",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}
