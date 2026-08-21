import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { clearPersistedPlaybackKey } from "@/lib/playback/resolve-playback-key";

export const dynamic = "force-dynamic";

const RELEASE_TYPE_FOLDERS = {
  single:  "singles",
  feature: "features",
  album:   "albums",
  ep:      "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
};

export async function POST(req, { params }) {
  const user = await getFanSessionUser();
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await checkRateLimit(req, {
    routeKey: "admin.releases.replace-master",
    limit: 10,
    windowSeconds: 300,
    identifier: user.id,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterSeconds);

  const { id: releaseId } = params;
  if (!releaseId) return NextResponse.json({ error: "Release ID required" }, { status: 400 });

  let body;
  try { body = await req.json(); } catch { body = {}; }

  // key: new R2 key for the replacement audio
  // track_id: which track to replace (for multi-track; defaults to the only track for singles)
  const { key: newKey, track_id } = body;

  if (!newKey) return NextResponse.json({ error: "key is required" }, { status: 400 });

  // Verify new file exists in R2
  let exists = false;
  try { exists = await headR2ObjectKey(newKey); } catch {}
  if (!exists) {
    return NextResponse.json({ error: "New audio file not found in R2 — complete upload first" }, { status: 422 });
  }

  const admin = getAdminClient();

  // Load release for type + slug
  const { data: release, error: relErr } = await admin
    .from("releases")
    .select("id, slug, release_type, status")
    .eq("id", releaseId)
    .single();

  if (relErr || !release) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  // Find the track to update
  let trackQuery = admin.from("tracks").select("id, audio_r2_key, master_r2_key, master_history, slug").eq("release_id", releaseId);
  if (track_id) trackQuery = trackQuery.eq("id", track_id);
  const { data: trackRow, error: trackErr } = await trackQuery.maybeSingle();

  if (trackErr || !trackRow) {
    return NextResponse.json({ error: "Track not found for this release" }, { status: 404 });
  }

  // Append old key to master_history (circular log, keep last 10)
  const history = Array.isArray(trackRow.master_history) ? trackRow.master_history : [];
  if (trackRow.audio_r2_key && trackRow.audio_r2_key !== newKey) {
    history.push({
      key:         trackRow.audio_r2_key,
      replaced_at: new Date().toISOString(),
      replaced_by: user.email,
    });
    if (history.length > 10) history.shift();
  }

  // Update the track
  const { error: updateErr } = await admin
    .from("tracks")
    .update({
      audio_r2_key:  newKey,
      master_r2_key: newKey,
      master_history: history,
      upload_status: "ready",
    })
    .eq("id", trackRow.id);

  if (updateErr) {
    console.error("[replace-master] track update error", updateErr.message);
    return NextResponse.json({ error: "Failed to update track record" }, { status: 500 });
  }

  // Re-queue HLS transcode for the new master
  const folder     = RELEASE_TYPE_FOLDERS[release.release_type] || "singles";
  const isMultiTrack = ["album", "ep", "mixtape"].includes(release.release_type);
  const jobSlug    = isMultiTrack ? trackRow.slug : release.slug;
  const trackSlug  = isMultiTrack ? trackRow.slug : null;
  const hlsPrefix  = trackSlug
    ? `hls/${folder}/${release.slug}/${trackSlug}/`
    : `hls/${folder}/${release.slug}/`;

  // Check-then-insert for the functional unique index on (slug, COALESCE(track_slug,''))
  const { data: existingJob } = await admin
    .from("hls_transcode_jobs")
    .select("id, status")
    .eq("slug", jobSlug)
    .is(trackSlug ? "track_slug" : "track_slug", trackSlug || null)
    .maybeSingle();

  if (existingJob) {
    await admin
      .from("hls_transcode_jobs")
      .update({ source_key: newKey, hls_prefix: hlsPrefix, status: "pending", attempt_count: 0, queued_by: user.id })
      .eq("id", existingJob.id);
  } else {
    await admin
      .from("hls_transcode_jobs")
      .insert({
        slug:         jobSlug,
        track_slug:   trackSlug || null,
        release_type: folder,
        source_key:   newKey,
        hls_prefix:   hlsPrefix,
        status:       "pending",
        queued_by:    user.id,
        attempt_count: 0,
      });
  }

  // Clear durable playback key cache so the player picks up the new master immediately
  try {
    await clearPersistedPlaybackKey(admin, release.slug, isMultiTrack ? trackRow.slug : null);
  } catch {}

  console.info(`[replace-master] SUCCESS releaseId=${releaseId} trackId=${trackRow.id} newKey=${newKey}`);
  return NextResponse.json({ ok: true, trackId: trackRow.id, hlsQueued: true });
}
