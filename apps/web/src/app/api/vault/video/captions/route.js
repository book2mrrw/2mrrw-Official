/**
 * GET /api/vault/video/captions?slug=<contentSlug>
 *
 * Caption/subtitle delivery for vault long-form video content.
 * Returns the WebVTT file for the requested content when one exists in R2.
 *
 * Auth gate: same vault entitlement as /api/vault/video/manifest.
 * Captions are not a separate purchase — they're included with the content.
 *
 * Architecture note:
 *   This endpoint establishes the caption infrastructure even when current assets
 *   lack caption files. When hls_manifests.vtt_key is NULL, returns 204 No Content.
 *   hls.js treats 204 as "no subtitles" and does not show the track selector.
 *
 * Caption file location (when available):
 *   R2: captions/{contentSlug}/{contentSlug}.vtt
 *
 * The master playlist (/api/vault/video/manifest) includes:
 *   #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",
 *                DEFAULT=YES,AUTOSELECT=YES,URI="<this endpoint URL>"
 *
 * Rate limit: 30/60s per user (same as manifest — captions are per-session).
 */

import { NextResponse } from "next/server";
import { applyMediaCors, mediaCorsPreflightResponse } from "@/lib/server/media-cors";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getGuestUser } from "@/lib/guest-session";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { canAccessVaultTier, getActiveMembership } from "@/lib/commerce/entitlements";
import { getUserVaultAccess } from "@/lib/vault/access";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

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

  // ── Auth ────────────────────────────────────────────────────────────────────
  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  if (!user) {
    return cors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  // ── Rate limit ──────────────────────────────────────────────────────────────
  const rl = await checkRateLimit(req, {
    routeKey: "vault.video.captions",
    limit: 30,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return cors(req, rateLimitResponse(rl.retryAfterSeconds));

  const admin = getAdminClient();

  // ── Vault entitlement (same gate as manifest) ────────────────────────────────
  if (!isAdminUser(user)) {
    const { data: content, error: contentErr } = await admin
      .from("vault_content")
      .select("access_tier")
      .eq("slug", contentSlug)
      .maybeSingle();

    if (contentErr) {
      return cors(req, NextResponse.json({ error: "Internal error" }, { status: 500 }));
    }
    if (!content) {
      return cors(req, NextResponse.json({ error: "Content not found" }, { status: 404 }));
    }

    const membership = await getActiveMembership(user.id);
    const vaultAccess = await getUserVaultAccess(admin, user.id, membership);
    if (!canAccessVaultTier(vaultAccess.tier, content.access_tier)) {
      return cors(req, new NextResponse(null, { status: 403 }));
    }
  }

  // ── Look up vtt_key from hls_manifests ──────────────────────────────────────
  const { data: manifest } = await admin
    .from("hls_manifests")
    .select("vtt_key")
    .eq("slug", contentSlug)
    .is("track_slug", null)
    .maybeSingle();

  const vttKey = manifest?.vtt_key || null;

  // No caption file registered — return 204 (hls.js skips the track gracefully)
  if (!vttKey) {
    return cors(req, new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=3600" },
    }));
  }

  // ── Fetch VTT from R2 ────────────────────────────────────────────────────────
  try {
    if (!R2_BUCKET) throw new Error("R2_BUCKET not configured");

    const { Body, ContentLength } = await r2Client.send(
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: vttKey })
    );
    if (!Body) throw new Error("Empty VTT body");

    const chunks = [];
    for await (const chunk of Body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const vttContent = Buffer.concat(chunks);

    return cors(
      req,
      new NextResponse(vttContent, {
        status: 200,
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Content-Length": String(ContentLength ?? vttContent.length),
          "Cache-Control": "private, max-age=28800",
          "X-Content-Type-Options": "nosniff",
        },
      })
    );
  } catch (err) {
    console.error("[vault/video/captions] VTT fetch failed", { contentSlug, vttKey, error: err.message });
    // Fail gracefully: return 204 so hls.js skips subtitles rather than erroring.
    return cors(req, new NextResponse(null, { status: 204 }));
  }
}
