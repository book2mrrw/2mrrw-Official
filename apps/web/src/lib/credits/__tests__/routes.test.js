import test, { mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { classifyRouteAccess, RouteAccessClass } from '../../auth/route-access-policy.js';
register('data:text/javascript,' + encodeURIComponent('export function resolve(s,c,next){return next(s === "next/server" ? "next/server.js" : s,c);}'),import.meta.url);
mock.module('next/server',{namedExports:{NextResponse:Response}});
let user, calls, ready, failure, result;
const admin={rpc:async(name,args)=>{if(name==='save_release_credit_draft'){calls.push({rpc:name,args});return {data:{saved_at:'2026-10-21T12:00:00Z'},error:null};}return {data:ready?{version:1,private_allocations:true,service_role_only:true}:null,error:ready?null:{code:'PGRST202'}};},from(table){
  calls.push({table});const q={select:()=>q,ilike:(...args)=>{calls.push({search:args});return q;},order:()=>q,limit:async()=>({data:result,error:failure}),insert:(row)=>{calls.push({insert:row});return q;},single:async()=>({data:result,error:failure})};return q;
}};
mock.module('@/lib/auth/consumer-authority',{namedExports:{requireConsumerPrincipal:async()=>user}});
mock.module('@/lib/auth/admin-api-guard',{namedExports:{getAdminSessionUser:async()=>user}});
mock.module('@/lib/auth/constants',{namedExports:{isAdminUser:u=>u?.isAdmin===true}});
mock.module('@/lib/supabase/admin',{namedExports:{getAdminClient:()=>admin}});
mock.module('@/lib/server/rate-limit',{namedExports:{checkRateLimit:async()=>({allowed:true}),rateLimitResponse:()=>new Response(null,{status:429})}});
const {GET,POST}=await import('../../../app/api/admin/contributors/route.js');
const {PUT: saveDraft}=await import('../../../app/api/admin/releases/[id]/draft/route.js');
const {GET: getCredits}=await import('../../../app/api/catalog/releases/[slug]/route.js');
beforeEach(()=>{user={id:'admin',isAdmin:true};calls=[];ready=true;failure=null;result=[];});
test('catalog attribution and contributor editing retain their distinct authentication boundaries',()=>{
  assert.equal(classifyRouteAccess('/api/catalog/releases/album','GET'),RouteAccessClass.AUTHENTICATED_CONSUMER);
  assert.equal(classifyRouteAccess('/api/admin/contributors','GET'),RouteAccessClass.ADMIN);
});
test('unauthenticated and non-admin callers cannot search or create directory records',async()=>{
  for(const principal of [null,{id:'listener',isAdmin:false}]){
    user=principal;
    assert.equal((await GET(new Request('https://fixture.invalid/api/admin/contributors?q=Name'))).status,401);
    assert.equal((await POST(new Request('https://fixture.invalid/api/admin/contributors',{method:'POST',body:JSON.stringify({name:'Name'})}))).status,401);
  }
  assert.equal(calls.length,0);
});
test('unverified directory permissions prevent both reads and creation',async()=>{
  ready=false;
  assert.equal((await GET(new Request('https://fixture.invalid/api/admin/contributors?q=Name'))).status,503);
  assert.equal((await POST(new Request('https://fixture.invalid/api/admin/contributors',{method:'POST',body:JSON.stringify({name:'Name'})}))).status,503);
  assert.equal(calls.length,0);
});
test('directory search requests only the safe suggestion columns',async()=>{
  result=[{id:'uuid',name:'Name'}];
  const response=await GET(new Request('https://fixture.invalid/api/admin/contributors?q=Name'));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{contributors:result});
  assert.equal(calls[0].table,'collaborators');
});
test('explicit same-name creation inserts rather than upserts or merges',async()=>{
  result={id:'new-uuid',name:'Same Name'};
  const response=await POST(new Request('https://fixture.invalid/api/admin/contributors',{method:'POST',body:JSON.stringify({name:'Same Name',email:'ignored',user_id:'ignored'})}));
  assert.equal(response.status,201);assert.deepEqual(calls.find(c=>c.insert).insert,{name:'Same Name'});
});
test('invalid creation and failed searches return accurate failure statuses',async()=>{
  assert.equal((await POST(new Request('https://fixture.invalid/api/admin/contributors',{method:'POST',body:'not json'}))).status,400);
  assert.equal((await POST(new Request('https://fixture.invalid/api/admin/contributors',{method:'POST',body:'{"name":""}'}))).status,422);
  failure={code:'XX000'};assert.equal((await GET(new Request('https://fixture.invalid/api/admin/contributors?q=Name'))).status,503);
});

test('attribution endpoint rejects unauthenticated callers before database access even without middleware',async()=>{
  user=null;const response=await getCredits(new Request('https://fixture.invalid/api/catalog/releases/single'),{params:Promise.resolve({slug:'single'})});
  assert.equal(response.status,401);assert.equal(calls.length,0);
});

test('draft autosave preserves unfinished names and invalid intermediate percentages for correction',async()=>{
 const payload={data:{credit_groups:{songwriter:{state:'draft',entries:[{name:'',percentage:'120.'}]}}},tracks:[]};
 const response=await saveDraft(new Request('https://fixture.invalid/api/admin/releases/id/draft',{method:'PUT',body:JSON.stringify({draft_payload:payload})}),{params:Promise.resolve({id:'release-id'})});
 assert.equal(response.status,200);assert.deepEqual(calls.find(c=>c.rpc==='save_release_credit_draft').args.p_payload,payload);
});
