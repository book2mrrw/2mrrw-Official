/**
 * GET /api/vault/video/key?token=<token>
 *
 * Delivers the raw 16-byte AES-128 decryption key for a vault video HLS stream.
 * Auth is via the HMAC vault-key token (7.75 h TTL) issued by /api/vault/video/variant.
 *
 * hls.js calls this URL automatically when it processes an #EXT-X-KEY tag.
 * The key is derived deterministically from HLS_MASTER_SECRET + contentSlug
 * (same HKDF function used for audio) — never stored.
 *
 * Type discrimination: verifyVaultVideoKeyToken checks type === "vault_k".
 * Audio tokens (type === "key") are rejected — vault keys cannot be replayed
 * against the audio key endpoint and vice versa.
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { verifyVaultVideoKeyToken } from "@/lib/hls/vault-video-token";
import { deriveHLSKey } from "@/lib/hls/derive-key";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

function cors(req, res) {
  return applyMediaCors(req, res);
}

export async function OPTIONS(req) {
  return mediaCorsPreflightResponse(req);
}

export async function GET(req) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return cors(req, new NextResponse(null, { status: 400 }));
  }

  // Verify vault key token — type "vault_k" only; audio tokens ("key") are rejected
  const payload = await verifyVaultVideoKeyToken(token);
  if (!payload) {
    // 403 (not 401) so hls.js treats it as fatal and triggers the renewal flow
    return cors(req, new NextResponse(null, { status: 403 }));
  }

  const rl = await checkRateLimit(req, {
    routeKey: "vault.video.key",
    limit: 30,
    windowSeconds: 60,
    identifier: payload.userId,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  // Derive AES-128 key from HLS_MASTER_SECRET + contentSlug (deterministic, never stored)
  const keyBuffer = await deriveHLSKey(payload.contentSlug, null);

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
