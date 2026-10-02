import {resolveContentAccess} from '../music-access.js';
import {isDigitalProduct} from '../commerce/entitlements.js';
import {playlistIdentity,playlistTrackKey} from './identity.js';

/** Saved flags never authorize an addition; evaluate the current account. */
export function canAddPlaylistTrack(track, account = {}) {
  let identity;
  try { identity=playlistIdentity(track); } catch { return false; }
  const {albumSlug,trackSlug}=identity;
  return Boolean(resolveContentAccess({...track,slug:albumSlug || trackSlug,albumSlug},account).canAddToPlaylist);
}

/** Enumerate all release types before applying the shared entitlement policy. */
export function playlistCatalogTracks({singles=[],features=[],releases=[],library=[]},account) {
  const tracks=new Map();
  const musicLibrary=library.filter(isDigitalProduct);
  for(const item of [...musicLibrary,...singles,...features]) {
    if(item?.slug && !item.tracks?.length && !item.trackTitles?.length &&
       !['album','ep','mixtape'].includes(item.product_type || item.release_type || item.type)) {
      const track={...item,albumSlug:null,trackSlug:item.slug};
      if(canAddPlaylistTrack(track,account)) tracks.set(playlistTrackKey(track),track);
    }
  }
  for(const release of [...musicLibrary,...releases]) {
    if(!release?.slug) continue;
    for(const track of release.tracks || release.trackTitles || []) {
      // Catalog track identities are authoritative; never guess from display titles.
      if(!track || typeof track==='string' || !track.slug) continue;
      const item={...track,albumSlug:release.slug,trackSlug:track.slug,
        albumTitle:release.title,cover:track.cover || track.cover_art || release.cover || release.cover_art || release.cover_url || null,
        type:release.type || release.releaseType || 'album'};
      if(canAddPlaylistTrack(item,account)) tracks.set(playlistTrackKey(item),item);
    }
  }
  return [...tracks.values()];
}
