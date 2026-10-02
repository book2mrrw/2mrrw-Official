import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedPlaylistTracks,playlistTrackKey,toClientPlaylist} from '../../src/lib/playlists/identity.js';
import {resolvePlaylistTracks} from '../../src/lib/playlists.js';
const a={id:'player-a',slug:'intro',albumSlug:'album-a',trackSlug:'intro',gainDb:-2,preview:'/p',src:'/a',metadata:{access:{canStream:true}}};
const b={...a,id:'player-b',albumSlug:'album-b',src:'/b'};
test('both playback entry paths preserve release identity, media, gain and canonical order',()=>{
 const playlist={tracks:[a,b],trackIds:[playlistTrackKey(b),playlistTrackKey(a)]};
 for(const resolve of [orderedPlaylistTracks,resolvePlaylistTracks]){
  const tracks=resolve(playlist);assert.deepEqual(tracks.map(t=>t.albumSlug),['album-b','album-a']);
  assert.equal(tracks[0].metadata.albumSlug,'album-b');assert.equal(tracks[0].metadata.trackSlug,'intro');
  assert.equal(tracks[0].gainDb,-2);assert.equal(tracks[0].preview,'/p');assert.equal(tracks[0].src,'/b');
 }
});
test('database identity overrides conflicting cached metadata',()=>{
 const result=toClientPlaylist({id:'p',revision:4},[{id:'row',album_slug:'correct',track_slug:'song',track_data:{slug:'wrong',albumSlug:'wrong',trackSlug:'wrong',metadata:{albumSlug:'wrong',trackSlug:'wrong'},gainDb:-3}}]);
 assert.equal(result.tracks[0].metadata.albumSlug,'correct');assert.equal(result.tracks[0].trackSlug,'song');assert.equal(result.tracks[0].gainDb,-3);assert.equal(result.revision,4);
});
test('legacy standalone references resolve only when unambiguous',()=>{
 assert.equal(orderedPlaylistTracks({trackIds:['intro']},[a,b]).length,0);
 assert.equal(orderedPlaylistTracks({trackIds:['player-a']},[a,b])[0].albumSlug,'album-a');
 assert.equal(orderedPlaylistTracks({trackIds:[playlistTrackKey(b)]},[a,b])[0].albumSlug,'album-b');
});
test('standalone database identity cannot inherit a stale album from cached metadata',()=>{
 const result=toClientPlaylist({id:'p'},[{id:'row',album_slug:null,track_slug:'single',track_data:{metadata:{albumSlug:'wrong',trackSlug:'wrong'}}}]);
 assert.equal(result.tracks[0].albumSlug,null);assert.equal(result.tracks[0].metadata.albumSlug,null);
 assert.equal(result.tracks[0].trackSlug,'single');
});
