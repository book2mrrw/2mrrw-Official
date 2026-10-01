/**
 * Enqueues a vault video for transcoding.
 *
 * Its own lane, job_type='vault_video', because job_type='video' belongs to
 * Audio Visualz: that processor requires an asset_version_id, loads
 * audio_visual_asset_versions and audio_visuals, and writes
 * audio_visual_renditions. Vault content has none of those rows and must not
 * acquire them.
 *
 * Identity, the shared-table guard and the conflict semantics are the same as
 * the audio lane's -- see vault-job-identity.js for why a slug is forced and
 * what the guard protects.
 *
 * The source is the item's existing media_storage_path: the file Vault Manager
 * already uploaded. There is no separate "video master" upload, so queueing is
 * something done to an item that is already there rather than a second
 * ingestion of the same bytes.
 */

import {
  assertVaultSlugIsOurs,
  VaultJobConflict,
  VaultIdentityCollision,
  VAULT_RELEASE_TYPE,
} from "./vault-job-identity.js";
import {
  VAULT_VIDEO_RENDITIONS,
  VAULT_VIDEO_SEGMENT_SECONDS,
  buildVaultVideoHlsPrefix,
} from "./vault-video-contract.js";

export const VaultVideoJobConflict = VaultJobConflict;
export const VaultVideoIdentityCollision = VaultIdentityCollision;

/**
 * @param {object}  opts
 * @param {object}  opts.admin      service-role Supabase client
 * @param {string}  opts.category   vault section, for the output prefix
 * @param {string}  opts.slug       vault_content.slug -- the playback identity
 * @param {string}  opts.sourceKey  R2 key of the uploaded file
 * @param {string?} opts.queuedBy   admin user id
 */
export async function submitVaultVideoJob({ admin, category, slug, sourceKey, queuedBy = null }) {
  const hlsPrefix = buildVaultVideoHlsPrefix({ category, slug });
  if (!hlsPrefix) throw new Error("Invalid vault video identity");
  if (!sourceKey) throw new Error("A source key is required");

  const existing = await assertVaultSlugIsOurs(admin, slug);

  const payload = {
    job_type:              "vault_video",
    release_type:          VAULT_RELEASE_TYPE,
    source_key:            sourceKey,
    hls_prefix:            hlsPrefix,
    status:                "pending",
    // Behind releases (5) and behind vault audio (6). A video encode occupies
    // its worker for far longer than an audio one, so letting it jump a queue
    // of short jobs would stall everything else for the length of a film.
    priority:              7,
    // The real ladder is chosen by the worker once it has probed the source's
    // height -- encoding rungs above the source is just bigger files. This is
    // the full set, and the manifest advertises only the rungs that ended up
    // with segments.
    bitrates:              [...VAULT_VIDEO_RENDITIONS],
    segment_duration_secs: VAULT_VIDEO_SEGMENT_SECONDS,
    queued_by:             queuedBy,
    attempt_count:         0,
    error_message:         null,
    failure_category:      null,
    worker_id:             null,
    heartbeat_at:          null,
    started_at:            null,
    completed_at:          null,
  };

  if (!existing) {
    const { data, error } = await admin
      .from("hls_transcode_jobs")
      .insert({ slug, track_slug: null, ...payload })
      .select("id, status, hls_prefix")
      .maybeSingle();
    if (error?.code === "23505" || (!error && !data)) throw new VaultJobConflict();
    if (error) throw error;
    return data;
  }

  const { data: current, error: curErr } = await admin
    .from("hls_transcode_jobs")
    .select("id, status, source_key, bitrates")
    .eq("id", existing.id)
    .maybeSingle();
  if (curErr) throw curErr;
  if (!current) throw new VaultJobConflict("The job row disappeared; try again");

  if (["pending", "processing"].includes(current.status)) {
    if (current.source_key === sourceKey) return { ...current, reused: true };
    throw new VaultJobConflict();
  }

  // Compare-and-set on the status we read, so a worker that claims this row in
  // the meantime wins and this reports a conflict instead of stealing it.
  const { data, error } = await admin
    .from("hls_transcode_jobs")
    .update(payload)
    .eq("id", current.id)
    .eq("status", current.status)
    .select("id, status, hls_prefix")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new VaultJobConflict();
  return data;
}
