import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import vm from 'node:vm';
import {catalogCoverUrl} from '../../src/lib/media-urls.js';
import {mapProductRow} from '../../src/lib/media/catalog-db.js';
import {releaseAvailability} from '../../src/lib/releases/release-availability.js';
import {excludeDeletedReleases,releaseDeletionConfirmation} from '../../src/lib/releases/deletion-projection.js';
import {commitDeletedReleaseSlugs,getDeletedReleaseSnapshot} from '../../src/lib/releases/deletion-store.js';

for(const type of ['single','feature','album','ep','mixtape'])test(`${type}: uploaded still resolves to storage, deletion overrides even admin access`,()=>{
 const folder={single:'singles',feature:'features',album:'albums',ep:'mixtapes-and-eps',mixtape:'mixtapes-and-eps'}[type];
 const key=`images/${folder}/fixture/cover.jpeg`;
 const url=catalogCoverUrl(key);assert.match(url,/^https:\/\//);assert.ok(url.endsWith(key));
 assert.equal(catalogCoverUrl('/images/features/legacy.jpg'),'/images/features/legacy.jpg');
 const row=mapProductRow({slug:'fixture',product_type:type,release_type:folder,metadata:{cover_art_r2_key:key}});
 assert.equal(row.baseCover,url);
 const denied=releaseAvailability({status:'published',deleted_at:'2026-10-20T00:00:00Z',storefront_visible:true},{admin:true,owned:true,normallyEntitled:true});
 for(const field of ['visible','canPlayFull','canPreview','canPurchase'])assert.equal(denied[field],false);
});

test('N.2.K canonical key uses the working R2 origin rather than the observed 404 site path',()=>{
 const key='images/features/n-2-k-6/n-2-k-6.jpeg';
 const mapped=mapProductRow({slug:'n-2-k-6',product_type:'feature',release_type:'features',cover_url:'/api/media/visual?releaseType=features&slug=n-2-k-6',metadata:{cover_art_r2_key:key}});
 assert.match(mapped.baseCover,/^https:\/\//);assert.notEqual(new URL(mapped.baseCover).hostname,'www.2mrrw.com');assert.ok(mapped.baseCover.endsWith(key));
});

test('release-specific projection preserves a shared recording on another release',()=>{
 const rows=[{slug:'removed'},{slug:'shared-track',albumSlug:'removed'},{slug:'shared-track',albumSlug:'kept'},{slug:'standalone'}];
 assert.deepEqual(excludeDeletedReleases(rows,['removed']),rows.slice(2));
});

test('an older response cannot clear the committed deletion snapshot',()=>{
 commitDeletedReleaseSlugs(['removed']);const first=getDeletedReleaseSnapshot();
 commitDeletedReleaseSlugs([]);assert.equal(getDeletedReleaseSnapshot(),first);
 commitDeletedReleaseSlugs(['removed','alias']);assert.deepEqual(getDeletedReleaseSnapshot(),['alias','removed']);
});

test('confirmation identifies title/type and explains retained media and no undo',()=>{
 const message=releaseDeletionConfirmation({title:'Fixture EP',release_type:'ep',status:'draft'});
 for(const text of ['Fixture EP','ep draft','Recordings','purchase history','no undo'])assert.ok(message.includes(text));
});

async function buttonHarness(){
 const source=await readFile(new URL('../../src/components/admin/DeleteReleaseButton.js',import.meta.url),'utf8');
 const {code}=await transform(source,{loader:'jsx',format:'cjs',jsx:'automatic'});
 const state=[],requests=[],confirmed=[],deleted=[],committed=[];let cursor=0,confirm=true,response={ok:true,json:async()=>({ok:true,slug:'fixture',deleted_slugs:['fixture','alias']})};
 const jsx=(type,props)=>({type,props});const exports={};
 const context={module:{exports},exports,window:{confirm:message=>{confirmed.push(message);return confirm;}},
 fetch:async(url,options)=>{requests.push({url,options});return typeof response==='function'?response():response;},
 require:name=>{
  if(name==='react')return {useState:initial=>{const i=cursor++;if(!(i in state))state[i]=initial;return[state[i],value=>state[i]=typeof value==='function'?value(state[i]):value];},useRef:initial=>{const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i];}};
  if(name==='react/jsx-runtime')return {jsx,jsxs:jsx};
  if(name==='@/context/AuthContext')return {useAuth:()=>({currentUser:{email:'fixture@example.invalid'}})};
  if(name==='@/components/admin/AdminVerificationOverlay')return {AdminVerificationOverlay:'verification-overlay'};
  if(name==='@/lib/auth/admin-authority-diagnostics')return {RECOVERABLE_ADMIN_AUTH_CODES:new Set(['ADMIN_AUTH_MFA_EXPIRED'])};
  if(name==='@/lib/releases/deletion-projection')return {releaseDeletionConfirmation};
  if(name==='@/lib/releases/deletion-store')return {commitDeletedReleaseSlugs:slugs=>committed.push(slugs)};
  if(name==='@/lib/storefront/catalog-refresh-store')return {signalCatalogMutation:()=>{}};
  throw new Error(`Unexpected import ${name}`);
 }};
 vm.runInNewContext(code,context);
 const render=()=>{cursor=0;return context.module.exports.default({release:{id:'fixture-id',slug:'fixture',title:'Fixture',release_type:'feature',status:'published'},onDeleted:r=>deleted.push(r)});};
 return {render,requests,confirmed,deleted,committed,cancel:()=>confirm=false,respond:value=>response=value};
}

test('inline deletion control: cancel sends nothing; success commits only after confirmed response',async()=>{
 const h=await buttonHarness();h.cancel();await h.render().props.children[0].props.onClick();assert.equal(h.requests.length,0);assert.equal(h.deleted.length,0);
 const successful=await buttonHarness();await successful.render().props.children[0].props.onClick();
 assert.equal(successful.requests[0].options.method,'DELETE');assert.equal(successful.deleted.length,1);assert.deepEqual([...successful.committed[0]],['fixture','alias']);
});

test('inline deletion control: failed request retains row and shows failure',async()=>{
 const h=await buttonHarness();h.respond({ok:false,json:async()=>({error:'Fixture rejection'})});await h.render().props.children[0].props.onClick();
 assert.equal(h.deleted.length,0);assert.equal(h.committed.length,0);assert.equal(h.render().props.children[1].props.role,'alert');
});

test('inline deletion control: concurrent clicks send one request and keyboard events do not open editor',async()=>{
 const h=await buttonHarness();let finish;h.respond(()=>new Promise(resolve=>finish=resolve));
 const tree=h.render(),pending=tree.props.children[0].props.onClick();await tree.props.children[0].props.onClick();assert.equal(h.requests.length,1);
 let stopped=false;tree.props.onKeyDown({stopPropagation:()=>stopped=true});assert.equal(stopped,true);
 finish({ok:true,json:async()=>({ok:true,slug:'fixture'})});await pending;assert.equal(h.deleted.length,1);
});

test('inline deletion control: expired MFA requires verification before resuming',async()=>{
 const h=await buttonHarness();h.respond({ok:false,json:async()=>({code:'ADMIN_AUTH_MFA_EXPIRED'})});await h.render().props.children[0].props.onClick();
 const overlay=h.render().props.children[2];assert.equal(overlay.type,'verification-overlay');assert.equal(h.deleted.length,0);
 overlay.props.onCancel();assert.equal(h.render().props.children[2],false);
});
