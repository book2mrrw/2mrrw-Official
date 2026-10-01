/**
 * Enqueues a vault audio master for transcoding.
 *
 * Deliberately not lib/hls/submit-audio-job.js: that function hard-validates
 * releaseType against ["singles","features","albums","mixtapes-and-eps"] and
 * resolves its source through resolveAudioSource(), which reads release and
 * track rows. Neither applies to a vault item, and changing it to would be
 * exactly the integration this pipeline exists to avoid. This is a separate
 * function that writes a row the existing worker already knows how to
 * process.
 *
 * Identity in the shared queue
 * ----------------------------
 * A vault audio row identifies itself the same way vault video already does
 * in hls_manifests: slug = vault_content.slug, track_slug = null. That is
 * forced, not chosen -- the worker derives the AES key from job.slug, and
 * /api/vault/audio/key has to derive the identical key from the same string,
 * so the job's slug must be the slug the player asks for.
 *
 * Which means vault audio and release audio share one identity space. Both
 * hls_transcode_jobs and hls_manifests carry a UNIQUE index on
 * (slug, COALESCE(track_slug,'')) that is NOT scoped by job_type or
 * release_type, so a vault item whose slug happened to equal a release's slug
 * would land on that release's row -- and the worker would then overwrite the
 * release's manifest with vault segment paths.
 *
 * That index cannot be narrowed without altering an object the release
 * pipeline depends on, which is off-limits here. So the guarantee is enforced
 * in front of it instead: before writing anything, both tables are checked for
 * a row at this identity, and if one exists that is not ours
 * (release_type <> 'vault') this throws and writes nothing. A loud refusal is
 * the only acceptable outcome -- silently claiming a release's row would
 * corrupt published audio, and that is strictly worse than a failed upload.
 */

import {
  assertVaultSlugIsOurs,
  VaultJobConflict,
  VaultIdentityCollision,
} from "./vault-job-identity.js";
import {
  VAULT_AUDIO_RENDITIONS,
  VAULT_AUDIO_SEGMENT_SECONDS,
  VAULT_AUDIO_RELEASE_TYPE,
  buildVaultAudioHlsPrefix,
} from "./vault-audio-contract.js";

/* The conflict and collision types keep their vault-audio names: routes and
   tests import them, and the distinction they draw is about this lane. They
   are the shared types -- the guard behind them is one implementation in
   vault-job-identity.js, so a fix there cannot reach one lane and miss the
   other. */
export const VaultAudioJobConflict = VaultJobConflict;
export const VaultAudioIdentityCollision = VaultIdentityCollision;

const OURS = VAULT_AUDIO_RELEASE_TYPE;

/**
 * @param {object}  opts
 * @param {object}  opts.admin        service-role Supabase client
 * @param {string}  opts.category     vault section, for the output prefix
 * @param {string}  opts.slug         vault_content.slug — the playback identity
 * @param {string}  opts.sourceKey    R2 key of the uploaded master
 * @param {string?} opts.queuedBy     admin user id
 * @param {boolean} opts.reuseComplete return the finished job instead of re-encoding
 */
export async function submitVaultAudioJob({
  admin,
  category,
  slug,
  sourceKey,
  queuedBy = null,
  reuseComplete = false,
}) {
  const hlsPrefix = buildVaultAudioHlsPrefix({ category, slug });
  if (!hlsPrefix) throw new Error("Invalid vault audio identity");
  if (!sourceKey) throw new Error("A source key is required");

  const existing = await assertVaultSlugIsOurs(admin, slug);

  // Nothing changed and it already finished: hand back what is there rather
  // than paying for an identical encode.
  if (reuseComplete && existing) {
    const { data: full, error } = await admin
      .from("hls_transcode_jobs")
      .select("id, status, source_key, bitrates, hls_prefix")
      .eq("id", existing.id)
      .maybeSingle();
    if (error) throw error;
    if (
      full?.status === "complete" &&
      full.source_key === sourceKey &&
      VAULT_AUDIO_RENDITIONS.every((b) => full.bitrates?.includes(b))
    ) {
      return { ...full, reused: true };
    }
  }

  const payload = {
    job_type:              "audio",
    release_type:          OURS,
    source_key:            sourceKey,
    hls_prefix:            hlsPrefix,
    status:                "pending",
    // Releases queue at 5. Vault sits one rung behind so a drop day never
    // waits on a diary entry that was uploaded a minute earlier.
    priority:              6,
    bitrates:              [...VAULT_AUDIO_RENDITIONS],
    segment_duration_secs: VAULT_AUDIO_SEGMENT_SECONDS,
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
    // A row appeared between the check and the insert — another upload of the
    // same item raced us. Never retry into it blindly.
    if (error?.code === "23505" || (!error && !data)) throw new VaultAudioJobConflict();
    if (error) throw error;
    return data;
  }

  // Re-queueing an in-flight job would orphan the worker's lease.
  //
  // Only columns the schema provably has are read here. lib/hls/submit-audio-job.js
  // additionally filters on `generation` and `updated_at`, but no migration in
  // this repo ever adds either column to hls_transcode_jobs -- so that path is
  // relying on something unproven. Not this pipeline's bug to fix, and not a
  // pattern to copy: `status` alone gives the guarantee that matters, because
  // the worker's claim moves it pending -> processing.
  const { data: current, error: curErr } = await admin
    .from("hls_transcode_jobs")
    .select("id, status, source_key, bitrates")
    .eq("id", existing.id)
    .maybeSingle();
  if (curErr) throw curErr;
  if (!current) throw new VaultAudioJobConflict("The job row disappeared; try again");

  if (["pending", "processing"].includes(current.status)) {
    const sameWork =
      current.source_key === sourceKey &&
      VAULT_AUDIO_RENDITIONS.every((b) => current.bitrates?.includes(b));
    if (sameWork) return { ...current, reused: true };
    throw new VaultAudioJobConflict();
  }

  // Compare-and-set on the status we read. If a worker claims this row between
  // the read and the write, the status no longer matches, zero rows update, and
  // this reports a conflict instead of yanking the job out from under it.
  const { data, error } = await admin
    .from("hls_transcode_jobs")
    .update(payload)
    .eq("id", current.id)
    .eq("status", current.status)
    .select("id, status, hls_prefix")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new VaultAudioJobConflict();
  return data;
}
