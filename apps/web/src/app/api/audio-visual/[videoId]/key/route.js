/**
 * GET /api/audio-visual/[videoId]/key?token=<token>
 *
 * Delivers the raw 16-byte AES-128 decryption key for one Audio Visual
 * (videoId, assetVersionId) pair. Auth is via the HMAC key token issued by
 * the variant route — no DB round-trip, key is derived deterministically
 * (never stored) from HLS_MASTER_SECRET, matching packaging.js's worker-
 * side derivation exactly (see derive-key.js's own cross-implementation
 * test). Mirrors src/app/api/vault/video/key/route.js's shape.
 */
import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { verifyAudioVisualKeyToken } from "@/lib/audio-visual/video-token";
import { deriveAudioVisualHLSKey } from "@/lib/audio-visual/derive-key";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

function cors(req, res) {
  return applyMediaCors(req, res);
}

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

export async function GET(req, { params }) {
  const { videoId } = await params;
  const token = req.nextUrl.searchParams.get("token");
  if (!videoId || !token) {
    return cors(req, new NextResponse(null, { status: 400 }));
  }

  const payload = await verifyAudioVisualKeyToken(token);
  if (!payload || payload.videoId !== videoId) {
    // 403 (not 401) so hls.js treats it as fatal and triggers its renewal flow.
    return cors(req, new NextResponse(null, { status: 403 }));
  }

  const rl = await checkRateLimit(req, {
    routeKey: "audio-visual.key",
    limit: 30,
    windowSeconds: 60,
    identifier: payload.userId,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  const keyBuffer = await deriveAudioVisualHLSKey(payload.videoId, payload.assetVersionId);

  return cors(
    req,
    new NextResponse(keyBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "16",
        "Cache-Control": "private, max-age=27900",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}
