/**
 * Playback track equality, normalization, and presentation utilities.
 * Extracted verbatim from AudioContext.js (lines 191–245, 301–310, 712–751, 779–858).
 * Constants re-exported for AudioContext.js where the component body uses them directly.
 */

import { isSamePlaybackTrack } from "@/lib/music-playback";
import { getCanonicalReleaseBySlug } from "@/lib/media/canonical-catalog";

export const SLOWED_SUFFIX = " · Slowed";
export const CS_PLAYBACK_RATE = 0.75;
export const TRANSPORT_ONLY_STATE_KEYS = new Set([
  "playbackNetworkState",
  // isBuffering is intentionally NOT transport-only: changes to it must emit a full
  // context notification so useSyncExternalStore subscribers (the spinner UI) re-render.
  // Transport-only patches only trigger the transport channel, not _emitContext(), so
  // isBuffering:false would never reach the spinner if it lived here.
  "currentTime",
  "duration",
]);

/** Phase P12 — skip AudioProvider setState when storefront-visible playback fields are unchanged. */
function playbackTrackPresentationEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return (
    (a.id ?? null) === (b.id ?? null) &&
    (a.slug ?? null) === (b.slug ?? null) &&
    (a.title ?? null) === (b.title ?? null) &&
    (a.cover ?? null) === (b.cover ?? null) &&
    (a.src ?? null) === (b.src ?? null) &&
    (a.source ?? null) === (b.source ?? null)
  );
}

function playbackUiStateEqual(prev, next) {
  if (prev === next) return true;
  const uiKeys = [
    "currentTrackId",
    "currentTrack",
    "source",
    "isPlaying",
    "error",
    "hasStarted",
    "accessDenied",
    "streamRetryable",
    "streamConflict",
    "queue",
    "queueIndex",
    "repeatMode",
    "shuffle",
    "csMode",
    "csTrack",
    "playbackState",
    "spaceMode",
    "bassMode",
    "atmosphereLevel",
  ];
  for (const key of uiKeys) {
    if (key === "currentTrack") {
      if (!playbackTrackPresentationEqual(prev.currentTrack, next.currentTrack)) return false;
      continue;
    }
    if (key === "queue") {
      const pq = prev.queue;
      const nq = next.queue;
      if (pq === nq) continue;
      if (!Array.isArray(pq) || !Array.isArray(nq) || pq.length !== nq.length) return false;
      for (let i = 0; i < pq.length; i += 1) {
        if (!playbackTrackPresentationEqual(pq[i], nq[i])) return false;
      }
      continue;
    }
    if (prev[key] !== next[key]) return false;
  }
  return true;
}

/**
 * Fisher-Yates shuffle — returns a new array in random order.
 * The original `arr` is never mutated.
 */
function fisherYatesShuffle(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** Entitled library stream (not guest/preview-only cap path). */
function isEntitledFullPlaybackTrack(track) {
  if (!track) return false;
  const access = track.metadata?.access;
  if (access?.previewOnly) return false;
  return Boolean(access?.canStream);
}

/** Whether a stream resolution/playback error should fall back to catalog preview. */
function canFallbackStreamToPreview(err, track) {
  return (
    err?.status === 401 ||
    err?.status === 403 ||
    err?.status === 404 ||
    err?.status === 415 ||
    err?.status === 422 ||
    err?.code === "MEDIA_UNAVAILABLE" ||
    err?.code === "INVALID_STREAM_CONTENT_TYPE" ||
    err?.code === "SIGNED_STREAM_INVALID_CONTENT_TYPE" ||
    err?.code === "SIGNED_STREAM_UNREACHABLE"
  );
}

function dispatchPreviewEnded(slug) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("preview:ended", { detail: { slug } }));
}

function isTransportOnlyPatch(patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return false;
  return keys.every((k) => TRANSPORT_ONLY_STATE_KEYS.has(k));
}

function playbackQueuesMatch(normalized, current) {
  return (
    normalized.length > 0 &&
    normalized.length === current.length &&
    normalized.every((t, i) => isSamePlaybackTrack(t, current[i]))
  );
}

function stripSlowedSuffix(title) {
  if (!title) return "Untitled";
  return title.endsWith(SLOWED_SUFFIX) ? title.slice(0, -SLOWED_SUFFIX.length) : title;
}

function withSlowedSuffix(title) {
  const base = stripSlowedSuffix(title);
  return `${base}${SLOWED_SUFFIX}`;
}

const normalizeTrack = (track = {}) => {
  const src = track.src || track.preview || track.audio || track.url || "";
  const slug =
    track.slug ||
    track.trackSlug ||
    track.metadata?.trackSlug ||
    null;
  const id = track.id || track.trackId || slug || null;
  const baseTitle = stripSlowedSuffix(track.title || "Untitled");
  const coverArtType = track.coverArtType || track.cover_art_type || (track.video ? "video" : "image");
  // Separate static vs. video cover sources so the video URL is never silently dropped.
  // baseCover=static path for <img>; cover=video URL for video tracks, static URL otherwise.
  const rawStaticCover = track.baseCover || track.coverArt || track.image || null;
  const rawVideoCover = track.cover || null;
  const rawCover = rawStaticCover || rawVideoCover;
  // Bare filenames (no path separator, no protocol) are legacy DB data — fall back to canonical.
  const isValidCoverPath = (url) =>
    url && (String(url).includes("/") || /^https?:\/\//i.test(String(url)));
  const canonical = getCanonicalReleaseBySlug(slug || id || "");
  const baseCover = isValidCoverPath(rawCover)
    ? rawCover
    : (canonical?.legacy_cover ?? canonical?.cover ?? null);
  const cover =
    coverArtType === "video" &&
    isValidCoverPath(rawVideoCover) &&
    rawVideoCover !== rawStaticCover
      ? rawVideoCover
      : baseCover;
  const csAudio = track.csAudio || track.cs_audio || null;
  const csCover = track.csCover || track.cs_cover || track.csCoverArt || null;
  const csCoverType = track.csCoverType || track.cs_cover_type || "image";
  const gainDb = track.gainDb ?? track.gain_db ?? track.metadata?.gainDb ?? null;
  return {
    id: id || slug || src,
    slug: slug || id,
    title: baseTitle,
    artist: track.artist || "2MRRW",
    cover,
    baseSrc: track.baseSrc || src,
    baseCover,
    src,
    coverArtType,
    csAudio: csAudio || null,
    csCover: csCover || null,
    csCoverType,
    hasCs: Boolean(csAudio || csCover),
    gainDb,
    source: track.source || "unknown",
    metadata: track.metadata || {},
    preview: track.preview || track.preview_path || track.previewPath || null,
  };
};

function resolvePlaybackPresentation(track, csOn, usingCsSrc) {
  if (!track) return track;
  const baseTitle = stripSlowedSuffix(track.title);
  const baseSrc = track.baseSrc || track.src;
  const baseCover = track.baseCover || track.cover;
  if (!csOn) {
    const coverForPresentation =
      track.coverArtType === "video" && track.cover && track.cover !== track.baseCover
        ? track.cover
        : baseCover;
    return {
      ...track,
      title: baseTitle,
      src: baseSrc,
      cover: coverForPresentation,
      playbackRate: 1,
      useCsSrc: false,
    };
  }
  if (track.csAudio) {
    return {
      ...track,
      title: withSlowedSuffix(baseTitle),
      src: track.csAudio,
      cover: track.csCover || baseCover,
      playbackRate: 1,
      useCsSrc: true,
    };
  }
  return {
    ...track,
    title: withSlowedSuffix(baseTitle),
    src: baseSrc,
    cover: baseCover,
    playbackRate: CS_PLAYBACK_RATE,
    useCsSrc: false,
  };
}

export {
  playbackTrackPresentationEqual,
  playbackUiStateEqual,
  fisherYatesShuffle,
  isEntitledFullPlaybackTrack,
  canFallbackStreamToPreview,
  dispatchPreviewEnded,
  isTransportOnlyPatch,
  playbackQueuesMatch,
  stripSlowedSuffix,
  withSlowedSuffix,
  normalizeTrack,
  resolvePlaybackPresentation,
};
