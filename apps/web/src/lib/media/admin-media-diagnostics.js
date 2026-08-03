import { getCanonicalReleaseBySlug } from "@/lib/media/canonical-catalog";
import { checkMediaAvailability } from "@/lib/media/media-availability";
import { isKnownReleaseType, normalizeReleaseType } from "@/lib/media/normalize-release-type";
import { resolvePlaybackKey } from "@/lib/playback/resolve-playback-key";

/**
 * Server-side release media diagnostics for admin tooling.
 * @param {import('@supabase/supabase-js').SupabaseClient} [admin]
 * @param {object} release — { slug, release_type, ... }
 * @param {{ accountState?: object, trackSlug?: string, albumSlug?: string }} [options]
 */
export async function buildReleaseDiagnostics(release, options = {}) {
  const slug = String(release?.slug || "").trim();
  const rawType = release?.release_type || release?.release_category || "single";
  const releaseType = normalizeReleaseType(rawType);
  const invalidReleaseType = Boolean(rawType) && !isKnownReleaseType(rawType);

  const canonical = getCanonicalReleaseBySlug(slug);
  const availability = await checkMediaAvailability({
    slug,
    releaseType,
    trackSlug: options.trackSlug,
    albumSlug: options.albumSlug,
    accountState: options.accountState,
    legacyPreview: release?.preview_legacy || canonical?.preview_legacy,
    legacyImage: release?.legacy_cover || canonical?.legacy_cover,
    legacyVideo: release?.video_path || canonical?.video_path,
  });

  let brokenPlayback = availability.status === "unavailable";
  if (options.adminClient && slug && !brokenPlayback) {
    try {
      const resolved = await resolvePlaybackKey(options.adminClient, slug, {
        trackSlug: options.trackSlug,
      });
      brokenPlayback = !resolved?.key;
    } catch {
      brokenPlayback = true;
    }
  }

  return {
    slug,
    releaseType,
    missingAudio: availability.reasons?.includes("missing_audio") ?? false,
    missingPreview: availability.reasons?.includes("missing_preview") ?? false,
    missingArtwork: availability.reasons?.includes("missing_artwork") ?? false,
    missingVideo: availability.reasons?.includes("missing_video") ?? false,
    invalidReleaseType,
    brokenPlayback,
    availability,
  };
}
