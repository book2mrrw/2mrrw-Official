import test,{mock,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {memoryDb} from '../../credits/__tests__/memory-db.mjs';import {encodeLyrics,encodeDraft,editorModel} from '../timing.js';
let etag,objects,reads;mock.module('@/lib/storage/r2',{namedExports:{getR2ObjectMetadata:async key=>{reads.push(key);return {etag,contentLength:100,contentType:'audio/wav'};},listR2Objects:async()=>objects,headR2ObjectKey:async()=>true}});
const {resolveLyricAudio,audioFingerprint,verifyLyricInput,publicLyricTiming,rebindCopiedLyrics}=await import('../audio-source.js');
let db;beforeEach(()=>{etag='original';objects=[];reads=[];db=memoryDb({releases:[{id:'release',deleted_at:null}],tracks:[{id:'track',release_id:'release',audio_r2_key:'digital-assets/singles/song/master.wav',duration_seconds:10,removed_from_release_at:null}],products:[],catalog_tracks:[]});});
const doc=ref=>encodeLyrics({reference:ref,duration:10,lines:[{text:'Line',time:1,words:[]} ]});
test('owned source audio resolves and exposes only an opaque reference identity to callers',async()=>{const source=await resolveLyricAudio(db,'release','track');assert.equal(source.duration,null);assert.match(source.fingerprint,/^[a-f0-9]{64}$/);assert.equal(reads.length,1);});
test('foreign, removed and deleted targets fail before any audio object read',async()=>{await assert.rejects(()=>resolveLyricAudio(db,'release','foreign'),e=>e.status===404);db.rows.tracks[0].removed_from_release_at='removed';await assert.rejects(()=>resolveLyricAudio(db,'release','track'));assert.equal(reads.length,0);});
test('master changes reject timed saves and public display falls back to plain text',async()=>{const original=await resolveLyricAudio(db,'release','track');const value=doc(original.fingerprint);await verifyLyricInput(db,'release','track',value);etag='replacement';await assert.rejects(()=>verifyLyricInput(db,'release','track',value),e=>e.status===409);const projected=await publicLyricTiming(db,'release','track',value);assert.equal(projected.sync_status,'audio_changed');assert.equal(projected.lyrics,'Line');});
test('recording-copy rebinding preserves every cue and changes only the opaque reference',async()=>{const old=audioFingerprint('track',{etag:'old',contentLength:100});const value=doc(old);const result=await rebindCopiedLyrics(value,'track','copy.wav');assert.equal(result.slice(result.indexOf('\n')),value.slice(value.indexOf('\n')));assert.notEqual(result,value);});
test('plain lyrics need no storage lookup and unfinished drafts cannot publish',async()=>{await verifyLyricInput(db,'release','track','plain');assert.equal(reads.length,0);await assert.rejects(()=>verifyLyricInput(db,'release','track',encodeDraft(editorModel('Draft'))),e=>e.status===422);});
test('legacy audio discovery rejects ambiguity instead of choosing a different master',async()=>{db=memoryDb({releases:[],products:[{id:'legacy',deleted_at:null,product_type:'single',metadata:{},storage_path:'digital-assets/singles/legacy'}],catalog_tracks:[]});objects=[{Key:'digital-assets/singles/legacy/a.wav'},{Key:'digital-assets/singles/legacy/b.mp3'}];await assert.rejects(()=>resolveLyricAudio(db,'legacy','legacy'),e=>e.status===409);assert.equal(reads.length,0);});
test('preview clips and streaming outputs cannot serve as authoring master references',async()=>{db.rows.tracks[0].audio_r2_key='previews/singles/song/clip.mp3';await assert.rejects(()=>resolveLyricAudio(db,'release','track'),e=>e.status===422);assert.equal(reads.length,0);});

test('a promoted master uses its own verified HLS duration rather than the previous track duration',async()=>{
 db.rows.tracks[0].audio_r2_key='digital-assets/singles/song/revisions/new/master.wav';
 db.rows.audio_master_revisions=[{entity_kind:'track',entity_id:'track',staged_master_key:db.rows.tracks[0].audio_r2_key,status:'active',hls_prefix:'hls-revisions/new/'}];
 db.rows.hls_manifests=[{hls_prefix:'hls-revisions/new/',duration_seconds:20}];
 const source=await resolveLyricAudio(db,'release','track');assert.equal(source.duration,20);
 const value=encodeLyrics({reference:source.fingerprint,duration:20,lines:[{text:'New ending',time:15,words:[]}]});await verifyLyricInput(db,'release','track',value);
 db.rows.hls_manifests[0].duration_seconds=12;await assert.rejects(()=>verifyLyricInput(db,'release','track',value),e=>e.status===422);
});

test('revision duration cannot be borrowed from another entity, key or inactive revision',async()=>{
 db.rows.audio_master_revisions=[{entity_kind:'track',entity_id:'other',staged_master_key:db.rows.tracks[0].audio_r2_key,status:'active',hls_prefix:'foreign/'}];
 db.rows.hls_manifests=[{hls_prefix:'foreign/',duration_seconds:100}];assert.equal((await resolveLyricAudio(db,'release','track')).duration,null);
 db.rows.audio_master_revisions[0].entity_id='track';db.rows.audio_master_revisions[0].status='processing';assert.equal((await resolveLyricAudio(db,'release','track')).duration,null);
 db.rows.audio_master_revisions[0].status='active';db.rows.audio_master_revisions[0].staged_master_key='different.wav';assert.equal((await resolveLyricAudio(db,'release','track')).duration,null);
});
test('an active revision without its committed manifest never falls back to an older duration',async()=>{
 db.rows.audio_master_revisions=[{entity_kind:'track',entity_id:'track',staged_master_key:db.rows.tracks[0].audio_r2_key,status:'active',hls_prefix:'missing/'}];await assert.rejects(()=>resolveLyricAudio(db,'release','track'),e=>e.status===503);
});

test('historical duration without a master binding cannot block a newer copied recording',async()=>{
 const source=await resolveLyricAudio(db,'release','track');assert.equal(source.duration,null);
 await verifyLyricInput(db,'release','track',encodeLyrics({reference:source.fingerprint,duration:20,lines:[{text:'Ending on the current recording',time:15,words:[]}]}));
});

test('projects without the optional replacement table still use the exact native audio reference',async()=>{
 for(const code of ['42P01','PGRST205']){
  const absent=memoryDb(db.rows,{audio_master_revisions:{code}});const source=await resolveLyricAudio(absent,'release','track');assert.equal(source.duration,null);assert.match(source.fingerprint,/^[a-f0-9]{64}$/);
 }
 const broken=memoryDb(db.rows,{audio_master_revisions:{code:'08006'}});await assert.rejects(()=>resolveLyricAudio(broken,'release','track'),e=>e.status===503);
});

test('legacy product and catalog recording duration use their own entity-scoped revision',async()=>{
 for(const kind of ['product','catalog_track']){
  const key='digital-assets/singles/legacy/revisions/current/master.wav';const id=kind==='product'?'legacy':'catalog-recording';
  const store=memoryDb({releases:[],products:[{id:'legacy',deleted_at:null,product_type:'single',metadata:{audio_key:key}}],catalog_tracks:kind==='catalog_track'?[{id,product_id:'legacy',removed_from_release_at:null,metadata:{audio_key:key}}]:[],audio_master_revisions:[{entity_kind:kind,entity_id:id,staged_master_key:key,status:'active',hls_prefix:kind+'/'}],hls_manifests:[{hls_prefix:kind+'/',duration_seconds:20}]});
  assert.equal((await resolveLyricAudio(store,'legacy',id)).duration,20);
 }
});
