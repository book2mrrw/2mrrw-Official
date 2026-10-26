// Actual local migration and draft-store functions, captured-schema PostgreSQL.
import assert from 'node:assert/strict';
import {createCreditDatabaseFixture} from './credits-postgres-fixture.mjs';
import {creditFixtureClient} from './credits-postgres-client.mjs';
import {readLyricDraft,saveLyricDraft} from '../src/lib/lyrics/draft-store.js';
import {encodeDraft,editorModel} from '../src/lib/lyrics/timing.js';
const db=await createCreditDatabaseFixture(),admin=creditFixtureClient(db);
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const release='11111111-1111-4111-8111-111111111111',track='22222222-2222-4222-8222-222222222222',second='33333333-3333-4333-8333-333333333333',product='44444444-4444-4444-8444-444444444444',catalog='55555555-5555-4555-8555-555555555555';
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
try{
 await db.query('INSERT INTO auth.users(id) VALUES($1),($2)',[actor,other]);
 await db.query("INSERT INTO releases(id,slug,title,status,release_type,content_kind) VALUES($1,'current','Current','published','album','music')",[release]);
 await db.query("INSERT INTO tracks(id,release_id,title,position,lyrics) VALUES($1,$2,'One',1,'Published one'),($3,$2,'Two',2,'Published two')",[track,release,second]);
 await db.query("INSERT INTO products(id,slug,title,product_type,release_type,price_cents,active,metadata) VALUES($1,'legacy','Legacy','single','singles',0,true,'{\"lyrics\":\"Published legacy\"}')",[product]);
 let read=await readLyricDraft(admin,actor,release,track);assert.equal(read.status,200);assert.equal(read.body.draft,null);assert.equal(read.body.base_lyrics,'Published one');pass('an existing release starts with no private draft and the exact published baseline');
 const model=editorModel('Half written\n\nStill working');model.lines[0].time=1.25;const partial=encodeDraft(model);
 let save=await saveLyricDraft(admin,actor,release,{recording_id:track,base_lyrics:'Published one',lyrics:partial});assert.equal(save.status,200);const revision=save.body.revision;
 read=await readLyricDraft(admin,actor,release,track);assert.equal(read.body.draft.lyrics,partial);assert.equal(read.body.revision,revision);assert.equal((await db.query('SELECT lyrics FROM tracks WHERE id=$1',[track])).rows[0].lyrics,'Published one');pass('unfinished text and partial timing round-trip without changing listener lyrics');
 assert.equal((await readLyricDraft(admin,other,release,track)).body.draft,null);assert.equal((await readLyricDraft(admin,actor,release,second)).body.draft,null);pass('drafts remain isolated by administrator and exact recording identity');
 save=await saveLyricDraft(admin,actor,release,{recording_id:track,base_lyrics:'Published one',lyrics:'Another edit',expected_draft_revision:null});assert.equal(save.status,409);assert.equal((await readLyricDraft(admin,actor,release,track)).body.draft.lyrics,partial);pass('stale or first-insert CAS revisions cannot overwrite a newer draft');
 save=await saveLyricDraft(admin,actor,release,{recording_id:track,base_lyrics:'Wrong baseline',lyrics:'Another edit',expected_draft_revision:revision});assert.equal(save.status,409);pass('a changed published baseline blocks a stale draft write atomically');
 save=await saveLyricDraft(admin,actor,release,{recording_id:track,base_lyrics:'Published one',lyrics:'Published one',expected_draft_revision:revision});assert.equal(save.status,200);read=await readLyricDraft(admin,actor,release,track);assert.equal(read.body.draft,null);assert.equal(read.body.revision,save.body.revision);pass('discarding to published lyrics clears recovery while retaining the current CAS token');
 save=await saveLyricDraft(admin,actor,product,{recording_id:product,base_lyrics:'Published legacy',lyrics:'Unfinished legacy lyrics'});assert.equal(save.status,200);assert.equal((await readLyricDraft(admin,actor,product,product)).body.draft.lyrics,'Unfinished legacy lyrics');pass('legacy singles without canonical release rows use the same private working-draft contract');
 await db.query("INSERT INTO catalog_tracks(id,product_id,slug,title,position,lyrics) VALUES($1,$2,'legacy-recording','Legacy recording',1,'Published catalog')",[catalog,product]);
 save=await saveLyricDraft(admin,actor,product,{recording_id:catalog,base_lyrics:'Published catalog',lyrics:'Unfinished catalog lyrics'});assert.equal(save.status,200);assert.equal((await readLyricDraft(admin,actor,product,catalog)).body.draft.lyrics,'Unfinished catalog lyrics');pass('legacy catalog recordings persist drafts without borrowing release-level or first-track lyrics');
 assert.equal((await readLyricDraft(admin,actor,release,catalog)).status,422);assert.equal((await readLyricDraft(admin,actor,product,product)).status,422);await db.query("UPDATE tracks SET removed_from_release_at=clock_timestamp() WHERE id=$1",[second]);assert.equal((await readLyricDraft(admin,actor,release,second)).status,422);pass('foreign, removed and obsolete virtual recording identities cannot read or save drafts');
 assert.equal((await saveLyricDraft(admin,actor,release,{recording_id:track,base_lyrics:'Published one',lyrics:'[2mrrw-draft:broken]'})).status,422);assert.equal((await saveLyricDraft(admin,actor,release,{recording_id:track,base_lyrics:'Published one',lyrics:'x'.repeat(250001)})).status,422);pass('malformed draft documents and oversized text fail safely');
 await db.query('UPDATE releases SET deleted_at=clock_timestamp() WHERE id=$1',[release]);assert.equal((await readLyricDraft(admin,actor,release,track)).status,422);pass('deleted releases do not expose retained private working copies');
 for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);await assert.rejects(()=>db.query('SELECT * FROM public.recording_lyric_drafts'));await assert.rejects(()=>db.query('SELECT public.get_recording_lyric_draft($1,$2,$3)',[actor,product,catalog]));await assert.rejects(()=>db.query('SELECT public.save_recording_lyric_draft($1,$2,$3,NULL,$4,$5)',[actor,product,catalog,'Published catalog','Tampered']));await db.exec('RESET ROLE');}pass('anonymous and authenticated client roles cannot read, write or execute private draft RPCs');
 console.log(`${checks} PostgreSQL draft checks passed. Local captured-schema fixture only; no remote migration or production write.`);
}finally{await db.close();}
