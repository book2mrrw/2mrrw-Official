import { resolvePlaybackSrc, resolveTrackAccess } from "@/lib/music-access";

export function toPlaybackTrack(item, accountState, source = "library", overrides = {}) {
  const access = resolveTrackAccess(item, accountState);
  const userId = accountState?.userId || overrides.userId;
  return {
    id: item?.slug || item?.id,
    slug: item?.slug,
    title: item?.title || "Untitled",
    artist: item?.artist || "2MRRW",
    cover: item?.cover || item?.coverArt || null,
    src: resolvePlaybackSrc(item, access, { userId }),
    source,
    metadata: {
      access,
      price: item?.price,
      ...overrides,
    },
  };
}

export function albumTracksForPlayback(album, accountState, source = "album") {
  const access = resolveTrackAccess(album, accountState);
  const trackList = album?.tracks || album?.trackTitles || [];
  return trackList.map((track, index) => {
    if (typeof track === "string") {
      return {
        id: `${album.slug}-track-${index}`,
        slug: album.slug,
        albumSlug: album.slug,
        title: track,
        cover: album.cover,
        src: access.canStream ? (album.preview || album.audio) : (album.preview || ""),
        source,
        metadata: { access, trackIndex: index },
      };
    }
    return toPlaybackTrack(
      { ...track, slug: track.slug || album.slug, albumSlug: album.slug, cover: track.cover || album.cover },
      accountState,
      source
    );
  }).filter((t) => t.src);
}
