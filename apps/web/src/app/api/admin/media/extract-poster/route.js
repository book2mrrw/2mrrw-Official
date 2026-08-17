/**
 * POST /api/admin/media/extract-poster
 *
 * Admin-only ingest-time endpoint: marks a vault video manifest row as
 * needing a poster frame, or clears the status once the poster has been
 * registered externally.
 *
 * Actual poster extraction (ffmpeg) runs in the Fly.io worker or a
 * local dev environment with ffmpeg on PATH — NOT inside this Vercel function,
 * because ffmpeg is not available in the Vercel Node.js runtime.
 *
 * Worker / CLI poster extraction:
 *   node scripts/extract-poster.mjs --slug <slug> --releaseType <type> [--position <seconds>]
 *
 * After the worker generates the poster, it calls this endpoint with action="register"
 * to write the confirmed poster_key to hls_manifests.
 *
 * Body (JSON):
 * {
 *   action:         "register" | "needs_poster" | "status"
 *   manifestSlug:   string   — slug key in hls_manifests
 *   posterKey?:     string   — R2 key (required for action="register")
 * }
 *
 * Returns:
 *   { ok, status, posterKey?, message? }
 */

import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPublicR2Url } from "@/lib/storage/r2";

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export const dynamic = "force-dynamic";

export async function POST(req) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) return json({ error: "Forbidden" }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, manifestSlug, posterKey } = body;

  if (!manifestSlug) return json({ error: "manifestSlug required" }, 400);

  const admin = getAdminClient();

  // ── status: read current poster state ──────────────────────────────────────
  if (action === "status" || !action) {
    const { data, error } = await admin
      .from("hls_manifests")
      .select("poster_key, poster_status, vtt_key")
      .eq("slug", manifestSlug)
      .is("track_slug", null)
      .maybeSingle();

    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "Manifest not found" }, 404);

    return json({
      ok: true,
      manifestSlug,
      posterKey: data.poster_key ?? null,
      posterUrl: data.poster_key ? getPublicR2Url(data.poster_key) : null,
      posterStatus: data.poster_status ?? null,
      vttKey: data.vtt_key ?? null,
      extractionNote:
        "Poster extraction runs via the Fly.io worker or: node scripts/extract-poster.mjs --slug " +
        manifestSlug,
    });
  }

  // ── needs_poster: flag for worker pickup ────────────────────────────────────
  if (action === "needs_poster") {
    const { error } = await admin
      .from("hls_manifests")
      .update({ poster_status: "needs_poster" })
      .eq("slug", manifestSlug)
      .is("track_slug", null);

    if (error) return json({ error: error.message }, 500);
    return json({
      ok: true,
      status: "needs_poster",
      message: "Poster extraction queued. Run the worker or: node scripts/extract-poster.mjs --slug " + manifestSlug,
    });
  }

  // ── register: worker writes completed poster_key back to DB ─────────────────
  if (action === "register") {
    if (!posterKey) return json({ error: "posterKey required for action=register" }, 400);

    const cleanKey = String(posterKey).replace(/^\//, "");
    const { error } = await admin
      .from("hls_manifests")
      .update({
        poster_key: cleanKey,
        poster_status: "ready",
      })
      .eq("slug", manifestSlug)
      .is("track_slug", null);

    if (error) return json({ error: error.message }, 500);
    return json({
      ok: true,
      status: "ready",
      posterKey: cleanKey,
      posterUrl: getPublicR2Url(cleanKey),
    });
  }

  return json({ error: "Unknown action. Use: status | needs_poster | register" }, 400);
}
