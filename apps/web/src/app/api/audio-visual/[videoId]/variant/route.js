/**
 * GET /api/audio-visual/[videoId]/variant?assetVersionId=&codecFamily=&resolutionLabel=&token=
 *
 * Serves one rendition's already-packaged HLS child playlist (encrypted
 * fMP4/CMAF segments — see workers/hls-transcoder/src/engine/packaging.js).
 * Auth is via the HMAC variant token issued by the manifest route — no DB
 * round-trip on the critical auth path, mirroring Vault's video variant
 * route exactly.
 *
 * Unlike Vault's variant route (which reconstructs the child playlist text
 * from a bitrate/segment-count naming convention), this route re-serves
 * the REAL, already-correct playlist file the worker wrote to R2 — it
 * only needs to substitute the placeholder key URI for a real, per-user
 * signed one (see hls-playlist.js's rewritePlaylistKeyUri).
 *
 * Segment/init/playlist objects are fetched from R2's public CDN URL —
 * safe because they're AES-128 encrypted; without the key (gated
 * separately, at /key) they're useless, exactly the same reasoning
 * already established for Vault's own video segments.
 */
import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getPublicR2Url } from "@/lib/storage/r2";
import { verifyAudioVisualVariantToken, signAudioVisualKeyToken } from "@/lib/audio-visual/video-token";
import { rewritePlaylistKeyUri } from "@/lib/audio-visual/hls-playlist";

export const dynamic = "force-dynamic";

function cors(req, res) {
  return applyMediaCors(req, res);
}

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

export async function GET(req, { params }) {
  const { videoId } = await params;
  const { searchParams, origin } = req.nextUrl;
  const assetVersionId = searchParams.get("assetVersionId");
  const codecFamily = searchParams.get("codecFamily");
  const resolutionLabel = searchParams.get("resolutionLabel");
  const token = searchParams.get("token");

  if (!videoId || !assetVersionId || !codecFamily || !resolutionLabel || !token) {
    return cors(req, NextResponse.json({ error: "videoId, assetVersionId, codecFamily, resolutionLabel, and token required" }, { status: 400 }));
  }

  const payload = await verifyAudioVisualVariantToken(token);
  if (
    !payload ||
    payload.videoId !== videoId ||
    payload.assetVersionId !== assetVersionId ||
    payload.codecFamily !== codecFamily ||
    payload.resolutionLabel !== resolutionLabel
  ) {
    return cors(req, NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }));
  }

  const rl = await checkRateLimit(req, {
    routeKey: "audio-visual.variant",
    limit: 120,
    windowSeconds: 60,
    identifier: payload.userId,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  const admin = getAdminClient();
  const { data: rendition, error: renditionErr } = await admin
    .from("audio_visual_renditions")
    .select("hls_prefix")
    .eq("asset_version_id", assetVersionId)
    .eq("codec_family", codecFamily)
    .eq("resolution_label", resolutionLabel)
    .maybeSingle();

  if (renditionErr) {
    console.error("[audio-visual/variant] DB error fetching rendition", { videoId, error: renditionErr.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }
  if (!rendition?.hls_prefix) {
    return cors(req, NextResponse.json({ error: "Rendition not found" }, { status: 404 }));
  }

  const playlistUrl = getPublicR2Url(`${rendition.hls_prefix}playlist.m3u8`);
  const upstream = await fetch(playlistUrl, { cache: "no-store" });
  if (!upstream.ok) {
    console.error("[audio-visual/variant] upstream R2 fetch failed", { videoId, status: upstream.status });
    return cors(req, NextResponse.json({ error: "Playlist not available" }, { status: 502 }));
  }
  const storedPlaylist = await upstream.text();

  const keyToken = await signAudioVisualKeyToken({ videoId, assetVersionId, userId: payload.userId });
  const keyUrl = `${origin}/api/audio-visual/${videoId}/key?token=${keyToken}`;

  let rewritten;
  try {
    rewritten = rewritePlaylistKeyUri(storedPlaylist, keyUrl);
  } catch (err) {
    console.error("[audio-visual/variant] stored playlist did not match the expected placeholder contract", { videoId, error: err.message });
    return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
  }

  return cors(
    req,
    new NextResponse(rewritten, {
      status: 200,
      headers: {
        "Content-Type": "application/x-mpegURL",
        "Cache-Control": "private, max-age=28500",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}
