/**
 * Client-side recommendations — ranks catalog items by listening history signals.
 * Priorities: unfinished albums (started but incomplete) > unplayed owned singles > unplayed catalog.
 * Deterministic within a session; shuffled across sessions for variety.
 */

const SESSION_SEED = Math.random();

function seededRand(slug) {
  let h = SESSION_SEED + slug.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  h = Math.sin(h) * 10000;
  return h - Math.floor(h);
}

export function buildRecommendations({
  accountState,
  singles = [],
  albums = [],
  mixtapesAndEps = [],
  recentlyPlayedRail = [],
  limit = 8,
} = {}) {
  const mediaProgress = accountState?.mediaProgress || [];
  const library = accountState?.library || [];
  const ownedSlugs = new Set((accountState?.ownedSlugs || []).concat(library.map((l) => l.slug)));

  const playedSlugs = new Set([
    ...mediaProgress.map((p) => p.slug).filter(Boolean),
    ...recentlyPlayedRail.map((r) => r.slug).filter(Boolean),
  ]);

  const completedSlugs = new Set(
    mediaProgress.filter((p) => p.completed).map((p) => p.slug).filter(Boolean)
  );

  // Slugs of albums the user has played at least one track from
  const playedAlbumSlugs = new Set();
  for (const album of [...albums, ...mixtapesAndEps]) {
    if (album?.tracks?.some((t) => playedSlugs.has(t.slug || t.trackSlug))) {
      playedAlbumSlugs.add(album.slug);
    }
  }

  const results = [];

  // 1. Unfinished albums: tracks from albums you've started but not completed
  for (const album of [...albums, ...mixtapesAndEps]) {
    if (!album?.slug || !playedAlbumSlugs.has(album.slug)) continue;
    for (const track of album.tracks || []) {
      const slug = track.slug || track.trackSlug;
      if (!slug || playedSlugs.has(slug)) continue;
      results.push({
        slug,
        title: track.title,
        cover: album.cover,
        albumTitle: album.title,
        albumSlug: album.slug,
        type: "track",
        _priority: 3,
        _jitter: seededRand(slug),
      });
    }
  }

  // 2. Owned/entit singles not yet played
  for (const s of singles) {
    if (!s?.slug || playedSlugs.has(s.slug)) continue;
    if (!ownedSlugs.has(s.slug)) continue;
    results.push({
      slug: s.slug,
      title: s.title,
      cover: s.cover,
      type: "single",
      _priority: 2,
      _jitter: seededRand(s.slug),
    });
  }

  // 3. Albums not yet touched (whole album, not yet started)
  for (const album of [...albums, ...mixtapesAndEps]) {
    if (!album?.slug || playedAlbumSlugs.has(album.slug)) continue;
    const firstTrack = (album.tracks || []).find((t) => t.slug || t.trackSlug);
    const slug = firstTrack?.slug || firstTrack?.trackSlug || album.slug;
    results.push({
      slug,
      title: album.title,
      cover: album.cover,
      albumTitle: album.title,
      albumSlug: album.slug,
      type: "album",
      item: album,
      _priority: 1,
      _jitter: seededRand(album.slug),
    });
  }

  // 4. Catalog singles not owned and not played (discovery)
  for (const s of singles) {
    if (!s?.slug || playedSlugs.has(s.slug) || ownedSlugs.has(s.slug)) continue;
    results.push({
      slug: s.slug,
      title: s.title,
      cover: s.cover,
      type: "single",
      _priority: 0,
      _jitter: seededRand(s.slug),
    });
  }

  // Sort: priority desc, then session-stable jitter for variety
  results.sort((a, b) => {
    if (b._priority !== a._priority) return b._priority - a._priority;
    return a._jitter - b._jitter;
  });

  // Dedupe by slug and remove fully completed items from top picks
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    if (seen.has(r.slug)) continue;
    if (completedSlugs.has(r.slug)) continue;
    seen.add(r.slug);
    unique.push(r);
    if (unique.length >= limit) break;
  }

  return unique;
}
