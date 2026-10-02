/** Playlist identity is independent of player IDs and release display names. */
export function playlistIdentity(track) {
  const albumSlug = track?.albumSlug !== undefined ? track.albumSlug : track?.metadata?.albumSlug ?? null;
  const trackSlug = track?.trackSlug || track?.metadata?.trackSlug || track?.slug;
  if (typeof trackSlug !== 'string' || !trackSlug || (albumSlug !== null && typeof albumSlug !== 'string')) throw new Error('Track identity is required');
  return { albumSlug: albumSlug || null, trackSlug };
}
export function playlistTrackKey(track) {
  const {albumSlug, trackSlug} = playlistIdentity(track);
  // JSON tuple avoids delimiter collisions without release-specific rules.
  return JSON.stringify([albumSlug, trackSlug]);
}
export function normalizePlaylistTrack(track) {
  const {albumSlug, trackSlug} = playlistIdentity(track);
  return {...track, albumSlug, trackSlug, playlistKey: playlistTrackKey(track),
    metadata: {...track.metadata, albumSlug, trackSlug}};
}
export function orderedPlaylistTracks(playlist, catalog = []) {
  const values = catalog instanceof Map ? [...catalog.values()] : catalog;
  const exact = new Map(values.map(t => [playlistTrackKey(t), t]));
  const refs = playlist?.tracks?.length ? playlist.tracks : (playlist?.trackIds || []).map(key => {
    if (exact.has(key)) return exact.get(key);
    const matches = values.filter(t => t.id === key || t.slug === key);
    return matches.length === 1 ? matches[0] : null;
  }).filter(Boolean);
  const tracks = refs.map(t => normalizePlaylistTrack({...exact.get(playlistTrackKey(t)), ...t}));
  const byKey = new Map(tracks.map(t => [t.playlistKey, t]));
  const used = new Set();
  const ordered = [];
  for (const key of playlist?.trackIds || []) {
    const matches = byKey.has(key) ? [byKey.get(key)] : tracks.filter(t => t.id === key || t.slug === key);
    if (matches.length === 1 && !used.has(matches[0].playlistKey)) {
      used.add(matches[0].playlistKey); ordered.push(matches[0]);
    }
  }
  return [...ordered, ...tracks.filter(t => !used.has(t.playlistKey))];
}
export function toClientPlaylist(row, rows) {
  const tracks = rows.map(t => normalizePlaylistTrack({...(t.track_data || {}),
    // Database identity overrides stale/untrusted cached metadata.
    slug: t.track_slug, trackSlug: t.track_slug, albumSlug: t.album_slug,
    playlistEntryId: t.id}));
  return {id:row.id,title:row.title,artwork:row.artwork_url || null,isSystem:row.is_system,
    sortOrder:row.sort_order,revision:row.revision,trackIds:tracks.map(playlistTrackKey),tracks,
    createdAt:row.created_at,updatedAt:row.updated_at};
}
