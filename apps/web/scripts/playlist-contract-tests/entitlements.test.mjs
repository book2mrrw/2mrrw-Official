import test from 'node:test';
import assert from 'node:assert/strict';
import {playlistTracksForPlayback} from '../../src/lib/playlists/playback.js';
import {canAddPlaylistTrack,playlistCatalogTracks} from '../../src/lib/playlists/access.js';

const saved={slug:'chapter-one',albumSlug:'future-release',title:'Chapter One',
  src:'https://untrusted.example/full.mp3',
  metadata:{access:{canStream:true,admin:true},trackSlug:'chapter-one'}};
const queue=(account,track=saved)=>playlistTracksForPlayback({tracks:[track]},[],account);
const signedIn=(extra={})=>({userId:'listener',user:{id:'listener'},...extra});

for(const [label,state,allowed] of [
  ['purchased album',{ownedSlugs:['future-release']},true],
  ['gifted album',{library:[{slug:'future-release',source:'gift'}]},true],
  ['granted album',{library:[{slug:'future-release',source:'grant'}]},true],
  ['unrelated purchase',{ownedSlugs:['another-release']},false],
  ['active subscription',{membership:{status:'active'}},true],
  ['trial subscription',{membership:{status:'trialing'}},true],
  ['expired subscription',{membership:{status:'canceled'},library:[{slug:'future-release',source:'membership'}]},false],
  ['past due subscription',{membership:{status:'past_due'}},false],
  ['purchase survives expired subscription',{membership:{status:'canceled'},ownedSlugs:['future-release']},true],
  ['collector card',{collectorCard:true},true],
  ['active collector ledger',{collectorOwnerships:[{slug:'card',entitlementStatus:'active'}]},true],
  ['revoked collector ledger',{collectorOwnerships:[{slug:'card',entitlementStatus:'revoked'}]},false],
  ['discovery listener',{},false],
]) {
  test(`playlist re-resolves ${label} from current account state`,()=>{
    const [track]=queue(signedIn(state));
    assert.ok(track);
    assert.equal(track.metadata.access.canStream,allowed);
    assert.equal(track.metadata.access.previewOnly,!allowed);
    assert.equal(track.metadata.access.admin===true,false);
    assert.equal(canAddPlaylistTrack(saved,signedIn(state)),allowed);
    const url=new URL(track.src,'https://2mrrw.example');
    assert.equal(url.origin,'https://2mrrw.example');
    assert.equal(url.pathname,'/api/library/stream');
    assert.equal(url.searchParams.get('slug'),'future-release');
    assert.equal(url.searchParams.get('trackSlug'),'chapter-one');
  });
}

test('signed-out and mismatched accounts cannot reuse saved media or access flags',()=>{
  assert.deepEqual(queue({}),[]);
  assert.deepEqual(queue({userId:'listener',user:{id:'other'},ownedSlugs:['future-release']}),[]);
});

test('add catalog covers Features and purchased Albums, Mixtapes and EPs without requiring subscription',()=>{
  const releases=['album','mixtape','ep'].map(type=>({slug:`future-${type}`,product_type:type,tracks:[{slug:'intro',title:'Intro'}]}));
  const catalog={singles:[{slug:'single'}],features:[{slug:'feature'}],releases};
  const account=signedIn({ownedSlugs:['single','feature',...releases.map(r=>r.slug)]});
  const entries=playlistCatalogTracks(catalog,account);
  assert.equal(entries.length,5);
  assert.deepEqual(entries.filter(t=>t.albumSlug).map(t=>t.albumSlug),releases.map(r=>r.slug));
  assert.equal(playlistCatalogTracks(catalog,signedIn()).length,0);
  assert.equal(playlistCatalogTracks(catalog,signedIn({membership:{status:'active'}})).length,5);
  assert.equal(canAddPlaylistTrack(null,account),false);
});

test('entitlement changes apply to newly prepared queues without mutating an active queue',()=>{
  const active=queue(signedIn({membership:{status:'active'}}));
  const snapshot=structuredClone(active);
  const next=queue(signedIn({membership:{status:'canceled'}}));
  assert.equal(next[0].metadata.access.canStream,false);
  assert.deepEqual(active,snapshot);
});

test('Singles and Features resolve purchased product access without a sub-track request',()=>{
  for(const release_type of ['single','feature']) {
    const [track]=queue(signedIn({ownedSlugs:['future-single']}),{
      slug:'future-single',release_type,title:'Future',metadata:{access:{canStream:false}},
    });
    assert.equal(track.metadata.access.canStream,true);
    const url=new URL(track.src,'https://2mrrw.example');
    assert.equal(url.searchParams.get('slug'),'future-single');
    assert.equal(url.searchParams.has('trackSlug'),false);
  }
});
