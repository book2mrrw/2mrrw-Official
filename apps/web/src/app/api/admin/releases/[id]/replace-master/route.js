import { NextResponse } from "next/server";
import { getAdminSessionUser } from "@/lib/auth/admin-api-guard";
import { isAdminUser } from "@/lib/auth/constants";
import { getAdminClient } from "@/lib/supabase/admin";
import { headR2ObjectKey, deleteR2Object, listR2Objects, isDirectChildObjectKey } from "@/lib/storage/r2";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { clearPersistedPlaybackKey } from "@/lib/playback/resolve-playback-key";
import { buildHLSPrefix } from "@/lib/hls/derive-key";
import { revalidateStorefront } from "@/lib/media/revalidate-storefront";

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
  const user = await getAdminSessionUser({ recentSeconds: 15 * 60 });
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

  const { id: releaseId } = await params;
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

  // Delete any other audio file left in the same folder (e.g. replacing a .wav
  // master with a .flac one) — storage paths are folder-level and resolved by
  // extension-priority scan at playback/transcode time, so a stale sibling file
  // can silently keep serving even after a "successful" replace otherwise.
  const newKeyParts = newKey.replace(/^\//, "").split("/");
  const newAudioFolder = newKeyParts.slice(0, -1).join("/");
  const admin = getAdminClient();

  // ── Path A: wizard release (releases table) ───────────────────────────────────
  const { data: release } = await admin
    .from("releases")
    .select("id, slug, release_type, status")
    .eq("id", releaseId)
    .single();

  if (release) {
    let trackQuery = admin.from("tracks").select("id, audio_r2_key, master_r2_key, master_history, position").eq("release_id", releaseId);
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

    const cleanupWarnings = await removeStaleMasterSiblings(newAudioFolder, newKey);

    const isMultiTrack = ["album", "ep", "mixtape"].includes(release.release_type);
    const folderParts = newAudioFolder.replace(/\/$/, "").split("/");
    const trackSlug = isMultiTrack ? folderParts.at(-1) : null;
    await requeue(admin, user, release.slug, release.release_type, trackSlug, newKey, release);
    try { await clearPersistedPlaybackKey(admin, release.slug, trackSlug); } catch {}
    // A still-drafting release has nothing public to invalidate yet.
    if (release.status !== "draft") revalidateStorefront();

    return NextResponse.json({ ok: true, trackId: trackRow.id, hlsQueued: true, cleanupWarnings });
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

  // Update catalog_track or product storage_path to point to the new folder
  if (isMultiTrack && catalogTrack) {
    const { error } = await admin
      .from("catalog_tracks")
      .update({
        storage_path: `${newAudioFolder}/`,
        metadata: { ...(catalogTrack.metadata || {}), audio_key: newKey, audio_replaced_at: new Date().toISOString() },
      })
      .eq("id", catalogTrack.id);
    if (error) return NextResponse.json({ error: "Failed to update catalog track" }, { status: 500 });
  } else {
    const { error } = await admin
      .from("products")
      .update({
        storage_path: `${newAudioFolder}/`,
        metadata: { ...(product.metadata || {}), audio_key: newKey, audio_replaced_at: new Date().toISOString() },
      })
      .eq("id", product.id);
    if (error) return NextResponse.json({ error: "Failed to update product master" }, { status: 500 });
  }

  const cleanupWarnings = await removeStaleMasterSiblings(newAudioFolder, newKey);

  // Clear durable playback key cache
  try { await clearPersistedPlaybackKey(admin, product.slug, trackSlug); } catch {}

  // Re-queue HLS transcode job
  await requeue(admin, user, product.slug, releaseType, trackSlug, newKey, { slug: product.slug, release_type: releaseType });
  revalidateStorefront();

  console.info(`[replace-master/catalog] SUCCESS productId=${product.id} slug=${product.slug} newKey=${newKey}`);
  return NextResponse.json({ ok: true, slug: product.slug, hlsQueued: true, cleanupWarnings });
}

async function removeStaleMasterSiblings(folder, newKey) {
  const prefix = `${String(folder || "").replace(/\/$/, "")}/`;
  const supported = new Set(AUDIO_EXTENSIONS.map((ext) => ext.toLowerCase()));
  const warnings = [];

  try {
    const objects = await listR2Objects(prefix, { recursive: false });
    const staleKeys = objects
      .map((item) => item.Key)
      .filter((key) => key && key !== newKey && isDirectChildObjectKey(prefix, key))
      .filter((key) => supported.has(key.slice(key.lastIndexOf(".")).toLowerCase()));

    for (const staleKey of staleKeys) {
      try {
        await deleteR2Object(staleKey);
        console.info(`[replace-master] deleted stale audio key=${staleKey}`);
      } catch (err) {
        const warning = { key: staleKey, error: err?.message || "delete failed" };
        warnings.push(warning);
        console.error("[replace-master] stale master cleanup failed", {
          folder, newKey, staleKey, error: warning.error,
        });
      }
    }
  } catch (err) {
    warnings.push({ folder, error: err?.message || "list failed" });
    console.error("[replace-master] stale master listing failed", {
      folder, newKey, error: err?.message,
    });
  }

  return warnings;
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
