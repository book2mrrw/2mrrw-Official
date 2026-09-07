/**
 * POST /api/admin/audio-visual/draft
 *
 * Creates the initial audio_visuals row — mirrors
 * /api/admin/releases/draft's own title-to-slug + dedup logic exactly (same
 * SLUG_RE, same numeric-suffix dedup loop, same random fallback), but is a
 * fully separate, isolated implementation: this route never imports from or
 * writes to anything release/track-shaped beyond a single read-only lookup
 * of a linked track's own slug (see below).
 *
 * This is the actual first step of the Audio Visualz upload flow — nothing
 * before this creates the row that every later upload/completion route
 * (presigned, complete) requires to already exist.
 */
import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
const VIDEO_TYPES = ["music_video", "podcast", "interview", "movie", "documentary", "vlog", "concert", "short_film"];

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function POST(req) {
  const user = await getAdminSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.audio-visual.draft",
    limit: 20,
    windowSeconds: 300,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  let body;
  try { body = await req.json(); } catch { body = {}; }

  const { title, video_type: videoType, track_id: trackId, release_id: releaseId, seriez_id: seriezId, season_number: seasonNumber, episode_number: episodeNumber } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!VIDEO_TYPES.includes(videoType)) {
    return NextResponse.json({ error: `video_type must be one of: ${VIDEO_TYPES.join(", ")}` }, { status: 400 });
  }
  if (seriezId && (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber))) {
    return NextResponse.json({ error: "season_number and episode_number are both required when attaching to a Seriez" }, { status: 400 });
  }

  const admin = getAdminClient();

  if (seriezId) {
    const { data: seriez, error: seriezErr } = await admin.from("audio_visual_seriez").select("id").eq("id", seriezId).maybeSingle();
    if (seriezErr) {
      return NextResponse.json({ error: "Failed to look up Seriez" }, { status: 500 });
    }
    if (!seriez) {
      return NextResponse.json({ error: "Seriez not found" }, { status: 404 });
    }
  }

  // Audio Visualz (music_video) linked to a real track derives its slug
  // from that track's OWN slug plus a short suffix, rather than an
  // independently-slugified title — this gives the tracklist "video icon"
  // a reliable, guessable mapping from track to video instead of two
  // independently-named things that could drift apart. This is the one
  // read-only cross-reference this route makes into track data; it never
  // writes to tracks/releases.
  let baseSlugCandidate;
  if (videoType === "music_video" && trackId) {
    const { data: track, error: trackErr } = await admin.from("tracks").select("slug").eq("id", trackId).maybeSingle();
    if (trackErr) {
      console.error("[admin/audio-visual/draft] track lookup error", trackErr.message);
      return NextResponse.json({ error: "Failed to look up track for slug derivation" }, { status: 500 });
    }
    if (!track?.slug) {
      return NextResponse.json({ error: "Linked track has no slug yet" }, { status: 400 });
    }
    baseSlugCandidate = `${track.slug}-av`;
  } else {
    baseSlugCandidate = slugify(title);
  }

  let slug;
  if (baseSlugCandidate && SLUG_RE.test(baseSlugCandidate)) {
    let candidate = baseSlugCandidate;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const { data: existing } = await admin.from("audio_visuals").select("id").eq("slug", candidate).maybeSingle();
      if (!existing) { slug = candidate; break; }
      candidate = `${baseSlugCandidate}-${attempt + 1}`;
    }
  }
  if (!slug) {
    slug = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const { data, error } = await admin
    .from("audio_visuals")
    .insert({
      title: title.trim(),
      video_type: videoType,
      slug,
      track_id: trackId || null,
      release_id: releaseId || null,
      seriez_id: seriezId || null,
      season_number: seriezId ? seasonNumber : null,
      episode_number: seriezId ? episodeNumber : null,
      price_cents: 0,
      publication_state: "draft",
    })
    .select("id, slug, video_type, seriez_id")
    .single();

  if (error) {
    console.error("[admin/audio-visual/draft] insert error", error.message);
    return NextResponse.json({ error: "Failed to create draft" }, { status: 500 });
  }

  return NextResponse.json({ video_id: data.id, slug: data.slug, video_type: data.video_type, seriez_id: data.seriez_id });
}
