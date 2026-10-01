/**
 * Shared identity rules for every Vault transcode lane.
 *
 * Vault audio and vault video both identify a job by vault_content.slug,
 * because the worker derives the AES key from job.slug and the playback
 * routes have to derive the identical key from the string the player asks
 * for. That is forced, not chosen.
 *
 * Which means both lanes share one identity space with the release pipeline:
 * hls_transcode_jobs and hls_manifests each carry a UNIQUE index on
 * (slug, COALESCE(track_slug,'')) that is scoped by neither job_type nor
 * release_type. A vault item whose slug happened to match a release's would
 * land on that release's row, and the worker would then overwrite a published
 * manifest with vault segment paths.
 *
 * That index cannot be narrowed without altering an object the release
 * pipeline depends on, so the guarantee lives in front of it instead. This
 * module is the single copy of that guard: one lane fixing it and the other
 * not would be worse than having no shared module at all.
 */

/** Written into hls_transcode_jobs.release_type by every vault lane. Not a
 *  release type -- it is how a row says which tree its output belongs to, and
 *  it keeps vault segments out of every hls/<releaseType>/ prefix. */
export const VAULT_RELEASE_TYPE = "vault";

export class VaultJobConflict extends Error {
  constructor(message = "This item is already being transcoded; retry once it finishes") {
    super(message);
    this.status = 409;
  }
}

/** Thrown when a slug is already spoken for by something that is not a vault
 *  item. Never recovered from automatically. */
export class VaultIdentityCollision extends Error {
  constructor(slug, where) {
    super(
      `The slug "${slug}" already has ${where} belonging to another pipeline. ` +
      `Rename this vault item — writing here would overwrite published media.`
    );
    this.status = 409;
  }
}

/**
 * Refuses if either shared table already holds a row at this identity that was
 * not written by a vault lane. Returns the existing vault job row, or null.
 *
 * @param {object} admin service-role Supabase client
 * @param {string} slug  vault_content.slug
 */
export async function assertVaultSlugIsOurs(admin, slug) {
  const { data: job, error: jobErr } = await admin
    .from("hls_transcode_jobs")
    .select("id, release_type, job_type")
    .eq("slug", slug)
    .is("track_slug", null)
    .maybeSingle();
  if (jobErr) throw jobErr;
  if (job && job.release_type !== VAULT_RELEASE_TYPE) {
    throw new VaultIdentityCollision(slug, "a transcode job");
  }

  const { data: manifest, error: manErr } = await admin
    .from("hls_manifests")
    .select("id, release_type")
    .eq("slug", slug)
    .is("track_slug", null)
    .maybeSingle();
  if (manErr) throw manErr;
  if (manifest && manifest.release_type !== VAULT_RELEASE_TYPE) {
    throw new VaultIdentityCollision(slug, "a published manifest");
  }

  return job || null;
}
