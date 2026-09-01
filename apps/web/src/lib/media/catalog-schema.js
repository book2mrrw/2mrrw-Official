/**
 * Catalog schema validation.
 *
 * Validates catalog entries at module initialization time so that malformed
 * entries fail loudly (in dev) instead of silently producing wrong URLs,
 * missing artwork, or broken playback three screens later.
 *
 * Not a runtime guard on the audio hot path — runs once when the catalog
 * module is first imported. In production it logs warnings; in development
 * it throws to force immediate correction.
 */

const IS_DEV = process.env.NODE_ENV === "development";

const VALID_RELEASE_TYPES = new Set(["single", "feature", "ep", "mixtape", "album"]);
const VALID_RELEASE_CATEGORIES = new Set(["EP", "Mixtape", "Album", undefined, null]);

/**
 * Validate a single release entry from CANONICAL_SINGLES, CANONICAL_FEATURES,
 * CANONICAL_MIXTAPES_AND_EPS, or CANONICAL_TRUE_ALBUMS.
 *
 * @param {object} release
 * @param {string} [context]  Array name (for error messages).
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateReleaseEntry(release, context = "release") {
  const errors = [];
  if (!release || typeof release !== "object") {
    errors.push(`${context}: entry must be an object`);
    return { valid: false, errors };
  }
  if (!release.slug || typeof release.slug !== "string") {
    errors.push(`${context}: missing or invalid "slug"`);
  }
  if (!release.title || typeof release.title !== "string") {
    errors.push(`${context}: [${release.slug}] missing or invalid "title"`);
  }
  if (!release.release_type || !VALID_RELEASE_TYPES.has(release.release_type)) {
    errors.push(`${context}: [${release.slug}] invalid release_type "${release.release_type}" — must be one of ${[...VALID_RELEASE_TYPES].join(", ")}`);
  }
  if (release.release_category !== undefined && !VALID_RELEASE_CATEGORIES.has(release.release_category)) {
    errors.push(`${context}: [${release.slug}] invalid release_category "${release.release_category}"`);
  }
  if (!release.release_date || !/^\d{4}-\d{2}-\d{2}$/.test(release.release_date)) {
    errors.push(`${context}: [${release.slug}] missing or invalid release_date (expected YYYY-MM-DD)`);
  }
  if (release.price_cents !== undefined && (typeof release.price_cents !== "number" || release.price_cents < 0)) {
    errors.push(`${context}: [${release.slug}] price_cents must be a non-negative number`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a track entry from CANONICAL_TRACKS.
 * @param {object} track
 * @param {string} [context]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTrackEntry(track, context = "track") {
  const errors = [];
  if (!track || typeof track !== "object") {
    errors.push(`${context}: entry must be an object`);
    return { valid: false, errors };
  }
  if (!track.album_slug) errors.push(`${context}: [${track.slug}] missing album_slug`);
  if (!track.slug) errors.push(`${context}: missing slug`);
  if (!track.title) errors.push(`${context}: [${track.slug}] missing title`);
  if (typeof track.track_number !== "number" || track.track_number < 1) {
    errors.push(`${context}: [${track.slug}] track_number must be a positive integer`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validate an entire catalog array (releases or tracks).
 * Throws in development, warns in production.
 *
 * @param {object[]} entries
 * @param {string} arrayName
 * @param {"release"|"track"} entryType
 */
export function validateCatalogArray(entries, arrayName, entryType = "release") {
  if (!Array.isArray(entries)) {
    const msg = `[catalog-schema] ${arrayName} must be an array`;
    if (IS_DEV) throw new Error(msg);
    console.error(msg);
    return;
  }
  const allErrors = [];
  for (const entry of entries) {
    const { errors } = entryType === "track"
      ? validateTrackEntry(entry, arrayName)
      : validateReleaseEntry(entry, arrayName);
    allErrors.push(...errors);
  }
  // Detect duplicate slugs.
  const slugField = entryType === "track" ? "slug" : "slug";
  const seenSlugs = new Set();
  for (const entry of entries) {
    if (!entry?.[slugField]) continue;
    const key = entryType === "track" ? `${entry.album_slug}:${entry.slug}` : entry.slug;
    if (seenSlugs.has(key)) {
      allErrors.push(`${arrayName}: duplicate slug "${key}"`);
    }
    seenSlugs.add(key);
  }

  if (allErrors.length) {
    const prefix = `[catalog-schema] ${arrayName} has ${allErrors.length} error(s):\n`;
    const message = prefix + allErrors.map((e) => `  • ${e}`).join("\n");
    if (IS_DEV) throw new Error(message);
    console.error(message);
  }
}
