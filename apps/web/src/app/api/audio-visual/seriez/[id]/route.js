/**
 * GET /api/audio-visual/seriez/[id]
 *
 * Public Seriez detail — the container's own info plus its episode list,
 * with the release-cadence logic the homepage design explicitly needed:
 * an episode is either PLAYABLE (publication_state='published') or, if it
 * has a real scheduled_at in the future, shown as UPCOMING with that real
 * date — never a vague "more episodes coming" placeholder. Anything with
 * no schedule yet (draft/processing/ready-unscheduled/failed/unpublished)
 * is excluded entirely rather than shown as a confusing unstamped slot —
 * the whole point is a viewer is never left guessing what's actually
 * coming and when.
 */
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPublicR2Url } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { resolveVisibleEpisodes } from "@/lib/audio-visual/seriez-cadence";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const rl = await checkRateLimit(req, {
    routeKey: "audio-visual.seriez.detail",
    limit: 60,
    windowSeconds: 60,
    identifier: req.headers.get("x-forwarded-for") || "anonymous",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id: seriezId } = await params;
  const admin = getAdminClient();

  const { data: seriez, error: seriezErr } = await admin
    .from("audio_visual_seriez")
    .select("id, slug, title, description, poster_r2_key")
    .eq("id", seriezId)
    .maybeSingle();
  if (seriezErr) {
    console.error("[audio-visual/seriez/detail] seriez fetch error", seriezErr.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!seriez) {
    return NextResponse.json({ error: "Seriez not found" }, { status: 404 });
  }

  const { data: episodes, error: episodesErr } = await admin
    .from("audio_visuals")
    .select("id, slug, title, video_type, publication_state, scheduled_at, season_number, episode_number, poster_r2_key")
    .eq("seriez_id", seriezId)
    .order("season_number", { ascending: true })
    .order("episode_number", { ascending: true });
  if (episodesErr) {
    console.error("[audio-visual/seriez/detail] episodes fetch error", episodesErr.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const visibleEpisodes = resolveVisibleEpisodes(episodes, Date.now(), getPublicR2Url);

  return NextResponse.json({
    seriez: {
      seriez_id: seriez.id,
      slug: seriez.slug,
      title: seriez.title,
      description: seriez.description,
      poster_url: seriez.poster_r2_key ? getPublicR2Url(seriez.poster_r2_key) : null,
    },
    episodes: visibleEpisodes,
  });
}
