/**
 * ContinuityCandidate — the typed, immutable shape a persisted playback
 * snapshot must be normalized into before ContinuityAuthority will look at it.
 *
 * Persisted state is evidence of prior truth, never present truth (INV-CONT-1).
 * This module only does the FIRST gate: is the payload even shaped like
 * something we're willing to consider? It never touches CoreEpoch, Selection,
 * or Transport — that validation happens in ContinuityAuthority, which is the
 * only place authority context is available.
 *
 * Framework-independent: no localStorage, no fetch, no React. Callers hand in
 * whatever they already loaded (from session-memory.js, the recovery store,
 * server media-progress, etc.) as a plain object.
 */

// Kept in sync with the identical constant in `lib/playback/continuity-port.js`
// — duplicated rather than imported, same isolation reasoning as every other
// Core/legacy boundary in this codebase (ports never import playback-core).
export const CONTINUITY_SCHEMA_VERSION = 1;

/** Oldest schemaVersion this build still knows how to migrate. Bump only when
 * a real migration is written below — do not silently accept older shapes. */
const MIN_SUPPORTED_SCHEMA_VERSION = 1;

function identityOf(entry) {
  return entry?.id ?? entry?.trackId ?? entry?.slug ?? null;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Migrate a raw payload forward to CONTINUITY_SCHEMA_VERSION. Identity today
 * (only one version exists) — the seam is here so a future older version has
 * exactly one place to add a deterministic migration step, per the "old
 * supported version -> deterministic migration" requirement.
 */
function migrate(raw, fromVersion) {
  if (fromVersion === CONTINUITY_SCHEMA_VERSION) return raw;
  // No prior versions exist yet to migrate from.
  return null;
}

/**
 * @param {object} raw - whatever the caller loaded from persistence
 * @returns {{ ok: true, candidate: object } | { ok: false, reason: string }}
 */
export function buildContinuityCandidate(raw) {
  if (!isPlainObject(raw)) {
    return { ok: false, reason: "CONTINUITY_SCHEMA_INVALID" };
  }

  const rawVersion = raw.schemaVersion ?? raw.v;
  if (!Number.isInteger(rawVersion)) {
    return { ok: false, reason: "CONTINUITY_SCHEMA_INVALID" };
  }
  if (rawVersion > CONTINUITY_SCHEMA_VERSION) {
    // Unknown NEWER version — fail closed rather than guess at a shape we've
    // never seen (e.g. an older client reading a payload a newer build wrote).
    return { ok: false, reason: "CONTINUITY_SCHEMA_INVALID" };
  }
  if (rawVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    return { ok: false, reason: "CONTINUITY_SCHEMA_INVALID" };
  }

  const migrated = rawVersion === CONTINUITY_SCHEMA_VERSION ? raw : migrate(raw, rawVersion);
  if (!migrated) {
    return { ok: false, reason: "CONTINUITY_SCHEMA_INVALID" };
  }

  // `selection` absent entirely is fine (this candidate simply carries no
  // Selection restore data). `selection` PRESENT but malformed is treated as
  // a corrupt payload and rejects the whole candidate — a garbled `queue` is
  // reason to distrust the rest of the payload too, not reason to silently
  // drop just that one field and keep going.
  let queue = null;
  let queueIndex = null;
  if (migrated.selection !== undefined && migrated.selection !== null) {
    if (!isPlainObject(migrated.selection) || !Array.isArray(migrated.selection.queue)) {
      return { ok: false, reason: "CONTINUITY_INVALID" };
    }
    queue = migrated.selection.queue;
    queueIndex = migrated.selection.queueIndex;
    if (!Number.isInteger(queueIndex) || queueIndex < -1 || queueIndex >= Math.max(queue.length, 0) + 1) {
      return { ok: false, reason: "CONTINUITY_INVALID" };
    }
  }

  const position = migrated.timeline?.position;
  if (position !== undefined && position !== null && !Number.isFinite(position)) {
    return { ok: false, reason: "CONTINUITY_INVALID" };
  }

  const nowPlayingIdentity =
    migrated.selection?.nowPlayingIdentity ??
    (queue && Number.isInteger(queueIndex) && queueIndex >= 0 ? identityOf(queue[queueIndex]) : null);

  // Fail closed rather than guess: a queue with an unresolvable identity at
  // its own index is not something we're willing to restore.
  if (queue && queueIndex >= 0 && !nowPlayingIdentity) {
    return { ok: false, reason: "CONTINUITY_INVALID" };
  }

  const candidate = Object.freeze({
    schemaVersion: CONTINUITY_SCHEMA_VERSION,
    persistedAt: Number.isFinite(migrated.persistedAt ?? migrated.savedAt)
      ? (migrated.persistedAt ?? migrated.savedAt)
      : null,
    selection: queue
      ? Object.freeze({
          queue,
          queueIndex,
          nowPlayingIdentity,
          repeatMode: migrated.selection?.repeatMode ?? null,
          shuffle: Boolean(migrated.selection?.shuffle),
        })
      : null,
    timeline: Number.isFinite(position)
      ? Object.freeze({ position, duration: Number.isFinite(migrated.timeline?.duration) ? migrated.timeline.duration : null })
      : null,
    mediaIdentity: migrated.mediaIdentity ?? nowPlayingIdentity ?? null,
    source: typeof migrated.source === "string" ? migrated.source : "unknown",
  });

  return { ok: true, candidate };
}
