import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistTracksForPlayback} from '../../src/lib/playlists/playback.js';
import {playlistTrackKey} from '../../src/lib/playlists/identity.js';
const account={userId:'listener',isAdmin:true,permissions:{admin:true}};
test('future album tracks request their own release plus exact track and keep distinct queue IDs',()=>{
 const tracks=[{slug:'intro',albumSlug:'future-a',title:'Intro A',preview:'/previews/a.mp3'},
 {slug:'intro',albumSlug:'future-b',title:'Intro B',preview:'/previews/b.mp3'},
 {slug:'outro',albumSlug:'future-a',title:'Outro',preview:'/previews/c.mp3'}];
 const result=playlistTracksForPlayback({tracks,trackIds:tracks.map(playlistTrackKey)},[],account);
 assert.equal(result.length,3);assert.equal(new Set(result.map(t=>t.id)).size,3);
 for(let i=0;i<tracks.length;i++){
  const url=new URL(result[i].src,'https://example.com');
  assert.equal(url.searchParams.get('slug'),tracks[i].albumSlug);
  assert.equal(url.searchParams.get('trackSlug'),tracks[i].slug);
  assert.equal(result[i].metadata.albumSlug,tracks[i].albumSlug);
 }
});
test('standalone singles and features retain product-only stream identity',()=>{
 for(const release_type of ['single','feature']){
  const result=playlistTracksForPlayback({tracks:[{slug:'future-single',title:'Future',release_type}]},[],account);
  assert.equal(result.length,1);
  const url=new URL(result[0].src,'https://example.com');
  assert.equal(url.searchParams.get('slug'),'future-single');assert.equal(url.searchParams.has('trackSlug'),false);
 }
});
