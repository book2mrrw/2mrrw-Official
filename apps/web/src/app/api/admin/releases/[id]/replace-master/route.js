import { NextResponse } from "next/server";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey, deleteR2Object, discoverFileByExtensions } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { clearPersistedPlaybackKey } from "@/lib/playback/resolve-playback-key";
import { buildHLSPrefix } from "@/lib/hls/derive-key";

export const dynamic = "force-dynamic";

const RELEASE_TYPE_FOLDERS = {
  single:  "singles",
  feature: "features",
  album:   "albums",
  ep:      "mixtapes-and-eps",
  mixtape: "mixtapes-and-eps",
};

const AUDIO_EXTENSIONS = [".wav", ".flac", ".aiff", ".aif", ".m4a", ".mp3"];

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
  const { key: newKey, track_id } = body;

  if (!newKey) return NextResponse.json({ error: "key is required" }, { status: 400 });

  // Verify new file exists in R2
  let exists = false;
  try { exists = await headR2ObjectKey(newKey); } catch {}
  if (!exists) {
    return NextResponse.json({ error: "New audio file not found in R2 — complete upload first" }, { status: 422 });
  }

  const admin = getAdminClient();

  // ── Path A: wizard release (releases table) ───────────────────────────────────
  const { data: release } = await admin
    .from("releases")
    .select("id, slug, release_type, status")
    .eq("id", releaseId)
    .single();

  if (release) {
    let trackQuery = admin.from("tracks").select("id, audio_r2_key, master_r2_key, master_history, slug").eq("release_id", releaseId);
    if (track_id) trackQuery = trackQuery.eq("id", track_id);
    const { data: trackRow, error: trackErr } = await trackQuery.maybeSingle();

    if (trackErr || !trackRow) {
      return NextResponse.json({ error: "Track not found for this release" }, { status: 404 });
    }

    const history = Array.isArray(trackRow.master_history) ? trackRow.master_history : [];
    if (trackRow.audio_r2_key && trackRow.audio_r2_key !== newKey) {
      history.push({ key: trackRow.audio_r2_key, replaced_at: new Date().toISOString(), replaced_by: user.email });
      if (history.length > 10) history.shift();
    }

    const { error: updateErr } = await admin
      .from("tracks")
      .update({ audio_r2_key: newKey, master_r2_key: newKey, master_history: history, upload_status: "ready" })
      .eq("id", trackRow.id);

    if (updateErr) {
      return NextResponse.json({ error: "Failed to update track record" }, { status: 500 });
    }

    await requeue(admin, user, release.slug, release.release_type, trackRow.slug, newKey, release);
    try { await clearPersistedPlaybackKey(admin, release.slug, trackRow.slug || null); } catch {}

    return NextResponse.json({ ok: true, trackId: trackRow.id, hlsQueued: true });
  }

  // ── Path B: catalog release (products table, R2-ingested) ─────────────────────
  const { data: product, error: productErr } = await admin
    .from("products")
    .select("id, slug, product_type, release_type, active, storage_path, metadata")
    .eq("id", releaseId)
    .single();

  if (productErr || !product) {
    return NextResponse.json({ error: "Release not found" }, { status: 404 });
  }

  const releaseType = product.release_type || product.product_type || "single";
  const isMultiTrack = ["album", "ep", "mixtape", "albums", "mixtapes-and-eps"].includes(releaseType);
  const folder = RELEASE_TYPE_FOLDERS[releaseType] || RELEASE_TYPE_FOLDERS[releaseType.replace(/s$/, "")] || "singles";

  // Find catalog track (multi-track: by id; single: by product)
  let catalogTrack = null;
  if (isMultiTrack && track_id) {
    const { data: ct } = await admin
      .from("catalog_tracks")
      .select("id, slug, storage_path, metadata, album_slug")
      .eq("id", track_id)
      .eq("product_id", releaseId)
      .maybeSingle();
    catalogTrack = ct;
  }

  const trackSlug = isMultiTrack && catalogTrack ? catalogTrack.slug : null;

  // Determine the audio folder from the new key (parent directory)
  const newKeyParts = newKey.replace(/^\//, "").split("/");
  const newAudioFolder = newKeyParts.slice(0, -1).join("/");

  // Delete any old audio files from R2 in the same folder to avoid resolver picking stale file
  try {
    const oldKey = await discoverFileByExtensions(newAudioFolder, AUDIO_EXTENSIONS);
    if (oldKey && oldKey !== newKey) {
      await deleteR2Object(oldKey);
      console.info(`[replace-master/catalog] deleted old audio key=${oldKey}`);
    }
  } catch {
    // Non-fatal — continue even if old file cleanup fails
  }

  // Update catalog_track or product storage_path to point to the new folder
  if (isMultiTrack && catalogTrack) {
    await admin
      .from("catalog_tracks")
      .update({
        storage_path: `${newAudioFolder}/`,
        metadata: { ...(catalogTrack.metadata || {}), audio_key: newKey, audio_replaced_at: new Date().toISOString() },
      })
      .eq("id", catalogTrack.id);
  } else {
    await admin
      .from("products")
      .update({
        storage_path: `${newAudioFolder}/`,
        metadata: { ...(product.metadata || {}), audio_key: newKey, audio_replaced_at: new Date().toISOString() },
      })
      .eq("id", product.id);
  }

  // Clear durable playback key cache
  try { await clearPersistedPlaybackKey(admin, product.slug, trackSlug); } catch {}

  // Re-queue HLS transcode job
  await requeue(admin, user, product.slug, releaseType, trackSlug, newKey, { slug: product.slug, release_type: releaseType });

  console.info(`[replace-master/catalog] SUCCESS productId=${product.id} slug=${product.slug} newKey=${newKey}`);
  return NextResponse.json({ ok: true, slug: product.slug, hlsQueued: true });
}

async function requeue(admin, user, releaseSlug, releaseType, trackSlug, sourceKey, release) {
  const typeFolder = RELEASE_TYPE_FOLDERS[releaseType] ||
    RELEASE_TYPE_FOLDERS[releaseType?.replace(/s$/, "")] || "singles";
  // slug is always the RELEASE slug (matches hls-sync-trigger schema)
  const jobSlug = releaseSlug;
  const hlsPrefix = buildHLSPrefix(releaseSlug, trackSlug || null, typeFolder);

  const { data: existingJob } = await admin
    .from("hls_transcode_jobs")
    .select("id, status")
    .eq("slug", jobSlug)
    .is("track_slug", trackSlug || null)
    .maybeSingle();

  if (existingJob) {
    await admin
      .from("hls_transcode_jobs")
      .update({
        source_key: sourceKey,
        hls_prefix: hlsPrefix,
        status: "pending",
        attempt_count: 0,
        error_message: null,
        worker_id: null,
        queued_by: user.id,
        started_at: null,
        completed_at: null,
      })
      .eq("id", existingJob.id);
  } else {
    await admin
      .from("hls_transcode_jobs")
      .insert({
        slug:         jobSlug,
        track_slug:   trackSlug || null,
        release_type: typeFolder,
        source_key:   sourceKey,
        hls_prefix:   hlsPrefix,
        status:       "pending",
        attempt_count: 0,
        queued_by:    user.id,
      });
  }
}
