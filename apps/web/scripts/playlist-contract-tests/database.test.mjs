import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
let db;const user=randomUUID();
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
before(async()=>{
 db=new PGlite();
 await db.exec("create role anon;create role authenticated;create role service_role;create table public.catalog_tracks(album_slug text,slug text);create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 await db.exec(await readFile(new URL('../../supabase/migrations/20260729000000_user_playlists.sql',import.meta.url),'utf8'));
 await q('insert into auth.users values($1)',[user]);
 await db.exec(await readFile(new URL('../../supabase/migrations/20261001010000_playlist_identity_transactions.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());
async function create(){return (await q("insert into user_playlists(user_id) values($1) returning id",[user]))[0].id;}
async function mutate(id,revision,action,payload,actor=user){return (await q('select mutate_playlist_tracks($1,$2,$3,$4,$5) r',[id,actor,revision,action,payload]))[0].r;}
const key=(album,track)=>JSON.stringify([album,track]);
test('same slug in separate releases and standalone track coexist; repeated add is idempotent',async()=>{
 const id=await create();let revision=0;
 for(const albumSlug of ['album-a','album-b',null]){revision=(await mutate(id,revision,'add',{albumSlug,trackSlug:'intro'})).revision;}
 assert.equal((await q('select count(*)::int n from playlist_tracks where playlist_id=$1',[id]))[0].n,3);
 assert.equal((await mutate(id,revision,'add',{albumSlug:'album-a',trackSlug:'intro'})).revision,revision);
 await assert.rejects(mutate(id,revision,'remove',{keys:['intro']}),/ambiguous/);
 await mutate(id,revision,'remove',{keys:[key('album-b','intro')]});
 assert.equal((await q('select count(*)::int n from playlist_tracks where playlist_id=$1',[id]))[0].n,2);
});
test('full order commits atomically; stale, incomplete, duplicate orders leave state unchanged',async()=>{
 const id=await create();await mutate(id,0,'add',{trackSlug:'a',trackData:{id:'player-a'}});await mutate(id,1,'add',{trackSlug:'b'});
 await mutate(id,2,'reorder',{keys:[key(null,'b'),key(null,'a')]});
 const before=await q('select id,track_slug,sort_order from playlist_tracks where playlist_id=$1 order by sort_order',[id]);
 assert.deepEqual(before.map(t=>t.track_slug),['b','a']);
 for(const [rev,keys] of [[2,['a','b']],[3,['a']],[3,['a','a']],[3,['missing','a']]])await assert.rejects(mutate(id,rev,'reorder',{keys}));
 assert.deepEqual(await q('select id,track_slug,sort_order from playlist_tracks where playlist_id=$1 order by sort_order',[id]),before);
 await mutate(id,3,'reorder',{keys:['player-a','b']});
});
test('ownership and direct table access cannot bypass transaction boundary',async()=>{
 const id=await create();await assert.rejects(mutate(id,0,'add',{trackSlug:'a'},randomUUID()),{code:'42501'});
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  try{
   await assert.rejects(q('delete from playlist_tracks where playlist_id=$1',[id]),/permission denied/);
   if(role!=='service_role')await assert.rejects(mutate(id,0,'add',{trackSlug:'a'}),/permission denied/);
  }finally{await db.exec('reset role');}
 }
});
test('JSON identity preserves punctuation without ambiguous delimiters',async()=>{
 const id=await create();await mutate(id,0,'add',{albumSlug:'a, b',trackSlug:'x:y'});
 await mutate(id,1,'remove',{keys:[key('a, b','x:y')]});
 assert.equal((await q('select count(*)::int n from playlist_tracks where playlist_id=$1',[id]))[0].n,0);
});
async function legacyFixture(){
 const legacy=new PGlite();await legacy.exec("create role anon;create role authenticated;create role service_role;create table catalog_tracks(album_slug text,slug text);create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 await legacy.exec(await readFile(new URL('../../supabase/migrations/20260729000000_user_playlists.sql',import.meta.url),'utf8'));
 await legacy.query('insert into auth.users values($1)',[user]);
 const id=(await legacy.query('insert into user_playlists(user_id) values($1) returning id',[user])).rows[0].id;
 return {legacy,id};
}
const migration=()=>readFile(new URL('../../supabase/migrations/20261001010000_playlist_identity_transactions.sql',import.meta.url),'utf8');
test('existing verified release-as-track error is repaired without replacing rows or order',async()=>{
 const {legacy,id}=await legacyFixture();
 try{
  await legacy.exec("insert into catalog_tracks values('release','actual-track')");
  const before=(await legacy.query("insert into playlist_tracks(playlist_id,album_slug,track_slug,sort_order,track_data) values($1,'release','release',7,'{\"metadata\":{\"trackSlug\":\"actual-track\"}}') returning *",[id])).rows[0];
  await legacy.exec(await migration());
  const after=(await legacy.query('select * from playlist_tracks where id=$1',[before.id])).rows[0];
  assert.equal(after.track_slug,'actual-track');assert.equal(after.id,before.id);assert.equal(after.sort_order,7);assert.deepEqual(after.track_data,before.track_data);
 }finally{await legacy.close();}
});
test('unverified historical mismatch aborts the whole migration',async()=>{
 const {legacy,id}=await legacyFixture();
 try{
  await legacy.query("insert into playlist_tracks(playlist_id,album_slug,track_slug,track_data) values($1,'release','wrong','{\"trackSlug\":\"unverified\"}')",[id]);
  await assert.rejects(legacy.exec(await migration()),/requires catalog verification/);await legacy.exec('rollback');
  assert.equal((await legacy.query("select count(*)::int n from information_schema.columns where table_name='user_playlists' and column_name='revision'")).rows[0].n,0);
  assert.equal((await legacy.query('select track_slug from playlist_tracks where playlist_id=$1',[id])).rows[0].track_slug,'wrong');
 }finally{await legacy.close();}
});
