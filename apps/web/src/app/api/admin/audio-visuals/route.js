/**
 * GET /api/admin/audio-visuals
 *
 * Lists audio_visuals rows for the "Manage Audio Visualz" admin list view —
 * the Audio Visualz counterpart to /api/admin/releases, but far simpler:
 * one source table, no legacy/wizard union to reconcile.
 */
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getPublicR2Url } from "@/lib/storage/r2";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.audio-visuals.list",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("audio_visuals")
    .select("id, slug, title, video_type, publication_state, poster_r2_key, seriez_id, season_number, episode_number, current_version_id, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[admin/audio-visuals] list error", error.message);
    return NextResponse.json({ error: "Failed to list Audio Visualz" }, { status: 500 });
  }

  // Resolved server-side: r2.js (getPublicR2Url) instantiates an S3 client
  // with server credentials and must never be imported into the client
  // component that renders this list.
  const withUrls = (data || []).map((row) => ({
    ...row,
    poster_url: row.poster_r2_key ? getPublicR2Url(row.poster_r2_key) : null,
  }));

  return NextResponse.json({ audio_visuals: withUrls });
}
