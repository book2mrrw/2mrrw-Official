import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {register} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mock,test} from 'node:test';

const load=relative=>import(pathToFileURL(path.resolve(relative)));
register('data:text/javascript,'+encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'),import.meta.url);
mock.module('next/server',{namedExports:{NextResponse:Response}});
let client;
mock.module('@/lib/auth/admin-api-guard',{namedExports:{getAdminSessionUser:async()=>({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'})}});
mock.module('@/lib/auth/constants',{namedExports:{isAdminUser:()=>true}});
mock.module('@/lib/supabase/admin',{namedExports:{getAdminClient:()=>client}});
mock.module('@/lib/storage/r2',{namedExports:{getR2ObjectMetadata:async()=>({etag:'fixture',contentLength:100}),listR2Objects:async()=>[],headR2ObjectKey:async()=>true,copyR2Object:async()=>{},getPublicR2Url:key=>'https://fixture.invalid/'+key}});
mock.module('@/lib/server/rate-limit',{namedExports:{checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>Response.json({error:'rate limit'},{status:429})}});
mock.module('@/lib/media/revalidate-storefront',{namedExports:{revalidateStorefront:()=>{}}});
mock.module('@/lib/media/entity-resolver',{namedExports:{clearEntityResolverCaches:()=>{}}});
mock.module('@/lib/media-urls',{namedExports:{catalogCoverUrl:()=>null,catalogMotionVideoUrl:()=>null}});
mock.module('@/lib/playback/resolve-playback-key',{namedExports:{clearPersistedPreviewKey:async()=>{}}});
mock.module('@/lib/hls/submit-audio-job',{namedExports:{submitAudioJob:async()=>({id:'fixture'})}});
const {createCreditDatabaseFixture}=await load('scripts/credits-postgres-fixture.mjs');
const {creditFixtureClient}=await load('scripts/credits-postgres-client.mjs');
const {POST:publish}=await load('src/app/api/admin/releases/[id]/publish/route.js');
const {loadEditableRelease}=await load('src/lib/credits/admin-store.js');
const {encodeLyrics,decodeLyrics,lyricClock}=await load('src/lib/lyrics/timing.js');
const {audioFingerprint}=await load('src/lib/lyrics/audio-source.js');
const {getCatalogReleaseDetailFromDB}=await load('src/lib/media/catalog-db.js');
const {memoryDb}=await load('src/lib/credits/__tests__/memory-db.mjs');
const release='11111111-1111-4111-8111-111111111111',one='22222222-2222-4222-8222-222222222222',two='33333333-3333-4333-8333-333333333333';
const timed=(id,text)=>encodeLyrics({reference:audioFingerprint(id,{etag:'fixture',contentLength:100}),duration:90,lines:[{time:1,text,words:[]},{time:8,text:text+' next',words:[]}]});

async function seed({count=2,type="album"}={}){
 const db=await createCreditDatabaseFixture();client=creditFixtureClient(db);
 await db.query("INSERT INTO releases(id,title,slug,status,release_type,content_kind,cover_art_r2_key,updated_at) VALUES($1,'Audit album','draft-audit-album','draft','album','music','images/audit.webp',clock_timestamp())",[release]);
 for(const [id,title,position] of [[one,'One',1],[two,'Two',2]])await db.query("INSERT INTO tracks(id,release_id,title,position,lyrics,audio_r2_key,master_r2_key,preview_r2_key,preview_start_seconds,upload_status,updated_at) VALUES($1,$2,$3,$4,'',$5,$5,$6,30,'ready',clock_timestamp())",[id,release,title,position,`digital-assets/albums/draft-audit-album/${title.toLowerCase()}/master.wav`,`previews/albums/draft-audit-album/${title.toLowerCase()}.mp3`]);
 if(type!=='album') await db.query('UPDATE releases SET release_type=$1 WHERE id=$2',[type,release]);
 if(count===3) await db.query("INSERT INTO tracks(id,release_id,title,position,lyrics,audio_r2_key,preview_r2_key,upload_status) VALUES('44444444-4444-4444-8444-444444444444',$1,'Three',3,'Three lyric','digital-assets/albums/draft-audit-album/three/master.wav','previews/three.mp3','ready')",[release]);
 return db;
}
async function run(db,tracks,extra={}){
 client=creditFixtureClient(db);const detail=await loadEditableRelease(client,release);
 const response=await publish(new Request('https://fixture.invalid/publish',{method:'POST',body:JSON.stringify({revision:detail.revision,title:'Audit album',price_cents:100,tracks,...extra})}),{params:Promise.resolve({id:release})});
 return {status:response.status,body:await response.json()};
}
const rows=(timing=true)=>[{id:one,title:'One',slug:'one',position:1,lyrics:timing?timed(one,'One lyric'):'One lyric'},{id:two,title:'Two',slug:'two',position:2,lyrics:timing?timed(two,'Two lyric'):'Two lyric'}];
test("timed publication projects exact lyrics to the fresh catalog reader and preview clock",async()=>{
 const db=await seed();try{
  const input=rows();const outcome=await run(db,input);assert.equal(outcome.status,200,JSON.stringify(outcome));
  const product=(await db.query('SELECT * FROM products WHERE release_id=$1',[release])).rows[0];
  const source=(await db.query('SELECT * FROM tracks WHERE release_id=$1 ORDER BY position',[release])).rows;
  const catalog=(await db.query('SELECT * FROM catalog_tracks WHERE product_id=$1 ORDER BY position',[product.id])).rows;
  assert.deepEqual(source.map(x=>decodeLyrics(x.lyrics).lines[0].text),['One lyric','Two lyric']);
  assert.deepEqual(catalog.map(x=>x.lyrics),source.map(x=>x.lyrics));
  const rel=(await db.query('SELECT * FROM releases WHERE id=$1',[release])).rows[0];
  client=memoryDb({releases:[rel],products:[{...product,releases:rel}],tracks:source,catalog_tracks:catalog,audio_master_revisions:[]});
  const detail=await getCatalogReleaseDetailFromDB(product.slug);
  assert.deepEqual(detail.tracks.map(x=>x.sync_status),['verified','verified']);
  assert.deepEqual(detail.tracks.map(x=>decodeLyrics(x.lyrics).lines[0].text),['One lyric','Two lyric']);
  const recording=detail.tracks[1];const position=lyricClock({currentTrack:{slug:product.slug,metadata:{albumSlug:product.slug,trackSlug:recording.slug,access:{previewOnly:true}}},releaseSlug:product.slug,recording,isPreview:true,currentTime:2,previewStartSeconds:recording.preview_start_seconds});
  assert.equal(position,32);
 }finally{await db.close();}
});

test('timed lyrics follow IDs through first-publish swap and republish three-track cycle',async()=>{
 const db=await seed({count:3});try{
  const third='44444444-4444-4444-8444-444444444444';
  const input=[...rows(),{id:third,title:'Three',slug:'three',position:3,lyrics:timed(third,'Three lyric')}];
  const swapped=[{...input[1],position:1},{...input[0],position:2},input[2]];
  assert.equal((await run(db,swapped)).status,200);
  const original=(await db.query('SELECT id,lyrics FROM tracks WHERE release_id=$1 ORDER BY id',[release])).rows;
  const cycle=[{...input[0],position:3,isrc:'USABC2600001'},{...input[2],position:1},{...input[1],position:2,isrc:'USABC2600002'}];
  const outcome=await run(db,cycle);assert.equal(outcome.status,200,JSON.stringify(outcome));
  assert.deepEqual((await db.query('SELECT id FROM tracks WHERE release_id=$1 ORDER BY position',[release])).rows.map(r=>r.id),[third,two,one]);
  assert.deepEqual((await db.query('SELECT id,lyrics FROM tracks WHERE release_id=$1 ORDER BY id',[release])).rows,original);
  const catalog=(await db.query('SELECT track_id,track_number,position,lyrics FROM catalog_tracks ORDER BY position')).rows;
  assert.deepEqual(catalog.map(r=>r.track_id),[third,two,one]);
  for(const ct of catalog){assert.equal(ct.track_number,ct.position);assert.equal(ct.lyrics,original.find(r=>r.id===ct.track_id).lyrics);}
  assert.deepEqual((await db.query('SELECT isrc FROM tracks WHERE id IN ($1,$2) ORDER BY id',[one,two])).rows.map(r=>r.isrc),['USABC2600001','USABC2600002']);
  assert.equal((await run(db,[])).status,200,'partial republish retains saved per-recording lyrics');
  assert.deepEqual((await db.query('SELECT id,lyrics FROM tracks WHERE release_id=$1 ORDER BY id',[release])).rows,original);
 }finally{await db.close();}
});

test('historical SQL rejects a correct-ID swap, forward transaction commits it and rejects duplicate final numbers atomically',async()=>{
 const db=await seed();try{
  assert.equal((await run(db,rows(false))).status,200);
  const old=await fs.readFile('supabase/migrations/20261021020000_atomic_credit_publication.sql','utf8');
  await db.exec(old);
  const outcome=await run(db,[{...rows(false)[1],position:1},{...rows(false)[0],position:2}]);
  assert.equal(outcome.status,422);
  assert.deepEqual((await db.query('SELECT lyrics FROM tracks ORDER BY position')).rows.map(r=>r.lyrics),['One lyric','Two lyric']);
  const forward=await fs.readFile('supabase/migrations/20261027021455_atomic_active_catalog_order.sql','utf8');
  await db.exec(forward.slice(forward.indexOf('CREATE OR REPLACE FUNCTION')));
  assert.equal((await run(db,[{...rows(false)[1],position:1},{...rows(false)[0],position:2}])).status,200);
  client=creditFixtureClient(db);
  const detail=await loadEditableRelease(client,release);
  const product=(await db.query('SELECT * FROM products WHERE release_id=$1',[release])).rows[0];
  const rel=(await db.query('SELECT * FROM releases WHERE id=$1',[release])).rows[0];
  const catalog=(await db.query('SELECT * FROM catalog_tracks ORDER BY position')).rows;
  const before=(await db.query('SELECT id,lyrics,position FROM tracks ORDER BY id')).rows;
  const invalid=await client.rpc('commit_release_publication',{p_release_ref_id:release,p_expected_revision:detail.revision,p_payload:{product,release:rel,catalog_tracks:catalog.map(r=>({...r,track_number:1})),recordings:before}});
  assert.equal(invalid.error?.code,'22023');
  assert.deepEqual((await db.query('SELECT id,lyrics,position FROM tracks ORDER BY id')).rows,before);
  assert.deepEqual((await db.query('SELECT * FROM catalog_tracks ORDER BY position')).rows,catalog);
 }finally{await db.close();}
});

test('removed recordings retain history while remaining active tracks can reuse their order numbers',async()=>{
 const db=await seed({count:3});try{
  assert.equal((await run(db,rows())).status,200);
  const old=await fs.readFile('supabase/migrations/20261018150000_release_track_removal.sql','utf8');
  await db.exec(old.slice(old.indexOf('create or replace function')));
  await assert.rejects(db.query('SELECT remove_release_track($1,$2)',[release,one]),e=>e.code==='42703');
  const forward=await fs.readFile('supabase/migrations/20261027021455_atomic_active_catalog_order.sql','utf8');
  await db.exec(forward.slice(forward.indexOf('create or replace function public.remove_release_track')));
  assert.equal((await db.query('SELECT remove_release_track($1,$2) AS result',[release,one])).rows[0].result.ok,true);
  const removed=(await db.query('SELECT * FROM catalog_tracks WHERE track_id=$1',[one])).rows[0];
  assert.ok(removed.removed_from_release_at);assert.equal(removed.active_track_number,null);
  const outcome=await run(db,[]);assert.equal(outcome.status,200,JSON.stringify(outcome));
  const active=(await db.query('SELECT track_number FROM catalog_tracks WHERE removed_from_release_at IS NULL ORDER BY position')).rows;
  assert.deepEqual(active.map(r=>r.track_number),[1,2]);
  assert.deepEqual((await db.query('SELECT * FROM catalog_tracks WHERE track_id=$1',[one])).rows[0],removed);
  const product=(await db.query('SELECT id FROM products WHERE release_id=$1',[release])).rows[0];
  const second=(await db.query('SELECT id FROM catalog_tracks WHERE track_id=$1',[two])).rows[0];
  assert.equal((await db.query('SELECT remove_release_track($1,$2) AS result',[product.id,second.id])).rows[0].result.ok,true);
  assert.ok((await db.query('SELECT removed_from_release_at FROM tracks WHERE id=$1',[two])).rows[0].removed_from_release_at);
  assert.equal((await db.query("SELECT remove_release_track($1,'44444444-4444-4444-8444-444444444444') AS result",[release])).rows[0].result.code,'last_track');
 }finally{await db.close();}
});

test('scheduled timed publication activates without altering the saved or projected cue documents',async()=>{
 const db=await seed();try{
  await db.exec(await fs.readFile('supabase/migrations/20261027021450_repair_scheduled_lyric_publication.sql','utf8'));
  const outcome=await run(db,rows(),{scheduled_at:'2030-01-01T00:00:00Z'});
  assert.equal(outcome.status,200,JSON.stringify(outcome));assert.equal(outcome.body.status,'scheduled');
  const before=(await db.query('SELECT id,lyrics FROM tracks ORDER BY id')).rows;
  const projection=(await db.query('SELECT id,lyrics FROM catalog_tracks ORDER BY id')).rows;
  assert.equal((await db.query("SELECT * FROM activate_scheduled_release($1,'2030-01-02Z')",[release])).rows[0].activated,true);
  assert.deepEqual((await db.query('SELECT id,lyrics FROM tracks ORDER BY id')).rows,before);
  assert.deepEqual((await db.query('SELECT id,lyrics FROM catalog_tracks ORDER BY id')).rows,projection);
  assert.equal((await db.query('SELECT active FROM products WHERE release_id=$1',[release])).rows[0].active,true);
 }finally{await db.close();}
});

test('foreign, duplicate, missing, invalid and overlapping identities are rejected before publication',async()=>{
 const db=await seed();try{
  for(const input of [[{...rows()[0],id:'99999999-9999-4999-8999-999999999999'}],[rows()[0],rows()[0]],[{position:1,lyrics:'wrong'}],[null],[{...rows()[0],position:0}],[{...rows()[0],position:2}]]){
   const outcome=await run(db,input);assert.equal(outcome.status,422,JSON.stringify(outcome));
   assert.equal((await db.query('SELECT count(*)::int AS count FROM products')).rows[0].count,0);
  }
  const stale=(await loadEditableRelease(creditFixtureClient(db),release)).revision;
  await db.query('UPDATE releases SET updated_at=clock_timestamp() WHERE id=$1',[release]);
  assert.equal((await run(db,rows(),{revision:stale})).status,409);
 }finally{await db.close();}
});

test('single wizard null-ID placeholder cannot override the real recording',async()=>{
 const db=await seed({type:'single'});try{
  await db.query('DELETE FROM tracks WHERE id=$1',[two]);
  const lyrics=timed(one,'Actual single lyric');
  const outcome=await run(db,[{id:null,position:1,title:'Unused',lyrics:'Wrong lyric'}],{track_id:one,lyrics});
  assert.equal(outcome.status,200,JSON.stringify(outcome));
  assert.equal(decodeLyrics((await db.query('SELECT lyrics FROM tracks WHERE id=$1',[one])).rows[0].lyrics).lines[0].text,'Actual single lyric');
 }finally{await db.close();}
});

test('adding a recording to a published album preserves saved cue documents and stable catalog identities',async()=>{
 const db=await seed();try{
  assert.equal((await run(db,rows())).status,200);
  const before=(await db.query('SELECT id,track_id,slug,lyrics FROM catalog_tracks ORDER BY id')).rows;
  const third='44444444-4444-4444-8444-444444444444';
  await db.query("INSERT INTO tracks(id,release_id,title,position,lyrics,audio_r2_key,preview_r2_key,upload_status) VALUES($1,$2,'Three',3,$3,'digital-assets/albums/audit-album/three/master.wav','previews/three.mp3','ready')",[third,release,timed(third,'New recording lyric')]);
  const outcome=await run(db,[]);assert.equal(outcome.status,200,JSON.stringify(outcome));
  assert.deepEqual((await db.query('SELECT id,track_id,slug,lyrics FROM catalog_tracks WHERE track_id<>$1 ORDER BY id',[third])).rows,before);
  assert.equal(decodeLyrics((await db.query('SELECT lyrics FROM catalog_tracks WHERE track_id=$1',[third])).rows[0].lyrics).lines[0].text,'New recording lyric');
 }finally{await db.close();}
});
