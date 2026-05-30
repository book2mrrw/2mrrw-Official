import {
  clearMediaAvailabilityCache,
  deleteInflightAvailability,
  getCachedAvailability,
  getInflightAvailability,
  setInflightAvailability,
  writeAvailabilityCache,
} from "@/lib/media/availability-cache";
import { getCanonicalReleaseBySlug, getCanonicalTrack } from "@/lib/media/canonical-catalog";
import {
  resolveArtworkPath,
  resolvePreviewPath,
  resolveStoragePath,
  resolveVideoPath,
} from "@/lib/media/canonical-paths";
import { normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { isUpcomingReleaseDate } from "@/lib/media/release-date";
import { resolveTrackAccess } from "@/lib/music-access";
import {
  resolveAudio,
  resolveArtwork,
  resolvePreview,
  resolveVideo,
} from "@/lib/media/entity-resolver";

export { getCachedAvailability, clearMediaAvailabilityCache } from "@/lib/media/availability-cache";

/**
 * Discover and cache availability — call on play attempt or debounced card mount.
 * Deduplicates concurrent requests for the same slug+track.
 */
export async function prefetchMediaAvailability(params = {}) {
  const cached = getCachedAvailability(params.slug, params.trackSlug, params.albumSlug);
  if (cached) return cached;

  const inflight = getInflightAvailability(params);
  if (inflight) return inflight;

  const promise = checkMediaAvailability(params)
    .then((result) => {
      writeAvailabilityCache(params, result);
      return result;
    })
    .finally(() => {
      deleteInflightAvailability(params);
    });

  setInflightAvailability(params, promise);
  return promise;
}

function inferReleaseType(slug, releaseType) {
  if (releaseType) return normalizeReleaseType(releaseType);
  const release = getCanonicalReleaseBySlug(slug);
  if (!release) {
    console.error("[media-availability] cannot infer release_type", { slug });
    return null;
  }
  return normalizeReleaseType(release.release_type || release.release_category);
}

function safeDiscovery(promise) {
  return Promise.resolve(promise).catch(() => null);
}

/**
 * Non-blocking media discovery for storefront / playback gating.
 * Never throws — returns unavailable on miss or discovery failure.
 *
 * @returns {Promise<{ status: 'ready'|'preview_only'|'unavailable'|'coming_soon', reasons: string[], audioKey?: string|null, previewKey?: string|null }>}
 */
export async function checkMediaAvailability({
  slug,
  releaseType,
  trackSlug,
  accountState,
  albumSlug,
  legacyPreview,
  legacyImage,
  legacyVideo,
} = {}) {
  const reasons = [];
  const safeSlug = String(slug || "").trim();
  if (!safeSlug) {
    return { status: "unavailable", reasons: ["missing_slug"], audioKey: null, previewKey: null };
  }

  try {
    const rt = inferReleaseType(safeSlug, releaseType);
    if (!rt) {
      return { status: "unavailable", reasons: ["unknown_release_type"], audioKey: null, previewKey: null };
    }
    const release = getCanonicalReleaseBySlug(safeSlug);
    const track = albumSlug || trackSlug ? getCanonicalTrack(albumSlug || safeSlug, trackSlug) : null;
    const effectiveAlbumSlug = albumSlug || (trackSlug && release?.release_type !== "single" ? safeSlug : null);
    const previewSlug = trackSlug || safeSlug;

    if (release?.release_date && isUpcomingReleaseDate(release.release_date)) {
      return { status: "coming_soon", reasons, audioKey: null, previewKey: null };
    }

    const audioFolder = resolveStoragePath(rt, safeSlug, trackSlug, effectiveAlbumSlug);
    const previewFolder = resolvePreviewPath(rt, previewSlug, effectiveAlbumSlug);
    const artworkFolder = resolveArtworkPath(rt, safeSlug, trackSlug, effectiveAlbumSlug);
    const videoFolder = resolveVideoPath(rt, safeSlug, trackSlug, effectiveAlbumSlug);

    let audioKey = null;
    if (audioFolder) {
      audioKey = await safeDiscovery(resolveAudio(audioFolder));
      if (!audioKey) reasons.push("missing_audio");
    } else {
      reasons.push("missing_audio");
    }

    let previewKey = null;
    const legacyPrev = legacyPreview || release?.preview_legacy || release?.preview_path || track?.preview_path;
    if (previewFolder || legacyPrev) {
      previewKey = await safeDiscovery(resolvePreview(previewFolder, legacyPrev));
      if (!previewKey) reasons.push("missing_preview");
    } else {
      reasons.push("missing_preview");
    }

    const videoKey = videoFolder
      ? await safeDiscovery(resolveVideo(videoFolder, legacyVideo || release?.video_path))
      : null;
    if (!videoKey) reasons.push("missing_video");

    const artworkKey = artworkFolder
      ? await safeDiscovery(resolveArtwork(artworkFolder, legacyImage || release?.artwork_path))
      : null;
    if (!artworkKey && !legacyImage && !release?.cover) reasons.push("missing_artwork");

    const access = accountState ? resolveTrackAccess({ slug: safeSlug, albumSlug: effectiveAlbumSlug }, accountState) : null;

    if (audioKey && access?.canStream) {
      return { status: "ready", reasons, audioKey, previewKey };
    }
    if (audioKey && !accountState) {
      return { status: "ready", reasons, audioKey, previewKey };
    }
    if (previewKey) {
      return { status: "preview_only", reasons, audioKey, previewKey };
    }
    if (audioKey && access?.canStream === false) {
      return { status: "preview_only", reasons, audioKey, previewKey };
    }

    return { status: "unavailable", reasons, audioKey, previewKey };
  } catch {
    return { status: "unavailable", reasons: ["discovery_error"], audioKey: null, previewKey: null };
  }
}

/** Dev/admin helper — human-readable availability summary. */
export function formatAvailabilityDiagnostics(availability) {
  if (!availability) return "availability: unknown";
  const { status, reasons = [], audioKey, previewKey } = availability;
  const parts = [
    `status=${status}`,
    reasons.length ? `reasons=${reasons.join(",")}` : null,
    audioKey ? `audio=${audioKey}` : null,
    previewKey ? `preview=${previewKey}` : null,
  ].filter(Boolean);
  return parts.join(" | ");
}

/** @param {Awaited<ReturnType<typeof checkMediaAvailability>>} availability */
export function logAvailabilityDiagnostics(availability, context = {}) {
  if (process.env.NODE_ENV !== "development") return;
  console.info("[media-availability]", formatAvailabilityDiagnostics(availability), context);
}
