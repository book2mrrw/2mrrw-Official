// Actual existing editor + real PostgreSQL engine. Admin identity and media I/O
// are fixtures; this is not a signed-in production browser or a playback test.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createCreditDatabaseFixture} from './credits-postgres-fixture.mjs';
import {creditFixtureClient} from './credits-postgres-client.mjs';
import {loadEditableRelease,commitCreditEdit} from '../src/lib/credits/admin-store.js';
const db=await createCreditDatabaseFixture(),client=creditFixtureClient(db);
const r='11111111-1111-4111-8111-111111111111',t='33333333-3333-4333-8333-333333333333';
await db.query("INSERT INTO releases(id,slug,title,status,release_type,content_kind,release_timezone,updated_at) VALUES($1,'fixture','Fixture Album','draft','album','music','America/Chicago',clock_timestamp())",[r]);
await db.query("INSERT INTO tracks(id,release_id,title,position,upload_status,audio_r2_key,lyrics,updated_at) VALUES($1,$2,'Recording One',1,'ready','fixture.wav','Saved lyrics',clock_timestamp())",[t,r]);
const publication={product:{slug:'fixture',release_id:r,title:'Fixture Album',display_title:'Fixture Album',content_kind:'music',product_type:'album',release_type:'albums',price_cents:999,active:true,credits:{written_by:['Release Writer'],mixing_engineer:'Preserved Engineer'},metadata:{artist:'Fixture Artist',genre:'R&B'}},catalog_tracks:[{slug:'one',album_slug:'fixture',title:'Recording One',display_title:'Recording One',track_id:t,track_number:1,position:1,credits:{written_by:['Track Writer'],mastering_engineer:'Track Engineer'},metadata:{},featured_artists:[]}],recordings:[{id:t}],release:{slug:'fixture',title:'Fixture Album',status:'published',available_at:'2020-01-01',storefront_visible:true}};
const rev=(await client.rpc('get_release_publication_revision',{p_release_ref_id:r})).data;
const publicationResponse=await client.rpc('commit_release_publication',{p_release_ref_id:r,p_expected_revision:rev,p_payload:publication});assert.equal(publicationResponse.error,null);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stubs={
 '@/context/AuthContext':`export const useAuth=()=>({currentUser:{id:'fixture-admin'}});`,
 '@/components/admin/UploadWizard':`export const UploadWizard=()=>null;`,
 '@/components/admin/TrackVisualUpload':`export default ()=>null;`,
 '@/components/admin/AdminVerificationOverlay':`export const AdminVerificationOverlay=()=>null;`,
 '@/lib/media-urls':`export const catalogCoverUrl=()=>null;export const catalogMotionVideoUrl=()=>null;`,
 '@/lib/media/r2-upload-client':`export const uploadAssetToR2=async()=>{throw new Error('Media I/O is outside this fixture')};`,
 '@/lib/media/master-revision-client':`export const beginMasterReplacement=async()=>{};export const stageMasterReplacement=async()=>{};`,
};
const bundle=await build({stdin:{contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import{ReleaseEditorPanel}from'@/components/admin/InlineReleasesManager';
 import CreditsSheet from '@/components/preview/CreditsSheet';import{useReleaseCredits}from'@/lib/credits/useReleaseCredits';import{creditRows}from'@/lib/credits/contract';
 function App(){const[open,setOpen]=useState(false);const data=useReleaseCredits('fixture');return <main><h1>PostgreSQL-backed editor verification</h1><button onClick={()=>setOpen(true)}>Open existing release</button>{open?<ReleaseEditorPanel release={{id:'${r}',status:'published',release_type:'album'}} onBack={()=>setOpen(false)} onSaved={()=>{}}/>:null}<div data-testid="public-credits"><CreditsSheet embedded title="Saved release credits" sub="Fixture Album" t={{dark:'#111',accent:'white'}} rows={creditRows(data.release).map(row=>[row.label,row.value])} status={data.status} onRetry={data.retry} onClose={()=>{}}/></div></main>};createRoot(document.getElementById('app')).render(<App/>);
 `,resolveDir:root,loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.js':'jsx'},plugins:[{name:'fixture-only-auth-and-media',setup(b){b.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}));}}],alias:{'@':path.join(root,'src')}});
let forceConflict=false;
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname.startsWith('/api/admin/releases/')){
  res.setHeader('Content-Type','application/json');
  if(req.method==='PATCH'){
   let raw='';for await(const chunk of req)raw+=chunk;
   if(forceConflict){forceConflict=false;await db.query("UPDATE products SET updated_at=clock_timestamp() WHERE release_id=$1",[r]);}
   const result=await commitCreditEdit(client,r,JSON.parse(raw));res.writeHead(result.status);res.end(JSON.stringify(result.body));return;
  }
  res.end(JSON.stringify(await loadEditableRelease(client,r)));return;
 }
 if(url.pathname.startsWith('/api/catalog/releases/')){
  res.setHeader('Content-Type','application/json');const result=(await db.query('SELECT credits FROM products WHERE release_id=$1',[r])).rows[0];res.end(JSON.stringify({release:{slug:'fixture',credits:result.credits,tracks:[]}}));return;
 }
 if(url.pathname==='/api/admin/contributors'){res.setHeader('Content-Type','application/json');res.end('{"contributors":[]}');return;}
 res.setHeader('Content-Type','text/html');res.end('<html><body style="background:#111;color:white"><div id="app"></div><script src="/bundle.js"></script></body></html>');
}catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;let checks=0;const passed=name=>{checks++;console.log('PASS '+name);};
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Open existing release',exact:true}).click();await page.getByLabel('Title',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Fixture Album');assert.equal(await page.getByLabel('Artist',{exact:true}).inputValue(),'Fixture Artist');passed('actual existing editor loads published metadata from PostgreSQL');
 await page.getByLabel('Title',{exact:true}).fill('Saved Through Editor');await page.getByLabel('UPC / EAN (optional)',{exact:true}).fill('001234567890');await page.getByRole('button',{name:'Save Changes',exact:true}).click();await page.getByRole('status').filter({hasText:'Metadata saved'}).waitFor();
 await page.getByRole('button',{name:'← My Releases',exact:true}).click();await page.getByRole('button',{name:'Open existing release',exact:true}).click();await page.getByLabel('Title',{exact:true}).waitFor();assert.equal(await page.getByLabel('Title',{exact:true}).inputValue(),'Saved Through Editor');assert.equal(await page.getByLabel('UPC / EAN (optional)',{exact:true}).inputValue(),'001234567890');passed('metadata and leading-zero UPC survive save close and reopen');
 await page.getByRole('button',{name:'Credits & IDs',exact:true}).click();
 const releaseEditor=page.locator('fieldset').first();assert.equal(await releaseEditor.getByLabel('Contributor name',{exact:true}).first().inputValue(),'Release Writer');
 await releaseEditor.getByLabel('Contributor name',{exact:true}).first().fill('Editor Writer');await releaseEditor.getByRole('button',{name:'Add featured artist',exact:true}).click();const featured=releaseEditor.locator('section').filter({has:page.getByRole('heading',{name:'Featured Artists',exact:true})});await featured.getByLabel('Contributor name',{exact:true}).fill('Editor Guest');
 await page.getByText('Recording One',{exact:true}).last().click();await page.getByLabel('ISRC (optional)',{exact:true}).fill('USABC2600001');
 await page.getByRole('button',{name:'Save Credits and Identifiers',exact:true}).click();await page.getByRole('status').filter({hasText:'Credits and identifiers saved'}).waitFor();await page.getByTestId('public-credits').getByText('Editor Writer',{exact:true}).waitFor();await page.getByTestId('public-credits').getByText('Editor Guest',{exact:true}).waitFor();passed('saved writer and featured artist refresh public credits from the same PostgreSQL data');
 await page.getByRole('button',{name:'← My Releases',exact:true}).click();await page.getByRole('button',{name:'Open existing release',exact:true}).click();await page.getByLabel('Title',{exact:true}).waitFor();await page.getByRole('button',{name:'Credits & IDs',exact:true}).click();await page.getByText('Recording One',{exact:true}).last().click();assert.equal(await page.getByLabel('ISRC (optional)',{exact:true}).inputValue(),'USABC2600001');
 const trackFieldset=page.locator('details').filter({has:page.getByText('Recording One',{exact:true})}).locator('fieldset');assert.equal(await trackFieldset.getByLabel('Contributor name',{exact:true}).first().inputValue(),'Track Writer');passed('recording ISRC persists and release editing preserves the recording writer');
 forceConflict=true;await page.locator('fieldset').first().getByLabel('Contributor name',{exact:true}).first().fill('Unsaved Conflict Name');await page.getByRole('button',{name:'Save Credits and Identifiers',exact:true}).click();await page.getByRole('alert').filter({hasText:'This release changed'}).waitFor();assert.equal(await page.locator('fieldset').first().getByLabel('Contributor name',{exact:true}).first().inputValue(),'Unsaved Conflict Name');passed('a concurrent revision conflict retains administrator input');
 const product=(await db.query('SELECT credits,metadata FROM products WHERE release_id=$1',[r])).rows[0];assert.equal(product.credits.mixing_engineer,'Preserved Engineer');assert.equal(product.credits.written_by[0],'Editor Writer');assert.deepEqual(errors,[]);passed('extended credits survive and browser has no runtime errors');
 console.log(`PostgreSQL-backed existing-editor browser checks: ${checks} passed. Fixture administrator; no production login, media upload or playback claimed.`);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await db.close();}
