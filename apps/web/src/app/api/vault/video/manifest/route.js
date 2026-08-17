/**
 * GET /api/vault/video/manifest?slug=<contentSlug>
 *
 * Serves an HLS master playlist for a vault video item.
 * Auth gate: vault tier entitlement (canAccessVaultTier) — NOT audio stream entitlement.
 *
 * Entitlement hierarchy:
 *   Admin (isAdminUser) → always granted
 *   vault_pass tier     → full access
 *   inner_circle tier   → access to inner_circle and public content
 *   public tier         → public content only
 *
 * Returns 404 when no HLS manifest has been transcoded for this slug yet.
 * Client falls back to content_url (direct MP4 via /api/vault/media) automatically.
 *
 * Master playlist → N variant playlists (one per bitrate tier in hls_manifests.bitrates)
 * Each variant URL carries a vault-specific HMAC token (8 h TTL) that authorises
 * /api/vault/video/variant without a DB round-trip.
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getGuestUser } from "@/lib/guest-session";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { canAccessVaultTier, getActiveMembership } from "@/lib/commerce/entitlements";
import { getUserVaultAccess } from "@/lib/vault/access";
import { signVaultVideoVariantToken } from "@/lib/hls/vault-video-token";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getOrFetchManifest } from "@/lib/server/hls-manifest-cache";

export const dynamic = "force-dynamic";

// Approximate bandwidth in bits/second for master playlist ABR hints
const BITRATE_BANDWIDTH = {
  "4000k": 4_200_000,
  "2000k": 2_100_000,
  "1000k": 1_050_000,
  "720k":    756_000,
  "320k":    360_000,
  "160k":    180_000,
  "96k":     108_000,
};

function cors(req, res) {
  return applyMediaCors(req, res);
}

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

export async function GET(req) {
  const { searchParams } = req.nextUrl;
  const contentSlug = searchParams.get("slug");

  if (!contentSlug) {
    return cors(req, NextResponse.json({ error: "slug required" }, { status: 400 }));
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  if (!user) {
    return cors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  // ── Rate limit ────────────────────────────────────────────────────────────────
  const rl = await checkRateLimit(req, {
    routeKey: "vault.video.manifest",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  const admin = getAdminClient();

  // ── Vault entitlement ─────────────────────────────────────────────────────────
  if (!isAdminUser(user)) {
    // Fetch the content's access tier
    const { data: content, error: contentErr } = await admin
      .from("vault_content")
      .select("access_tier")
      .eq("slug", contentSlug)
      .maybeSingle();

    if (contentErr) {
      console.error("[vault/video/manifest] DB error fetching content", { contentSlug, error: contentErr.message });
      return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
    }
    if (!content) {
      return cors(req, NextResponse.json({ error: "Content not found" }, { status: 404 }));
    }

    const membership = await getActiveMembership(user.id);
    const vaultAccess = await getUserVaultAccess(admin, user.id, membership);
    if (!canAccessVaultTier(vaultAccess.tier, content.access_tier)) {
      return cors(req, NextResponse.json({
        error: "Vault entitlement required",
        requiredTier: content.access_tier,
      }, { status: 403 }));
    }
  }

  // ── HLS manifest lookup ───────────────────────────────────────────────────────
  let manifest;
  try {
    manifest = await getOrFetchManifest(contentSlug, null, async () => {
      const { data, error } = await admin
        .from("hls_manifests")
        .select("bitrates, segment_duration_secs, duration_seconds, hls_prefix, segment_counts, poster_key, vtt_key")
        .eq("slug", contentSlug)
        .is("track_slug", null)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    });
  } catch (err) {
    console.error("[vault/video/manifest] DB error fetching manifest", { contentSlug, error: err.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }

  // No manifest → content not yet transcoded to HLS; client falls back to content_url
  if (!manifest) {
    return cors(req, NextResponse.json({ error: "HLS not available for this content" }, { status: 404 }));
  }

  const bitrates  = manifest.bitrates ?? ["320k", "160k", "96k"];
  const vttKey    = manifest.vtt_key || null;
  const posterKey = manifest.poster_key || null;
  const origin    = req.nextUrl.origin;

  // Sign vault-video variant tokens (one per bitrate, concurrent)
  const variantTokens = await Promise.all(
    bitrates.map((br) =>
      signVaultVideoVariantToken({ contentSlug, userId: user.id, bitrate: br })
    )
  );

  // Build HLS master playlist (HLS spec §4.3.4)
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "",
  ];

  // Caption track (HLS spec §4.3.4.1 — EXT-X-MEDIA TYPE=SUBTITLES)
  // Included when a VTT key is registered; absent otherwise (hls.js skips gracefully).
  const captionUrl = `${origin}/api/vault/video/captions?slug=${encodeURIComponent(contentSlug)}`;
  if (vttKey) {
    lines.push(
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="${captionUrl}"`,
      ""
    );
  }

  for (let i = 0; i < bitrates.length; i++) {
    const br        = bitrates[i];
    const bandwidth = BITRATE_BANDWIDTH[br] ?? 2_000_000;
    const token     = variantTokens[i];
    const params    = new URLSearchParams({ slug: contentSlug, bitrate: br, token });
    const variantUrl = `${origin}/api/vault/video/variant?${params}`;

    // Video streams include both video and audio tracks (AVC + AAC)
    const infAttrs = vttKey
      ? `BANDWIDTH=${bandwidth},CODECS="avc1.64001f,mp4a.40.2",SUBTITLES="subs"`
      : `BANDWIDTH=${bandwidth},CODECS="avc1.64001f,mp4a.40.2"`;

    lines.push(`#EXT-X-STREAM-INF:${infAttrs}`, variantUrl);
  }

  // Response headers include X-Poster-URL for player pre-loading the poster image
  const posterUrl = posterKey
    ? (process.env.NEXT_PUBLIC_R2_PUBLIC_URL?.replace(/\/$/, "") || "https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev") + `/${posterKey}`
    : null;

  const responseHeaders = {
    "Content-Type": "application/x-mpegURL",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-Content-Type-Options": "nosniff",
  };
  if (posterUrl) responseHeaders["X-Poster-URL"] = posterUrl;

  return cors(
    req,
    new NextResponse(lines.join("\n"), { status: 200, headers: responseHeaders })
  );
}
