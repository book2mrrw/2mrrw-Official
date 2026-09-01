/**
 * Layout-owned player release modal store.
 *
 * The global player only publishes intent here. It never navigates, mutates
 * playback, or asks the route-owned storefront to render the modal. A small
 * persistent host beside the player is the sole subscriber.
 */

const EMPTY_SNAPSHOT = Object.freeze({
  track: null,
  releaseSlug: null,
  open: false,
  revision: 0,
});

let snapshot = EMPTY_SNAPSHOT;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribePlayerReleaseModal(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlayerReleaseModalSnapshot() {
  return snapshot;
}

export function getPlayerReleaseModalServerSnapshot() {
  return EMPTY_SNAPSHOT;
}

/** Prepare the persistent modal while playback identity changes, not on click. */
export function primePlayerReleaseModal(track) {
  const releaseSlug = resolvePlayerReleaseSlug(track);
  if (!track || !releaseSlug) return false;
  if (snapshot.track === track && snapshot.releaseSlug === releaseSlug) return true;
  const sameRelease = snapshot.releaseSlug === releaseSlug;

  snapshot = Object.freeze({
    track,
    releaseSlug,
    open: sameRelease ? snapshot.open : false,
    revision: snapshot.revision + 1,
  });
  emit();
  return true;
}

/** Open locally. This deliberately has no router or playback side effect. */
export function openPlayerReleaseModal(track) {
  const releaseSlug = resolvePlayerReleaseSlug(track);
  if (!track || !releaseSlug) return false;

  snapshot = Object.freeze({
    track,
    releaseSlug,
    open: true,
    revision: snapshot.revision + 1,
  });
  emit();
  return true;
}

export function closePlayerReleaseModal() {
  if (!snapshot.open) return false;
  snapshot = Object.freeze({
    ...snapshot,
    open: false,
    revision: snapshot.revision + 1,
  });
  emit();
  return true;
}

export function resolvePlayerReleaseSlug(track) {
  return (
    track?.metadata?.releaseSlug ||
    track?.metadata?.albumSlug ||
    track?.releaseSlug ||
    track?.albumSlug ||
    track?.slug ||
    null
  );
}

export function resolvePlayerReleaseModalKind(release, track) {
  if (track?.metadata?.albumSlug || track?.albumSlug) return "album";

  const rawType = String(
    release?.release_type ||
    release?.releaseType ||
    release?.type ||
    track?.metadata?.releaseType ||
    track?.release_type ||
    (String(track?.source || "").includes("feature") ? "feature" : "")
  )
    .trim()
    .toLowerCase();

  if (["album", "albums", "ep", "mixtape", "mixtapes", "mixtapes-and-eps"].includes(rawType)) {
    return "album";
  }
  if (rawType === "feature" || rawType === "features") return "feature";
  return "single";
}
