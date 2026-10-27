import test, {mock} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent('export function resolve(s,c,next){return next(s==="next/server"?"next/server.js":s,c);}'),import.meta.url);
mock.module('next/server',{namedExports:{NextResponse:Response}});
let client;
mock.module('@/lib/supabase/admin',{namedExports:{getAdminClient:()=>client}});
const {getCatalogRefreshStateFromDB}=await import('../catalog-refresh-state.js');
const {GET}=await import('../../../app/api/catalog/releases/route.js');
function database(seed={},failure=null){
 const calls=[];
 return {calls,from(table){let columns='*';const q={select(value){columns=value;return q;},order(){return q;},async range(start,end){
  calls.push({table,columns,start,end});
  return {error:failure,data:(seed[table]||[]).slice(start,end+1).map(row=>Object.fromEntries(columns.split(',').map(key=>[key,row[key]??null])))};
 }};return q;}};
}
test('server token detects edits, additions, removals and lifecycle transitions without disclosing content',async()=>{
 const seed={products:[{id:'p',updated_at:'a',lyrics:'private lyrics',metadata:{secret:'value'}}],tracks:[{id:'t',updated_at:'a'}],catalog_tracks:[{id:'ct',updated_at:'a'}],releases:[{id:'r',updated_at:'a',status:'scheduled',available_at:'2030-01-01T00:00:00Z',preorder_enabled:true,preorder_starts_at:'2029-12-30T00:00:00Z',early_access_enabled:true,early_access_starts_at:'2029-12-31T00:00:00Z'}]};
 const at=time=>getCatalogRefreshStateFromDB(database(seed),new Date(time));
 const initial=await at('2029-12-29');assert.match(initial.revision,/^[a-f0-9]{64}$/);assert.deepEqual(Object.keys(initial),['revision']);
 assert.deepEqual(await at('2029-12-29T12:00:00Z'),initial,'time alone does not churn the token');
 const preorder=await at('2029-12-30');const early=await at('2029-12-31');const live=await at('2030-01-01');
 assert.equal(new Set([initial,preorder,early,live].map(x=>x.revision)).size,4);
 for(const table of ['products','tracks','catalog_tracks','releases']){
  const before=await at('2030-01-01');seed[table][0].updated_at+='b';assert.notDeepEqual(await at('2030-01-01'),before,table);
 }
 const before=await at('2030-01-01');seed.products.push({id:'new',updated_at:'a'});assert.notDeepEqual(await at('2030-01-01'),before);
 seed.products.pop();assert.deepEqual(await at('2030-01-01'),before);
 seed.releases[0].unavailable_at='2030-01-02T00:00:00Z';assert.notDeepEqual(await at('2030-01-01'),await at('2030-01-02'));
 const db=database(seed);await getCatalogRefreshStateFromDB(db);
 for(const call of db.calls){assert.doesNotMatch(call.columns,/lyrics|metadata|draft|email|allocation|r2_key|\*/);}
});
test('version reads page beyond PostgREST row limits and fail closed on database errors',async()=>{
 const db=database({tracks:Array.from({length:1001},(_,i)=>({id:String(i),updated_at:'a'}))});
 await getCatalogRefreshStateFromDB(db);assert.equal(db.calls.filter(x=>x.table==='tracks').length,2);
 await assert.rejects(getCatalogRefreshStateFromDB(database({},new Error('DB unavailable'))),/DB unavailable/);
});
test('revision API is private no-store and never reports a database failure as unchanged',async()=>{
 client=database();const response=await GET(new Request('https://fixture.invalid/api/catalog/releases?view=revision'));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');
 assert.match((await response.json()).revision,/^[a-f0-9]{64}$/);
 client=database({},new Error('fixture outage'));const failure=await GET(new Request('https://fixture.invalid/api/catalog/releases?view=revision'));
 assert.equal(failure.status,503);assert.deepEqual(await failure.json(),{error:'catalog_revision_unavailable'});
});
