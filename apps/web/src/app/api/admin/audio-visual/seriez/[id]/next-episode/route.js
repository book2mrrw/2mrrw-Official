/**
 * GET /api/admin/audio-visual/seriez/[id]/next-episode?season=N
 *
 * Answers "what episode number comes next" for a Seriez+season, so the
 * upload flow never makes an admin predetermine or manually track how many
 * episodes a Seriez will have — it just looks at what's already there and
 * suggests max(episode_number)+1, or 1 if the season has none yet. Purely
 * a suggestion returned to the client; the actual draft-creation route
 * still accepts (and the DB still enforces uniqueness on) whatever
 * season/episode number is actually submitted, so this can always be
 * overridden.
 */
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.audio-visual.seriez.next-episode",
    limit: 60,
    windowSeconds: 60,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id: seriezId } = await params;
  const season = Number(new URL(req.url).searchParams.get("season")) || 1;

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("audio_visuals")
    .select("episode_number")
    .eq("seriez_id", seriezId)
    .eq("season_number", season)
    .order("episode_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[admin/audio-visual/seriez/next-episode] lookup error", error.message);
    return NextResponse.json({ error: "Failed to look up existing episodes" }, { status: 500 });
  }

  const nextEpisodeNumber = (data?.episode_number || 0) + 1;
  return NextResponse.json({ season_number: season, next_episode_number: nextEpisodeNumber });
}
