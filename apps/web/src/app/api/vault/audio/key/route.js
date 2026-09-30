/**
 * GET /api/vault/audio/key?token=<token>
 *
 * Delivers the raw 16-byte AES-128 key for a vault audio stream.
 * Auth is the vault-audio key token (7.75 h TTL) issued by
 * /api/vault/audio/variant. hls.js calls this automatically when it reads the
 * playlist's #EXT-X-KEY tag.
 *
 * The key is derived from HLS_MASTER_SECRET + contentSlug and never stored —
 * the same derivation the worker used to encrypt the segments, which is why
 * the job row's slug has to be the slug the player asks for.
 *
 * Type discrimination: verifyVaultAudioKeyToken accepts only "vault_ak". A
 * release key token ("key") and a vault video key token ("vault_k") both fail,
 * so a token minted for one pipeline cannot pull a key out of another.
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { verifyVaultAudioKeyToken } from "@/lib/vault/vault-audio-token";
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

  const payload = await verifyVaultAudioKeyToken(token);
  if (!payload) {
    // 403 rather than 401 so hls.js treats it as fatal and runs its renewal
    // flow instead of retrying the same dead token.
    return cors(req, new NextResponse(null, { status: 403 }));
  }

  const rl = await checkRateLimit(req, {
    routeKey: "vault.audio.key",
    limit: 30,
    windowSeconds: 60,
    identifier: payload.userId,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

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
