import { fetchLibraryStream, isLibraryStreamSrc, parseStreamSlugFromSrc, parseStreamTrackSlugFromSrc } from "@/lib/playback/stream-client";
import { telemetry } from "@/system/telemetry";

/**
 * Refresh signed stream URLs for recovered tracks (current + next 2).
 * @param {Array<{ id?: string, slug?: string, src?: string }>} tracks
 */
export async function refreshSignedUrlsForQueue(tracks = []) {
  const results = [];
  for (const track of tracks.slice(0, 3)) {
    const slug = track?.slug || parseStreamSlugFromSrc(track?.src);
    const trackSlug =
      track?.trackSlug ||
      track?.metadata?.trackSlug ||
      parseStreamTrackSlugFromSrc(track?.src);
    if (!slug || !isLibraryStreamSrc(track?.src || `/api/library/stream?slug=${slug}`)) {
      results.push({ trackId: track?.id, ok: true, skipped: true });
      continue;
    }
    try {
      const data = await fetchLibraryStream(slug, { force: true, trackSlug });
      results.push({ trackId: track?.id, ok: true, url: data?.url });
    } catch (err) {
      telemetry.log({
        type: "signed.url.expired",
        assetId: slug,
        context: "session_recovery",
      });
      results.push({ trackId: track?.id, ok: false, error: err?.message });
    }
  }
  return results;
}
