/**
 * GET /api/vault/audio/manifest?slug=<contentSlug>
 *
 * Serves an HLS master playlist for a vault audio item.
 * Auth gate: vault tier entitlement (canAccessVaultTier) — NOT release stream
 * entitlement. Owning a song has never granted vault access and does not here.
 *
 * Entitlement hierarchy:
 *   Admin (isAdminUser) → always granted
 *   vault_pass tier     → full access
 *   inner_circle tier   → inner_circle and public content
 *   public tier         → public content only
 *
 * Returns 404 when nothing has been transcoded for this slug yet, so a client
 * can fall back to /api/vault/media while an encode is still running.
 *
 * Manifest lookups here are direct DB reads, deliberately NOT through
 * lib/server/hls-manifest-cache. That cache is keyed on (slug, trackSlug)
 * alone, with no notion of which pipeline owns the row — sharing it would let
 * a manifest cached by another pipeline for the same slug be served as vault
 * audio. Every query below pins release_type = 'vault' instead. The cost is
 * one indexed read per playlist request, which is not a hot path: playlists
 * are issued once per session and cached privately for their token's lifetime.
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getGuestUser } from "@/lib/guest-session";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { canAccessVaultTier, getActiveMembership } from "@/lib/commerce/entitlements";
import { getUserVaultAccess } from "@/lib/vault/access";
import { signVaultAudioVariantToken } from "@/lib/vault/vault-audio-token";
import { VAULT_AUDIO_RELEASE_TYPE } from "@/lib/vault/vault-audio-contract";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** Approximate bandwidth in bits/second for master playlist ABR hints.
 *  Audio rungs only — a video rung reaching this route would mean a job row
 *  was built wrong, and guessing a number for it would hide that. */
const BITRATE_BANDWIDTH = {
  "320k": 360_000,
  "160k": 180_000,
  "96k":  108_000,
  "64k":   74_000,
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

  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  if (!user) {
    return cors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const rl = await checkRateLimit(req, {
    routeKey: "vault.audio.manifest",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  const admin = getAdminClient();

  // ── Vault entitlement ─────────────────────────────────────────────────────
  if (!isAdminUser(user)) {
    const { data: content, error: contentErr } = await admin
      .from("vault_content")
      .select("access_tier, visibility")
      .eq("slug", contentSlug)
      .maybeSingle();

    if (contentErr) {
      console.error("[vault/audio/manifest] DB error fetching content", { contentSlug, error: contentErr.message });
      return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
    }
    if (!content) {
      return cors(req, NextResponse.json({ error: "Content not found" }, { status: 404 }));
    }
    // A draft is finished media that has not been released. Entitlement is not
    // the question; nobody but an admin should reach it at all.
    if (content.visibility !== "published") {
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

  // ── HLS manifest lookup ───────────────────────────────────────────────────
  const { data: manifest, error: manErr } = await admin
    .from("hls_manifests")
    .select("bitrates, segment_duration_secs, duration_seconds, hls_prefix, segment_counts")
    .eq("slug", contentSlug)
    .is("track_slug", null)
    .eq("release_type", VAULT_AUDIO_RELEASE_TYPE)
    .maybeSingle();

  if (manErr) {
    console.error("[vault/audio/manifest] DB error fetching manifest", { contentSlug, error: manErr.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
  if (!manifest) {
    return cors(req, NextResponse.json({ error: "HLS not available for this content" }, { status: 404 }));
  }

  // Only advertise rungs that actually have segments. A ladder change that
  // added a rung to the job list but never finished uploading it would
  // otherwise appear here as a variant that 404s mid-playback.
  const bitrates = (manifest.bitrates ?? []).filter(
    (br) => (manifest.segment_counts?.[br] ?? 0) > 0
  );
  if (!bitrates.length) {
    return cors(req, NextResponse.json({ error: "HLS not available for this content" }, { status: 404 }));
  }

  const origin = req.nextUrl.origin;
  const variantTokens = await Promise.all(
    bitrates.map((br) =>
      signVaultAudioVariantToken({ contentSlug, userId: user.id, bitrate: br })
    )
  );

  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", ""];

  for (let i = 0; i < bitrates.length; i++) {
    const br = bitrates[i];
    const bandwidth = BITRATE_BANDWIDTH[br];
    if (!bandwidth) continue;
    const params = new URLSearchParams({ slug: contentSlug, bitrate: br, token: variantTokens[i] });
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="mp4a.40.2"`,
      `${origin}/api/vault/audio/variant?${params}`
    );
  }

  return cors(
    req,
    new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/x-mpegURL",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
        "X-Duration-Seconds": String(manifest.duration_seconds ?? ""),
      },
    })
  );
}
