/**
 * GET /api/vault/audio/variant?slug=&bitrate=&token=
 *
 * Serves the HLS variant playlist for one rung of a vault audio item.
 * Auth is the vault-audio HMAC token issued by /api/vault/audio/manifest —
 * the token carries the entitlement proof, so there is no entitlement
 * round-trip on the playback path.
 *
 * Segments are AES-128 encrypted and served from the public CDN, exactly as
 * release segments are: without the key they are noise, and putting them
 * behind signed URLs would cost every listener the CDN for no security gain.
 * The key comes from /api/vault/audio/key, which is auth-gated.
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { verifyVaultAudioVariantToken, signVaultAudioKeyToken } from "@/lib/vault/vault-audio-token";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { VAULT_AUDIO_RELEASE_TYPE } from "@/lib/vault/vault-audio-contract";
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

  // Type-checks "vault_a": a release stream token or a vault video token is
  // rejected here even though all three are signed with the same secret.
  const payload = await verifyVaultAudioVariantToken(token);
  if (!payload || payload.contentSlug !== contentSlug || payload.bitrate !== bitrate) {
    return cors(req, NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }));
  }

  const rl = await checkRateLimit(req, {
    routeKey: "vault.audio.variant",
    limit: 120,
    windowSeconds: 60,
    identifier: payload.userId,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  const admin = getAdminClient();
  const { data: manifest, error } = await admin
    .from("hls_manifests")
    .select("segment_duration_secs, duration_seconds, hls_prefix, segment_counts")
    .eq("slug", contentSlug)
    .is("track_slug", null)
    .eq("release_type", VAULT_AUDIO_RELEASE_TYPE)
    .maybeSingle();

  if (error) {
    console.error("[vault/audio/variant] DB error", { contentSlug, error: error.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
  if (!manifest) {
    return cors(req, NextResponse.json({ error: "Manifest not found" }, { status: 404 }));
  }

  const prefix      = manifest.hls_prefix;
  const segCount    = manifest.segment_counts?.[bitrate] ?? 0;
  const segDuration = manifest.segment_duration_secs ?? 6;
  const totalDur    = Number(manifest.duration_seconds) || 0;

  if (segCount === 0) {
    return cors(req, NextResponse.json({ error: "No segments for this bitrate" }, { status: 404 }));
  }

  const keyToken  = await signVaultAudioKeyToken({ contentSlug, userId: payload.userId });
  const keyParams = new URLSearchParams({ token: keyToken });
  const keyUrl    = `${origin}/api/vault/audio/key?${keyParams}`;

  // Same derivation the worker used when it encrypted these segments: the
  // content slug is the discriminator on both sides.
  const ivHex = (await deriveHLSIV(contentSlug, null)).toString("hex");

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
    const segNum = String(i + 1).padStart(5, "0");
    const isLast = i === segCount - 1;
    // The closing segment is whatever is left over, not a full interval —
    // declaring it full would make the player seek past the end of the audio.
    const segDur = isLast && totalDur > 0
      ? Math.max(0.001, totalDur - segDuration * i).toFixed(6)
      : segDuration.toFixed(6);

    lines.push(`#EXTINF:${segDur},`, `${R2_CDN}/${prefix}${bitrate}/seg_${segNum}.ts`);
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
