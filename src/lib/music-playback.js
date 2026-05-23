import { resolvePlaybackSrc, resolveTrackAccess } from "@/lib/music-access";
import { catalogCoverUrl, catalogPublicMediaUrl } from "@/lib/media-urls";

function resolveCsMediaUrl(path) {
  if (!path) return null;
  const normalized = String(path).replace(/^\//, "");
  return catalogPublicMediaUrl(normalized) || path;
}

export function toPlaybackTrack(item, accountState, source = "library", overrides = {}) {
  const access = resolveTrackAccess(item, accountState);
  const userId = accountState?.userId || overrides.userId;
  const csAudioRaw = item?.csAudio || item?.cs_audio || null;
  const csCoverRaw = item?.csCover || item?.cs_cover || item?.csCoverArt || null;
  return {
    id: item?.slug || item?.id,
    slug: item?.slug,
    title: item?.title || "Untitled",
    artist: item?.artist || "2MRRW",
    cover: item?.cover || item?.coverArt || null,
    src: resolvePlaybackSrc(item, access, { userId }),
    csAudio: csAudioRaw ? resolveCsMediaUrl(csAudioRaw) : null,
    csCover: csCoverRaw ? catalogCoverUrl(csCoverRaw) : null,
    source,
    metadata: {
      access,
      price: item?.price,
      albumSlug: item?.albumSlug || overrides.albumSlug,
      ...overrides,
    },
  };
}

/** First-track (or album-level preview) catalog item for inline card play — matches album modal start index 0. */
export function albumCardPlaybackItem(album) {
  if (!album) return album;
  const trackList = album.tracks || album.trackTitles || [];
  const first = trackList[0];
  if (!first) return album;
  if (typeof first === "string") {
    return {
      slug: album.slug,
      albumSlug: album.slug,
      title: first,
      cover: album.cover,
      preview: album.preview,
      audio: album.audio,
      artist: album.artist || "2MRRW",
    };
  }
  return {
    ...first,
    slug: first.slug || album.slug,
    albumSlug: album.slug,
    cover: first.cover || album.cover,
    preview: first.preview || album.preview,
    audio: first.audio || album.audio,
    artist: first.artist || album.artist || "2MRRW",
  };
}

export function albumTracksForPlayback(album, accountState, source = "album") {
  const trackList = album?.tracks || album?.trackTitles || [];
  return trackList
    .map((track, index) => {
      if (typeof track === "string") {
        return toPlaybackTrack(
          {
            slug: album.slug,
            albumSlug: album.slug,
            title: track,
            cover: album.cover,
            preview: album.preview,
            audio: album.audio,
          },
          accountState,
          source,
          { trackIndex: index }
        );
      }
      return toPlaybackTrack(
        {
          ...track,
          slug: track.slug || album.slug,
          albumSlug: album.slug,
          cover: track.cover || album.cover,
          preview: track.preview || album.preview,
          audio: track.audio || album.audio,
          csAudio: track.csAudio || track.cs_audio,
          csCover: track.csCover || track.cs_cover,
        },
        accountState,
        source,
        { trackIndex: index, albumSlug: album.slug }
      );
    })
    .filter((t) => t.src);
}
