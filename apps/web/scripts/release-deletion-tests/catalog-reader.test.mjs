import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import vm from 'node:vm';
import * as paths from '../../src/lib/media/canonical-paths.js';
import {catalogCoverUrl} from '../../src/lib/media-urls.js';
import {normalizeReleaseType} from '../../src/lib/media/utils/normalize-release-type.js';
import {releaseAvailability} from '../../src/lib/releases/release-availability.js';

async function reader(rows){
 const calls=[];const source=await readFile(new URL('../../src/lib/media/catalog-db.js',import.meta.url),'utf8');
 const {code}=await transform(source,{loader:'js',format:'cjs'});const exports={};
 const admin={from:table=>{
  let current=table==='products'?[...rows]:[];const q={
   select:()=>q,is:(key,value)=>{calls.push(['is',table,key,value]);current=current.filter(row=>(row[key]??null)===value);return q;},
   eq:(key,value)=>{current=current.filter(row=>row[key]===value);return q;},in:(key,values)=>{current=current.filter(row=>values.includes(row[key]));return q;},
   order:()=>q,limit:()=>q,range:()=>q,then:resolve=>Promise.resolve({data:current,error:null,count:current.length}).then(resolve),
  };return q;
 }};
 const imports={
  '@/lib/supabase/admin':{getAdminClient:()=>admin},'@/lib/media/canonical-paths':paths,
  '@/lib/media-urls':{catalogCoverUrl},'@/lib/media/utils/normalize-release-type':{normalizeReleaseType},
  '@/lib/releases/release-availability':{releaseAvailability},'@/lib/audio-visual/release-video-lookup':{getMusicVideosForReleaseIds:async()=>new Map()},
 };
 const context={module:{exports},exports,console:{error:()=>{}},require:name=>{if(name in imports)return imports[name];throw new Error(name);}};
 vm.runInNewContext(code,context);return {api:context.module.exports,calls};
}
test('healthy empty catalog is authoritative, including all-deleted legacy content',async()=>{
 for(const rows of [[],[{id:'deleted',slug:'removed',product_type:'feature',content_kind:'music',active:true,deleted_at:'2026-10-20'}]]){
  const h=await reader(rows);const result=await h.api.getStorefrontCatalogFromDB();
  assert.ok(result);for(const group of ['singles','features','albums','mixtapes'])assert.equal(result[group].length,0);
  assert.ok(h.calls.some(call=>call[2]==='deleted_at'));
 }
});
test('catalog, singles pagination and radio share deletion filtering',async()=>{
 const rows=[{id:'kept',slug:'kept',title:'Kept',product_type:'single',release_type:'singles',content_kind:'music',active:true},
 {id:'gone',slug:'gone',title:'Gone',product_type:'single',release_type:'singles',content_kind:'music',active:true,deleted_at:'2026-10-20'}];
 const h=await reader(rows);
 assert.deepEqual([...(await h.api.getStorefrontCatalogFromDB()).singles].map(row=>row.slug),['kept']);
 assert.deepEqual([...(await h.api.getStorefrontSinglesPageFromDB()).releases].map(row=>row.slug),['kept']);
 assert.deepEqual([...(await h.api.getRadioCarouselItemsFromDB())].map(row=>row.slug),['kept']);
});
