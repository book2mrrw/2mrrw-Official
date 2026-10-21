import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEditableRelease, validateCreditEdit, commitCreditEdit, creditStorageCapabilities } from '../admin-store.js';
import { memoryDb } from './memory-db.mjs';

const releaseId='11111111-1111-4111-8111-111111111111';
const productId='22222222-2222-4222-8222-222222222222';
const trackId='33333333-3333-4333-8333-333333333333';
const otherId='44444444-4444-4444-8444-444444444444';
const group={state:'legacy',entries:[{name:'Saved Writer',percentage:''}]};
function fixture({ready=false,legacy=false}={}){
  const db=memoryDb({
    releases:legacy?[]:[{id:releaseId,deleted_at:null,slug:'album',status:'published',release_type:'album',upc:'001234567890',updated_at:'release-revision',metadata:{},release_date:'2026-01-01'}],
    products:[{id:productId,deleted_at:null,release_id:legacy?null:releaseId,slug:'album',title:'Saved Album',active:true,updated_at:'product-revision',credits:{written_by:['Release Writer'],mixing_engineer:'Engineer'},metadata:{artist:'Primary Artist',genre:'R&B',upc:'001234567890'}}],
    tracks:legacy?[]:[{id:trackId,release_id:releaseId,deleted_at:null,slug:'one',title:'One',position:1,isrc:'Saved-ISRC',lyrics:'Saved Lyrics',updated_at:'track-revision',removed_from_release_at:null,written_by:['Stale Writer']}],
    catalog_tracks:[{id:otherId,track_id:trackId,product_id:productId,slug:'one',title:'One',position:1,updated_at:'catalog-track-revision',removed_from_release_at:null,credits:{written_by:['Track Writer'],isrc:'Saved-ISRC'},metadata:{lyrics:'Legacy Lyrics'}}],
  });
  db.rpc=async name=>name==='credit_storage_capabilities'?{data:ready?{version:1,private_allocations:true,service_role_only:true}:null,error:ready?null:{code:'PGRST202'}}:{data:[],error:null};
  return db;
}
test('published detail hydrates title artist credits UPC lyrics and recording ISRC',async()=>{
  const detail=await loadEditableRelease(fixture(),releaseId);
  assert.equal(detail.release.status,'published');assert.equal(detail.product.title,'Saved Album');assert.equal(detail.release.artist,'Primary Artist');assert.equal(detail.release.upc,'001234567890');
  assert.equal(detail.release.credit_groups.songwriter.entries[0].name,'Release Writer');
  assert.equal(detail.tracks[0].credit_groups.songwriter.entries[0].name,'Track Writer');
  assert.equal(detail.tracks[0].lyrics,'Saved Lyrics');assert.equal(detail.tracks[0].isrc,'Saved-ISRC');
  assert.equal(detail.revision.product,'product-revision');assert.equal(detail.revision.tracks[trackId],'track-revision');
});
test('legacy catalog-only release is editable by product identity without inventing a release row',async()=>{
  const detail=await loadEditableRelease(fixture({legacy:true}),productId);
  assert.equal(detail.source,'catalog');assert.equal(detail.release.id,productId);assert.equal(detail.tracks[0].id,otherId);assert.equal(detail.release.upc,'001234567890');
});
test('missing release returns null rather than an empty editor',async()=>assert.equal(await loadEditableRelease(fixture(),otherId),null));
test('unknown storage capability disables writes while preserving readable legacy credits',async()=>{
  const db=fixture();const before=structuredClone(db.rows);
  const result=await commitCreditEdit(db,releaseId,{revision:{release:'release-revision'},credit_groups:{songwriter:group}});
  assert.equal(result.status,503);assert.deepEqual(db.rows,before);assert.equal(db.calls.filter(c=>c.action!=='select').length,0);
});
test('public or incomplete capability cannot enable private allocation persistence',async()=>{
  for(const data of [{version:1,private_allocations:true},{version:1,private_allocations:true,service_role_only:false},{version:2,private_allocations:true,service_role_only:true}]){
    assert.equal((await creditStorageCapabilities({rpc:async()=>({data,error:null})})).ready,false);
  }
});
test('invalid allocations and invalid identifier types fail before invoking storage',async()=>{
  let called=false;const db={rpc:async()=>{called=true;throw new Error('Unexpected storage access');}};
  assert.equal((await commitCreditEdit(db,releaseId,{revision:{},upc:123,credit_groups:{songwriter:{state:'complete',entries:[{name:'Writer',percentage:'99.99'}]}}})).status,422);
  assert.equal(called,false);
});
test('revision conflict is returned without a success response or a retry that overwrites data',async()=>{
  const db=fixture({ready:true});const calls=[];const base=db.rpc;
  db.rpc=async(name,args)=>{calls.push(name);return name==='commit_release_credit_edit'?{error:{code:'40001'}}:base(name,args);};
  const result=await commitCreditEdit(db,releaseId,{revision:{release:'old'},credit_groups:{songwriter:group}});
  assert.equal(result.status,409);assert.match(result.body.error,/retained/);assert.equal(calls.filter(n=>n==='commit_release_credit_edit').length,1);
});
test('transaction failure does not fall back to independent table writes',async()=>{
  const db=fixture({ready:true});const before=structuredClone(db.rows);const base=db.rpc;
  db.rpc=async(name,args)=>name==='commit_release_credit_edit'?{error:{code:'XX000'}}:base(name,args);
  const result=await commitCreditEdit(db,releaseId,{revision:{},recordings:[{id:trackId,isrc:''}]});
  assert.equal(result.status,500);assert.deepEqual(db.rows,before);assert.equal(db.calls.length,0);
});
test('transaction receives omitted versus explicit clear exactly as supplied',async()=>{
  const db=fixture({ready:true});let submitted;const base=db.rpc;
  db.rpc=async(name,args)=>name==='commit_release_credit_edit'?(submitted=args,{data:{revision:{release:'new'},slug:'album',status:'published'},error:null}):base(name,args);
  const patch={revision:{release:'saved'},upc:'',recordings:[{id:trackId,isrc:'',credit_groups:{songwriter:group}}]};
  assert.equal((await commitCreditEdit(db,releaseId,patch)).status,200);
  assert.equal(submitted.p_patch.upc,'');assert.equal(Object.hasOwn(submitted.p_patch,'artist'),false);assert.equal(submitted.p_patch.recordings[0].id,trackId);
});
test('malformed and duplicate recording targets are rejected',()=>{
  for(const recordings of [null,[null],[{id:trackId},{id:trackId}]])assert.ok(validateCreditEdit({revision:{},recordings}).length);
});
test('private stored allocations override name-only projection without changing target scope',async()=>{
  const db=fixture({ready:true});const base=db.rpc;
  db.rpc=async(name,args)=>name==='get_release_credit_edit_state'?{data:[{scope:'recording',target_id:trackId,groups:{producer:{state:'complete',entries:[{name:'Producer',percentage:'100.00'}]}}}],error:null}:base(name,args);
  const detail=await loadEditableRelease(db,releaseId);
  assert.equal(detail.tracks[0].credit_groups.producer.entries[0].percentage,'100.00');assert.equal(detail.release.credit_groups.producer.entries.length,0);
});
