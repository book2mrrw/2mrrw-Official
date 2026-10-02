/** Server-only deployment control; never import into the playlist client. */
export function playlistWriteGateResponse() {
  if (process.env.PLAYLIST_WRITES_PAUSED !== '1') return null;
  return Response.json({
    code: 'PLAYLIST_WRITES_PAUSED',
    error: 'Playlist saves are temporarily unavailable. Your changes have not been saved.',
  }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
  });
}
