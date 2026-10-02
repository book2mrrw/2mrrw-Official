import { orderedPlaylistTracks, playlistIdentity, playlistTrackKey } from './identity.js';
import { toPlaybackTrack } from '../music-playback.js';

/** Resolve saved identity at queue creation; never mutate an already-playing queue. */
export function playlistTracksForPlayback(playlist, catalog, account) {
  return orderedPlaylistTracks(playlist, catalog).map(track => {
    const {albumSlug,trackSlug} = playlistIdentity(track);
    const item = {...track,slug:albumSlug || trackSlug,albumSlug,trackSlug:albumSlug ? trackSlug : null};
    const playback = toPlaybackTrack(item, account, 'playlist');
    return {...playback,id:albumSlug ? `${albumSlug}:${trackSlug}` : playback.id,
      playlistKey:playlistTrackKey(track)};
  }).filter(track => track.src);
}
