import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent('export function resolve(s,c,next){return next(s === "next/server" ? "next/server.js" : s,c);}'),import.meta.url);
import {test,before,after,mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const userId=randomUUID();let user={id:userId},db,server,url,playlistId;
let entitled=true,entitlementError=false,accessCalls=[];
mock.module('@/lib/commerce/entitlements',{namedExports:{userCanStreamProduct:async(...args)=>{
 accessCalls.push(args);if(entitlementError)throw new Error('authority unavailable');return entitled;
}}});
mock.module('@/lib/auth/session-user',{namedExports:{getFanSessionUser:async()=>user}});
mock.module('@/lib/server/rate-limit',{namedExports:{checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>Response.json({}, {status:429})}});
mock.module('@/lib/supabase/admin',{namedExports:{getAdminClient:()=>({rpc:async(name,p)=>{
 assert.equal(name,'mutate_playlist_tracks');
 try{return {data:(await db.query('select mutate_playlist_tracks($1,$2,$3,$4,$5) r',[p.p_playlist_id,p.p_user_id,p.p_revision,p.p_action,p.p_payload])).rows[0].r};}
 catch(error){return {error:{code:error.code,message:error.message}};}
}})}});
const handlers=await import('../../src/app/api/playlists/[id]/tracks/route.js');
before(async()=>{
 db=new PGlite();await db.exec("create role anon;create role authenticated;create role service_role;create table public.catalog_tracks(album_slug text,slug text);create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 for(const name of ['20260729000000_user_playlists.sql','20261001010000_playlist_identity_transactions.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1)',[userId]);
 playlistId=(await db.query('insert into user_playlists(user_id) values($1) returning id',[userId])).rows[0].id;
 server=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await handlers[req.method](new Request('http://localhost'+req.url,{method:req.method,headers:{'content-type':'application/json'},body:Buffer.concat(chunks)}),{params:Promise.resolve({id:playlistId})});
   res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
  }catch{res.writeHead(500);res.end('{}');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});url=`http://127.0.0.1:${server.address().port}/tracks`;
});
after(async()=>{if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await db?.close();});
const request=(method,body)=>fetch(url,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
test('real HTTP handler and SQL transaction add/reorder/remove exact release identities',async()=>{
 for(const [revision,albumSlug] of [[0,'future-a'],[1,'future-b']]){
  const response=await request('POST',{revision,albumSlug,trackSlug:'intro'});assert.equal(response.status,200);assert.equal((await response.json()).revision,revision+1);
 }
 const keys=['future-b','future-a'].map(a=>JSON.stringify([a,'intro']));
 assert.equal((await request('PUT',{revision:2,trackKeys:keys})).status,200);
 const rows=(await db.query('select album_slug from playlist_tracks where playlist_id=$1 order by sort_order',[playlistId])).rows;
 assert.deepEqual(rows.map(r=>r.album_slug),['future-b','future-a']);
 assert.equal((await request('DELETE',{revision:3,trackKey:keys[0]})).status,200);
 assert.equal((await db.query('select count(*)::int n from playlist_tracks where playlist_id=$1',[playlistId])).rows[0].n,1);
});
test('stale, old-client, unauthorized and ambiguous writes fail visibly',async()=>{
 assert.equal((await request('PUT',{revision:0,trackKeys:[]})).status,409);
 assert.equal((await request('POST',{trackSlug:'legacy-no-revision'})).status,409);
 user=null;assert.equal((await request('POST',{revision:4,trackSlug:'denied'})).status,401);
 user={id:randomUUID()};assert.equal((await request('POST',{revision:4,trackSlug:'denied'})).status,404);
 user={id:userId};assert.equal((await request('PUT',{revision:4,trackKeys:['bad','bad']})).status,400);
 assert.equal((await db.query('select revision from user_playlists where id=$1',[playlistId])).rows[0].revision,4);
});
test('server rejects forged saved access and checks the authenticated user against the owning release',async()=>{
 entitled=false;accessCalls=[];
 try {
  const response=await request('POST',{revision:4,albumSlug:'future-a',trackSlug:'intro',trackData:{isAdmin:true,access:{canStream:true},ownedSlugs:['future-a']}});
  assert.equal(response.status,403);
  assert.equal((await response.json()).code,'PLAYLIST_ENTITLEMENT_REQUIRED');
  assert.equal(accessCalls[0][0],userId);assert.equal(accessCalls[0][1],'future-a');assert.equal(accessCalls[0][2],user);
  assert.equal((await db.query('select revision from user_playlists where id=$1',[playlistId])).rows[0].revision,4);
  // Losing media access must not prevent users from organizing saved references.
  assert.equal((await request('PUT',{revision:4,trackKeys:[JSON.stringify(['future-a','intro'])]})).status,200);
  assert.equal(accessCalls.length,1);
 } finally {entitled=true;}
});
test('entitlement outage fails closed without inserting or advancing playlist revision',async()=>{
 entitlementError=true;accessCalls=[];
 try {
  const response=await request('POST',{revision:5,trackSlug:'standalone'});
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'PLAYLIST_ENTITLEMENT_UNAVAILABLE');
  assert.equal(accessCalls[0][1],'standalone');
  assert.equal((await db.query('select revision from user_playlists where id=$1',[playlistId])).rows[0].revision,5);
 } finally {entitlementError=false;}
});
