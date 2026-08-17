/**
 * GET /api/library/hls/key?token=<token>
 *
 * Delivers the raw 16-byte AES-128 decryption key for an HLS stream.
 * Auth is via the HMAC key token (10 min TTL) issued by /api/library/hls/variant.
 *
 * hls.js calls this URL automatically when it encounters an #EXT-X-KEY tag.
 * The key is derived deterministically from HLS_MASTER_SECRET + slug — never stored.
 *
 * Content-Type: application/octet-stream  (16 raw bytes, as per HLS spec §5.2)
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { verifyKeyToken } from "@/lib/hls/token";
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

  // Verify HMAC token — covers auth + entitlement (verified at manifest-request time)
  const payload = await verifyKeyToken(token);
  if (!payload) {
    // Return 403 instead of 401 so hls.js treats it as a fatal error (not a retry loop)
    return cors(req, new NextResponse(null, { status: 403 }));
  }

  // Rate limit — keys are fetched once per variant playlist load, not per segment
  const rl = await checkRateLimit(req, {
    routeKey: "library.hls.key",
    limit: 30,
    windowSeconds: 60,
    identifier: payload.userId,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  // Derive the 16-byte AES-128 key deterministically
  const keyBuffer = await deriveHLSKey(payload.slug, payload.trackSlug);

  return cors(
    req,
    new NextResponse(keyBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "16",
        // private: browser-only, no shared-proxy caching.
        // max-age=27900 (7.75 h): aligns with KEY_TTL_SECONDS so the browser cache
        // expires at the same moment the token does — hls.js never attempts to reuse
        // a cached key response after the token has expired, eliminating the 403 that
        // previously terminated sessions open longer than 55 minutes.
        "Cache-Control": "private, max-age=27900",
        "X-Content-Type-Options": "nosniff",
      },
    })
  );
}
