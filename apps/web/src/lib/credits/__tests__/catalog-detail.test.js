import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {memoryDb} from './memory-db.mjs';
let db;
mock.module('@/lib/supabase/admin',{namedExports:{getAdminClient:()=>db}});
const {getCatalogReleaseDetailFromDB}=await import('../../media/catalog-db.js');
function seed(overrides={}){
  db=memoryDb({products:[{id:'product',deleted_at:null,release_id:'release',slug:'single',product_type:'single',content_kind:'music',active:true,credits:{written_by:['Release Writer']},metadata:{},...overrides}],tracks:[{id:'track',release_id:'release',position:1,title:'Song',written_by:['Recording Writer'],removed_from_release_at:null}],catalog_tracks:[]});
}
test('fresh single detail retrieves the saved recording attribution independently',async()=>{
  seed();const result=await getCatalogReleaseDetailFromDB('single');
  assert.equal(result.credits[0].name,'Release Writer');assert.equal(result.recording.credits[0].name,'Recording Writer');
});
test('an explicit empty recording attribution does not resurrect release names',async()=>{
  seed();db.rows.tracks[0].written_by=[];const result=await getCatalogReleaseDetailFromDB('single');assert.deepEqual(result.recording.credits,[]);
});
test('legacy single product attribution remains available when no recording attribution was stored',async()=>{
  seed();delete db.rows.tracks[0].written_by;const result=await getCatalogReleaseDetailFromDB('single');assert.equal(result.recording.credits[0].name,'Release Writer');
});
test('hidden legacy products and lifecycle-hidden drafts remain unavailable',async()=>{
  seed({active:false});assert.equal(await getCatalogReleaseDetailFromDB('single'),null);
  seed({releases:{id:'release',status:'draft',storefront_visible:true,available_at:'2020-01-01'}});assert.equal(await getCatalogReleaseDetailFromDB('single'),null);
});
test('catalog track explicit clear remains separate from stale source writer fields',async()=>{
  seed({product_type:'album'});db.rows.catalog_tracks.push({id:'catalog-track',track_id:'track',product_id:'product',slug:'song',title:'Song',position:1,credits:{written_by:[]},removed_from_release_at:null});
  const result=await getCatalogReleaseDetailFromDB('single');assert.deepEqual(result.tracks[0].credits,[]);assert.equal(result.credits[0].name,'Release Writer');
});
test('database failure rejects rather than masquerading as empty credits',async()=>{
  db={from:()=>{throw new Error('offline')}};await assert.rejects(()=>getCatalogReleaseDetailFromDB('single'),/offline/);
});

test('fresh single lyrics come from the saved source recording',async()=>{
 seed();db.rows.tracks[0].lyrics='Saved plain lyrics';const result=await getCatalogReleaseDetailFromDB('single');assert.equal(result.recording.lyrics,'Saved plain lyrics');
});
test('album catalog lyrics remain paired with their canonical recording identity',async()=>{
 seed({product_type:'album'});db.rows.catalog_tracks.push({id:'catalog-track',track_id:'track',product_id:'product',slug:'song',title:'Song',position:1,lyrics:'Saved catalog lyrics',credits:{},removed_from_release_at:null});
 const result=await getCatalogReleaseDetailFromDB('single');assert.equal(result.tracks[0].id,'track');assert.equal(result.tracks[0].catalog_track_id,'catalog-track');assert.equal(result.tracks[0].lyrics,'Saved catalog lyrics');
});
test('an explicit recording lyric clear suppresses older product text',async()=>{
 seed({metadata:{lyrics:'Old product lyric'}});db.rows.tracks[0].lyrics='';const result=await getCatalogReleaseDetailFromDB('single');assert.equal(result.recording.lyrics,'');
});
