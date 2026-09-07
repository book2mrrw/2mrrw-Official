/**
 * GET /api/audio-visual/[videoId]/peek
 *
 * Serves the short, muted Peek preview clip the transcode worker already
 * generates for every video (`peek_r2_key` on the CURRENT asset version) —
 * deliberately unauthenticated: the clip itself is served regardless of
 * whether a session resolves. userCanWatchAudioVisual's `peek` flag is
 * already always-true for any caller (see entitlements.js), so serving the
 * clip never depends on a session lookup.
 *
 * When a session DOES resolve (signed-in or guest, same as /manifest), this
 * also opportunistically includes `{ tier, full }` from userCanWatchAudioVisual
 * plus the video's real `price_cents` — everything the inline preview CTA
 * (peek clip -> "Watch Full" or "Unlock — $X.XX") needs in one call, without
 * a second manifest pre-check round-trip. A fully anonymous caller with no
 * resolvable session still gets the clip, just with tier: null. Never
 * touches the `/manifest` route's `full` gating on the actual HLS stream.
 */
import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getPublicR2Url } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { getGuestUser } from "@/lib/guest-session";
import { userCanWatchAudioVisual } from "@/lib/audio-visual/entitlements";

export const dynamic = "force-dynamic";

export async function GET(req, { params }) {
  const { videoId } = await params;
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "audio-visual.peek",
    limit: 60,
    windowSeconds: 60,
    identifier: req.headers.get("x-forwarded-for") || "anonymous",
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const admin = getAdminClient();

  const { data: audioVisual, error: avErr } = await admin
    .from("audio_visuals")
    .select("id, title, current_version_id, poster_r2_key, publication_state, price_cents")
    .eq("id", videoId)
    .maybeSingle();

  if (avErr) {
    console.error("[audio-visual/peek] DB error fetching audio_visuals row", { videoId, error: avErr.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!audioVisual || !audioVisual.current_version_id || !["ready", "published"].includes(audioVisual.publication_state)) {
    return NextResponse.json({ error: "Video not available" }, { status: 404 });
  }

  const { data: version, error: versionErr } = await admin
    .from("audio_visual_asset_versions")
    .select("peek_r2_key")
    .eq("id", audioVisual.current_version_id)
    .maybeSingle();

  if (versionErr) {
    console.error("[audio-visual/peek] DB error fetching asset version", { videoId, error: versionErr.message });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
  if (!version?.peek_r2_key) {
    return NextResponse.json({ error: "Peek not available for this video" }, { status: 404 });
  }

  const user = (await getFanSessionUser()) ?? (await getGuestUser());
  const access = user ? await userCanWatchAudioVisual(user.id, videoId, admin) : null;

  return NextResponse.json({
    peek_url: getPublicR2Url(version.peek_r2_key),
    poster_url: audioVisual.poster_r2_key ? getPublicR2Url(audioVisual.poster_r2_key) : null,
    title: audioVisual.title,
    price_cents: audioVisual.price_cents ?? 0,
    tier: access?.tier ?? null,
    full: access?.full ?? false,
  });
}
