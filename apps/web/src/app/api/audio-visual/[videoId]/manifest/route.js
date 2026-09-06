/**
 * GET /api/audio-visual/[videoId]/manifest
 *
 * Serves an HLS master playlist for a purchased/entitled Audio Visual
 * video's CURRENT (promoted, status='ready') asset version. Auth gate:
 * userCanWatchAudioVisual's `full` flag — Peek is a separate, unrelated,
 * always-allowed derivative and never touches this route.
 *
 * Mirrors src/app/api/vault/video/manifest/route.js's shape (auth →
 * lookup → sign per-variant tokens → build master playlist), adapted for
 * Audio Visual's codec-generic, multi-rendition-per-version model instead
 * of Vault's single-ladder bitrate model.
 */
import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getGuestUser } from "@/lib/guest-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { userCanWatchAudioVisual } from "@/lib/audio-visual/entitlements";
import { signAudioVisualVariantToken } from "@/lib/audio-visual/video-token";
import { buildAudioVisualMasterPlaylist } from "@/lib/audio-visual/hls-playlist";

export const dynamic = "force-dynamic";

function cors(req, res) {
  return applyMediaCors(req, res);
}

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

export async function GET(req, { params }) {
  const { videoId } = await params;
  if (!videoId) {
    return cors(req, NextResponse.json({ error: "videoId required" }, { status: 400 }));
  }

  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  if (!user) {
    return cors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const rl = await checkRateLimit(req, {
    routeKey: "audio-visual.manifest",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  const admin = getAdminClient();

  const { data: audioVisual, error: avErr } = await admin
    .from("audio_visuals")
    .select("id, current_version_id, publication_state")
    .eq("id", videoId)
    .maybeSingle();

  if (avErr) {
    console.error("[audio-visual/manifest] DB error fetching audio_visuals row", { videoId, error: avErr.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
  if (!audioVisual || !audioVisual.current_version_id || !["ready", "published"].includes(audioVisual.publication_state)) {
    return cors(req, NextResponse.json({ error: "Video not available" }, { status: 404 }));
  }

  const access = await userCanWatchAudioVisual(user.id, videoId, admin);
  if (!access.full) {
    return cors(req, NextResponse.json({ error: "Audio Visual entitlement required", tier: access.tier }, { status: 403 }));
  }

  const { data: renditions, error: renditionsErr } = await admin
    .from("audio_visual_renditions")
    .select("codec_family, resolution_label, hdr_mode")
    .eq("asset_version_id", audioVisual.current_version_id);

  if (renditionsErr) {
    console.error("[audio-visual/manifest] DB error fetching renditions", { videoId, error: renditionsErr.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
  if (!renditions?.length) {
    return cors(req, NextResponse.json({ error: "No renditions available for this version" }, { status: 404 }));
  }

  const origin = req.nextUrl.origin;
  const assetVersionId = audioVisual.current_version_id;

  const tokens = await Promise.all(
    renditions.map((r) =>
      signAudioVisualVariantToken({
        videoId, assetVersionId, codecFamily: r.codec_family, resolutionLabel: r.resolution_label, userId: user.id,
      })
    )
  );

  const playlist = buildAudioVisualMasterPlaylist({
    renditions,
    variantUrlForRendition: (r) => {
      const index = renditions.indexOf(r);
      const params2 = new URLSearchParams({
        videoId, assetVersionId, codecFamily: r.codec_family, resolutionLabel: r.resolution_label, token: tokens[index],
      });
      return `${origin}/api/audio-visual/${videoId}/variant?${params2}`;
    },
  });

  return cors(
    req,
    new NextResponse(playlist, {
      status: 200,
      headers: {
        "Content-Type": "application/x-mpegURL",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}
