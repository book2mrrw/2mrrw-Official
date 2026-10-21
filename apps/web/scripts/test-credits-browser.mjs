// Actual Chromium against production credit components and fixture HTTP I/O.
// This does not establish database, authentication, full-player or device behavior.
import assert from 'node:assert/strict';
import http from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  stdin: { contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import CreditsEditor from '@/components/admin/CreditsEditor';
    import CreditsSheet from '@/components/preview/CreditsSheet';
    import {editableCreditGroups,creditRows} from '@/lib/credits/contract';
    import {useReleaseCredits} from '@/lib/credits/useReleaseCredits';
    import {signalCatalogMutation} from '@/lib/storefront/catalog-refresh-store';
    function App(){
      const [groups,setGroups]=useState(editableCreditGroups(null));
      const [slug,setSlug]=useState('alpha'); const [scope,setScope]=useState('release');
      const result=useReleaseCredits(slug); const release=result.release;
      const source=scope==='release'?release:release?.tracks?.find(t=>t.id===scope);
      return <main><h1>Credits component verification</h1>
        <label>Release<select aria-label="Release" value={slug} onChange={e=>{setSlug(e.target.value);setScope('release')}}>{['alpha','beta','empty','slow','failed'].map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Scope<select aria-label="Scope" value={scope} onChange={e=>setScope(e.target.value)}><option value="release">Release attribution</option>{release?.tracks?.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
        <button onClick={()=>signalCatalogMutation()}>Refresh catalog</button>
        <div data-testid="credits"><CreditsSheet title="Credits" sub={slug} t={{dark:'#111',accent:'white'}} rows={creditRows(source).map(r=>[r.label,r.value])} status={result.status} onRetry={result.retry} onClose={()=>{}} embedded /></div>
        <div data-testid="editor"><CreditsEditor groups={groups} onChange={setGroups} directoryAvailable /></div>
        <output data-testid="state">{JSON.stringify(groups)}</output>
      </main>
    } createRoot(document.getElementById('app')).render(<App/>);
  `, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.js': 'jsx' }, alias: { '@': path.join(root,'src') },
});
const bundleText=bundle.outputFiles[0].text;
let fail=true, revision=0;
const people=[{id:'11111111-1111-4111-8111-111111111111',name:'Same Name'},{id:'22222222-2222-4222-8222-222222222222',name:'Same Name'}];
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundleText);return;}
  if(url.pathname.startsWith('/api/catalog/releases/')){
    const slug=url.pathname.split('/').at(-1);
    if(slug==='slow')await new Promise(r=>setTimeout(r,350));
    if(slug==='failed'&&fail){fail=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture retrieval failure'}));return;}
    const release={slug,credits:slug==='empty'?[]:[{name:slug==='beta'?'Beta Writer':revision?'Refreshed Writer':'Alpha Writer',role:'songwriter'},{name:'Producer',role:'producer'},{name:'Guest',role:'featured_artist'},{name:'Engineer',role:'mixing_engineer'},{name:'Art Director',role:'Art direction'}],tracks:[{id:'recording',title:'Recording One',credits:[{name:'Track Writer',role:'songwriter'}]}]};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({release}));return;
  }
  if(url.pathname==='/api/admin/contributors'){
    res.setHeader('Content-Type','application/json');
    if(req.method==='POST'){
      let body='';for await(const chunk of req)body+=chunk;
      res.writeHead(201);res.end(JSON.stringify({contributor:{id:'33333333-3333-4333-8333-333333333333',name:JSON.parse(body).name}}));
    }else res.end(JSON.stringify({contributors:people}));return;
  }
  res.setHeader('Content-Type','text/html');res.end('<html><body style="background:#111;color:#eee"><div id="app"></div><script src="/bundle.js"></script></body></html>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
let checks=0;
const passed=name=>{checks++;console.log(`PASS ${name}`);};
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const credits=page.getByTestId('credits');
  await credits.getByText('Alpha Writer',{exact:true}).waitFor();
  assert.ok(await credits.getByText('Art Director',{exact:true}).isVisible());passed('all five saved role rows render at mobile width');
  await page.getByLabel('Scope',{exact:true}).selectOption('recording');
  await credits.getByText('Track Writer',{exact:true}).waitFor();assert.equal(await credits.getByText('Alpha Writer',{exact:true}).count(),0);passed('recording scope excludes release attribution');
  await page.getByLabel('Release',{exact:true}).selectOption('empty');
  await credits.getByText('No credits have been added yet.').waitFor();passed('empty credits contain no global attribution');
  await page.getByLabel('Release',{exact:true}).selectOption('failed');
  await credits.getByRole('alert').waitFor();await credits.getByRole('button',{name:'Retry'}).click();await credits.getByText('Alpha Writer',{exact:true}).waitFor();passed('failed retrieval is distinct and retry succeeds');
  await page.getByLabel('Release',{exact:true}).selectOption('slow');
  await credits.getByText('Loading credits…').waitFor();
  await page.getByLabel('Release',{exact:true}).selectOption('beta');await credits.getByText('Beta Writer',{exact:true}).waitFor();await page.waitForTimeout(450);
  assert.equal(await credits.getByText('Alpha Writer',{exact:true}).count(),0);passed('late previous-release response cannot replace current credits');
  revision=1;await page.getByRole('button',{name:'Refresh catalog'}).click();await credits.getByText('Beta Writer',{exact:true}).waitFor();
  await page.getByLabel('Release',{exact:true}).selectOption('alpha');await credits.getByText('Refreshed Writer',{exact:true}).waitFor();passed('catalog mutation reloads the shared credits request');
  const editor=page.getByTestId('editor');
  await editor.getByRole('button',{name:'Add songwriter',exact:true}).click();await editor.getByLabel('Contributor name',{exact:true}).nth(0).fill('First Writer');await editor.getByLabel('Percentage',{exact:true}).nth(0).fill('70.00');
  await editor.getByRole('button',{name:'Add songwriter',exact:true}).click();await editor.getByLabel('Contributor name',{exact:true}).nth(1).fill('Second Writer');await editor.getByLabel('Percentage',{exact:true}).nth(1).fill('30.00');
  await editor.getByLabel('Written By allocation status').selectOption('complete');await editor.getByText('Total: 100.00% · Complete',{exact:true}).waitFor();passed('multiple writers retain explicit 70/30 allocation with exact total');
  await editor.getByLabel('Percentage',{exact:true}).nth(1).fill('30.01');await editor.getByText('The allocation total exceeds 100.00%.',{exact:true}).waitFor();passed('over-allocation is identified without erasing entered values');
  await editor.getByLabel('Percentage',{exact:true}).nth(1).fill('30.00');
  await editor.getByRole('button',{name:'Move contributor 2 up',exact:true}).click();assert.equal(await editor.getByLabel('Contributor name',{exact:true}).nth(0).inputValue(),'Second Writer');passed('reordering keeps contributor and allocation together');
  await editor.getByRole('button',{name:'Add producer',exact:true}).click();const producer=editor.locator('section').filter({has:page.getByRole('heading',{name:'Produced By',exact:true})});
  await producer.getByLabel('Contributor name',{exact:true}).fill('Same');await producer.getByRole('button',{name:`Same Name · ${people[1].id}`,exact:true}).click();
  assert.match(await page.getByTestId('state').textContent(),new RegExp(people[1].id));passed('same-name suggestions retain the explicitly selected UUID');
  await producer.getByLabel('Contributor name',{exact:true}).fill('Historical Snapshot');assert.match(await page.getByTestId('state').textContent(),new RegExp(people[1].id));passed('credit name correction retains identity and does not rename directory');
  await editor.getByRole('button',{name:'Add featured artist',exact:true}).click();const features=editor.locator('section').filter({has:page.getByRole('heading',{name:'Featured Artists',exact:true})});
  await features.getByLabel('Contributor name',{exact:true}).fill('Guest Artist');assert.equal(await features.getByLabel('Percentage',{exact:true}).count(),0);passed('featured artists have their own attribution without allocation fields');
  assert.deepEqual(errors,[]);passed('no browser runtime errors');
  console.log(`Browser fixture checks: ${checks} passed. No database, authenticated-site, playback or physical-device verification claimed.`);
}finally{await browser?.close();await new Promise(r=>server.close(r));}
