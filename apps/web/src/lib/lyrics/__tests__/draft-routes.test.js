import test,{mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'),import.meta.url);
mock.module('next/server',{namedExports:{NextResponse:Response}});
let user,allowed,calls,publicSaves,revalidations;
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',release='11111111-1111-4111-8111-111111111111',recording='22222222-2222-4222-8222-222222222222';
mock.module('@/lib/auth/admin-api-guard',{namedExports:{getAdminSessionUser:async()=>user,requireAdminActor:async()=>({ok:true,user})}});
mock.module('@/lib/auth/constants',{namedExports:{isAdminUser:value=>value?.admin===true}});
mock.module('@/lib/auth/admin-authority-diagnostics',{namedExports:{classifyAdminAuthorityDenial:()=>({})}});
mock.module('@/lib/supabase/admin',{namedExports:{getAdminClient:()=>({})}});
mock.module('@/lib/server/rate-limit',{namedExports:{checkRateLimit:async()=>({allowed,retryAfterSeconds:10}),rateLimitResponse:()=>new Response(null,{status:429})}});
mock.module('@/lib/storage/r2',{namedExports:{discoverFileByExtensions:async()=>null}});
mock.module('@/lib/media/revalidate-storefront',{namedExports:{revalidateStorefront:()=>{revalidations++;}}});
mock.module('@/lib/releases/release-availability',{namedExports:{validateLifecycleConfiguration:()=>[]}});
mock.module('@/lib/credits/admin-store',{namedExports:{loadEditableRelease:async()=>({release:{id:release,cover_art_r2_key:'cover'}}),commitCreditEdit:async()=>({status:200,body:{ok:true}})}});
mock.module('@/lib/lyrics/admin-store',{namedExports:{commitLyricEdit:async()=>{publicSaves++;return {status:200,body:{ok:true},result:{status:'published',slug:'song',release_type:'single'}};}}});
mock.module('@/lib/lyrics/draft-store',{namedExports:{readLyricDraft:async(...args)=>{calls.push(['read',...args.slice(1)]);return {status:200,body:{ok:true,draft:null,base_lyrics:'Published'}};},saveLyricDraft:async(...args)=>{calls.push(['save',...args.slice(1)]);return {status:200,body:{ok:true,revision:'saved'}};}}});
const {GET,PATCH}=await import('../../../app/api/admin/releases/[id]/route.js');
const params={params:Promise.resolve({id:release})};
const get=(owner=actor)=>new Request(`https://site.invalid/api/admin/releases/${release}?lyric_draft=${recording}&draft_owner=${owner}`);
const patch=(owner=actor)=>new Request(`https://site.invalid/api/admin/releases/${release}`,{method:'PATCH',body:JSON.stringify({lyric_draft_version:1,draft_owner_id:owner,recording_id:recording,lyrics:'Partial timing'})});
beforeEach(()=>{user={id:actor,admin:true};allowed=true;calls=[];publicSaves=0;revalidations=0;});
test('unauthenticated and non-admin users cannot read or save private lyric drafts',async()=>{
 for(const value of [null,{id:actor,admin:false}]){user=value;assert.equal((await GET(get(),params)).status,401);assert.equal((await PATCH(patch(),params)).status,401);}assert.equal(calls.length,0);
});
test('the existing admin GET scopes private drafts to the authenticated actor and exact recording',async()=>{
 const result=await GET(get(),params);assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(calls,[['read',actor,release,recording]]);
});
test('the private save operation cannot publish or invalidate listener caches',async()=>{
 const result=await PATCH(patch(),params);assert.equal(result.status,200);assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal(calls[0][1],actor);assert.equal(calls[0][2],release);assert.equal(publicSaves,0);assert.equal(revalidations,0);
});
test('queued requests fail closed when the signed-in account changes',async()=>{
 user={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',admin:true};assert.equal((await GET(get(),params)).status,409);assert.equal((await PATCH(patch(),params)).status,409);assert.equal(calls.length,0);
});
test('a request cannot choose a different draft owner through client input',async()=>{
 assert.equal((await GET(get('different'),params)).status,409);assert.equal((await PATCH(patch('different'),params)).status,409);assert.equal(calls.length,0);
});
test('existing rate limits also protect draft reads and writes',async()=>{
 allowed=false;assert.equal((await GET(get(),params)).status,429);assert.equal((await PATCH(patch(),params)).status,429);assert.equal(calls.length,0);
});
test('normal release metadata reads keep their existing response shape',async()=>{
 const result=await GET(new Request('https://site.invalid/api/admin/releases/'+release),params);assert.equal((await result.json()).release.id,release);assert.equal(calls.length,0);
});
test('applying public lyrics keeps its original commit and revalidation boundary',async()=>{
 const result=await PATCH(new Request('https://site.invalid/api/admin/releases/'+release,{method:'PATCH',body:JSON.stringify({lyric_edit_version:1,revision:{},track_lyrics:[]})}),params);assert.equal(result.status,200);assert.equal(publicSaves,1);assert.equal(revalidations,1);assert.equal(calls.length,0);
});
