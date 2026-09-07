/**
 * GET /api/audio-visual/browse?type=podcast|interview|...|seriez
 *
 * Public homepage browse listing — real, published content (never a
 * per-item entitlement check here; that stays exactly where it already
 * correctly lives, in manifest/key route access.full gating, not
 * duplicated in a listing endpoint). Peek is always publicly visible by
 * design (userCanWatchAudioVisual: "peek is always allowed for any
 * signed-in caller"), so a poster/peek-level browse listing needs no auth
 * at all.
 *
 * type=seriez is a special, UI-only pseudo-filter: Seriez is a structural
 * container, not a video_type value, but the confirmed homepage design
 * treats it as its own filterable category. That branch lists Seriez
 * containers (title/poster) instead of individual audio_visuals rows.
 * Every other type value lists STANDALONE (seriez_id is null) published
 * rows only — an episode belonging to a Seriez is discovered via its
 * Seriez card, never duplicated into the flat per-type grid too.
 */
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPublicR2Url } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const VIDEO_TYPES = new Set(["music_video", "podcast", "interview", "movie", "documentary", "vlog", "concert", "short_film"]);

export async function GET(req) {
  const rl = await checkRateLimit(req, {
    routeKey: "audio-visual.browse",
    limit: 60,
    windowSeconds: 60,
    identifier: req.headers.get("x-forwarded-for") || "anonymous",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const type = new URL(req.url).searchParams.get("type") || null;
  const admin = getAdminClient();

  if (type === "seriez") {
    // A Seriez surfaces on the homepage once it has at least one published
    // episode — an empty or all-draft Seriez shell stays admin-only.
    const { data: publishedEpisodes, error: episodeErr } = await admin
      .from("audio_visuals")
      .select("seriez_id")
      .eq("publication_state", "published")
      .not("seriez_id", "is", null);
    if (episodeErr) {
      console.error("[audio-visual/browse] seriez episode lookup error", episodeErr.message);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
    const seriezIds = [...new Set((publishedEpisodes || []).map((r) => r.seriez_id))];
    if (seriezIds.length === 0) return NextResponse.json({ items: [] });

    const { data: seriez, error: seriezErr } = await admin
      .from("audio_visual_seriez")
      .select("id, slug, title, poster_r2_key")
      .in("id", seriezIds)
      .order("created_at", { ascending: false });
    if (seriezErr) {
      console.error("[audio-visual/browse] seriez fetch error", seriezErr.message);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }

    return NextResponse.json({
      items: (seriez || []).map((s) => ({
        kind: "seriez",
        seriez_id: s.id,
        slug: s.slug,
        title: s.title,
        poster_url: s.poster_r2_key ? getPublicR2Url(s.poster_r2_key) : null,
      })),
    });
  }

  let query = admin
    .from("audio_visuals")
    .select("id, slug, title, video_type, poster_r2_key")
    .eq("publication_state", "published")
    .is("seriez_id", null)
    .order("created_at", { ascending: false })
    .limit(60);

  if (type && VIDEO_TYPES.has(type)) {
    query = query.eq("video_type", type);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[audio-visual/browse] fetch error", error.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({
    items: (data || []).map((v) => ({
      kind: "video",
      video_id: v.id,
      slug: v.slug,
      title: v.title,
      video_type: v.video_type,
      poster_url: v.poster_r2_key ? getPublicR2Url(v.poster_r2_key) : null,
    })),
  });
}
