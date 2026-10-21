import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import vm from 'node:vm';
import {classifyAdminAuthorityDenial} from '../../src/lib/auth/admin-authority-diagnostics.js';

async function load(file,imports){
 const source=await readFile(new URL(file,import.meta.url),'utf8');
 const {code}=await transform(source,{loader:'js',format:'cjs'});
 const exports={},context={module:{exports},exports,URL,URLSearchParams,Date,console:{error:()=>{},warn:()=>{}},require:name=>{
  if(name in imports)return imports[name];throw new Error(`Unexpected import ${name}`);
 }};vm.runInNewContext(code,context);return context.module.exports;
}
async function route(){
 const calls=[],invalidations=[];
 const state={gate:{ok:true,user:{id:'admin-fixture'}},limit:{allowed:true},result:{data:{ok:true,slug:'fixture',release_type:'feature',semantics:'soft_delete'}}};
 const mod=await load('../../src/app/api/admin/releases/[id]/route.js',{
  'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},
  '@/lib/auth/admin-api-guard':{requireAdminActor:async options=>{calls.push(['gate',options]);return state.gate;},getAdminSessionUser:async()=>state.gate.user},
  '@/lib/auth/admin-authority-diagnostics':{classifyAdminAuthorityDenial},
  '@/lib/auth/constants':{isAdminUser:()=>true},
  '@/lib/supabase/admin':{getAdminClient:()=>({rpc:async(name,args)=>{calls.push(['rpc',name,args]);if(state.result instanceof Error)throw state.result;return state.result;}})},
  '@/lib/server/rate-limit':{checkRateLimit:async()=>state.limit,rateLimitResponse:()=>Response.json({error:'rate limited'},{status:429})},
  '@/lib/storage/r2':{discoverFileByExtensions:async()=>null},
  '@/lib/media/revalidate-storefront':{revalidateStorefront:(...args)=>invalidations.push(args)},
  '@/lib/releases/release-availability':{validateLifecycleConfiguration:()=>[]},
 });
 return {state,calls,invalidations,remove:id=>mod.DELETE(new Request('https://fixture.invalid/api/admin/releases/'+id,{method:'DELETE'}),{params:Promise.resolve({id})})};
}
const id='00000000-0000-4000-8000-000000000001';
for(const [reason,status] of [['no_session',401],['not_admin',403],['guest_principal',403],['custom_mfa_required',403],['custom_mfa_expired',403]])test(`DELETE denies ${reason} before touching database`,async()=>{
 const h=await route();h.state.gate={ok:false,reason};const r=await h.remove(id);assert.equal(r.status,status);assert.equal(h.calls.filter(x=>x[0]==='rpc').length,0);assert.equal(h.invalidations.length,0);
});
test('DELETE validates ID, recent MFA and rate limit before transaction',async()=>{
 const h=await route();assert.equal((await h.remove('invalid')).status,400);assert.equal(h.calls[0][1].recentSeconds,900);
 h.state.limit={allowed:false};assert.equal((await h.remove(id)).status,429);assert.equal(h.calls.filter(x=>x[0]==='rpc').length,0);
});
test('DELETE commits one coherent service transaction and invalidates after success',async()=>{
 const h=await route();const r=await h.remove(id);assert.equal(r.status,200);assert.equal((await r.json()).semantics,'soft_delete');
 assert.equal(h.calls.find(x=>x[0]==='rpc')[1],'delete_release');assert.equal(h.calls.find(x=>x[0]==='rpc')[2].p_actor_id,'admin-fixture');
 assert.deepEqual([...h.invalidations[0]],['fixture','feature']);assert.match(r.headers.get('cache-control'),/no-store/);
});
for(const failure of [{error:{code:'XX000'}},new Error('network'),{data:{ok:false,code:'release_not_found'}}])test(`DELETE failure ${failure.error?.code || failure.message || failure.data.code} cannot report success`,async()=>{
 const h=await route();h.state.result=failure;const r=await h.remove(id);assert.ok(r.status>=400);assert.equal(h.invalidations.length,0);assert.equal((await r.json()).ok,undefined);
});


test('recovery hydration excludes unknown/deleted identifiers and ambiguous track slugs',async()=>{
 const catalog={singles:[{slug:'kept',title:'Kept'}],features:[],albums:[{slug:'album-a',tracks:[{slug:'intro',title:'A',id:'a-track'},{slug:'unique',title:'Unique'}]},{slug:'album-b',tracks:[{slug:'intro',title:'B',id:'b-track'}]}],mixtapes:[]};
 const mod=await load('../../src/app/api/catalog/hydrate/route.js',{
  'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},
  '@/lib/media/catalog-db':{getStorefrontCatalogFromDB:async()=>catalog},
 });
 const r=await mod.GET(new Request('https://fixture.invalid/api/catalog/hydrate?ids=kept,removed,intro,unique'));
 const result=await r.json();assert.deepEqual(result.tracks.map(track=>track.slug),['kept','unique']);assert.deepEqual(result.failedIds,['removed','intro']);
 assert.match(result.tracks[1].src,/slug=album-a&trackSlug=unique/);assert.match(r.headers.get('cache-control'),/no-store/);
});

test('recovery hydration database failure returns 503 without fabricated fallback releases',async()=>{
 const mod=await load('../../src/app/api/catalog/hydrate/route.js',{
  'next/server':{NextResponse:{json:(data,options)=>Response.json(data,options)}},
  '@/lib/media/catalog-db':{getStorefrontCatalogFromDB:async()=>null},
 });
 const r=await mod.GET(new Request('https://fixture.invalid/api/catalog/hydrate?ids=removed'));
 assert.equal(r.status,503);assert.deepEqual((await r.json()).tracks,[]);
});
