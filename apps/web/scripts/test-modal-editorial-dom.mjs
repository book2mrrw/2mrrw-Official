// Simulated DOM interaction with the production modals. No browser, layout, media or production login claim.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const {build}=await import(process.env.MODAL_ESBUILD_MODULE ? pathToFileURL(process.env.MODAL_ESBUILD_MODULE) : 'esbuild');
const require=createRequire(import.meta.url);
const jsdomModule=process.env.MODAL_JSDOM_MODULE || '/private/tmp/modal-verification/node_modules/jsdom/lib/api.js';
const {JSDOM}=await import(pathToFileURL(jsdomModule));
const dom=new JSDOM('<div id="app"></div>',{url:'https://fixture.invalid',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','Element','Image','CustomEvent','Event','MouseEvent','KeyboardEvent'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.requestAnimationFrame=cb=>setTimeout(cb,0);globalThis.cancelAnimationFrame=clearTimeout;
dom.window.HTMLElement.prototype.scrollTo=function(){};
let captures=0;dom.window.Element.prototype.setPointerCapture=()=>{captures++;};dom.window.Element.prototype.releasePointerCapture=()=>{};
globalThis.fixtureCalls=[];
const sources=['src/components/preview/ImmersivePreviewModal.js','src/components/preview/GlyphLyricsPanel.js','src/hooks/useArtworkGesture.js'];
const allowed=new Set([...sources,'src/components/preview/CreditsSheet.js','src/components/preview/releaseMetadata.js','src/lib/lrc.js','src/lib/credits/contract.js','src/lib/credits/useReleaseCredits.js','src/lib/storefront/catalog-refresh-store.js']);
const exportsByModule=new Map();
for(const source of sources){const text=await fs.readFile(source,'utf8');for(const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)){const names=exportsByModule.get(m[2])||new Set();for(const name of m[1].split(',').filter(n=>n.trim()))names.add(name.trim().split(/\s+as\s+/)[0]);exportsByModule.set(m[2],names);}}
const engine=`({state:{isPlaying:false,currentTime:0,duration:180,shuffle:false,queue:[]},...Object.fromEntries(['toggle','seek','playNext','playPrevious','seekBack','seekForward','toggleShuffle','toggleRepeat','setSleepTimer','enqueueTrack','removeFromQueue','moveInQueue','setPlaybackRate'].map(k=>[k,(...args)=>globalThis.fixtureCalls.push([k,...args])]))})`;
const values={useCoverPalette:'()=>null',useMediaEngine:`()=>${engine}`,useAudioPlayer:'()=>({setShuffle(){}})',usePlaybackProgress:'()=>({currentTime:globalThis.fixtureCurrentTime||0})',useEntitlementAccountState:'()=>({user:null})',resolveSubscriptionEntitlements:'()=>({showSubscribe:false})',catalogCoverDisplay:'()=>({src:null})',getPagePlaybackActionsBridge:'()=>null',usePlayerBodyState:'()=>{}',registerModal:'()=>{}',unregisterModal:'()=>{}',getCatalogSurfaceRef:'()=>null',PREVIEW_HARD_CAP_SEC:'30',PLAYBACK_MODE:`({SLOW_LOCKED:'slow_locked'})`,interactiveMediaState:`({getSnapshot:()=>({playbackMode:'slow_locked'}),releaseMomentarySlow(){},deactivateFilter(){},fireChop(){},setFilterXY(){},unlockSlow(){},beginSlowMomentary(){}})`,MOVE_CANCEL_PX:'8',HOLD_THRESHOLD_MS:'420',LOCK_SLIDE_PX_RATIO:'0.3',UNLOCK_HOLD_MS:'1000'};
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'modal-dom-'));const bundle=path.join(directory,'fixture.mjs');
await build({stdin:{contents:`export {SingleModal,AlbumModal} from '@/components/preview/ImmersivePreviewModal';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',outfile:bundle,jsx:'automatic',loader:{'.js':'jsx'},plugins:[{name:'isolated-io',setup(b){b.onResolve({filter:/^(react|react-dom)(\/|$)/},a=>({path:require.resolve(a.path),external:true}));b.onResolve({filter:/^(@\/|next\/|framer-motion)/},a=>{const file=a.path.startsWith('@/')?'src/'+a.path.slice(2)+'.js':null;return file&&allowed.has(file)?{path:path.resolve(file==='src/components/preview/ImmersivePreviewModal.js' && process.env.MODAL_COMPONENT_FILE ? process.env.MODAL_COMPONENT_FILE : file)}:{path:a.path,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},a=>{if(a.path==='framer-motion')return {contents:`import React from 'react';export const useReducedMotion=()=>true;export const AnimatePresence=({children})=>children;export const motion=new Proxy({}, {get:(_,tag)=>React.forwardRef(({initial,animate,exit,transition,...props},ref)=>React.createElement(tag,{...props,ref}))});`};if(a.path==='next/link')return {contents:`import React from 'react';export default ({children,...p})=>React.createElement('a',p,children);`};return {contents:`export default ()=>()=>null;\n`+[...(exportsByModule.get(a.path)||[])].map(name=>`export const ${name}=${values[name]||'()=>null'};`).join('\n')};});}}]});
const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');const {SingleModal,AlbumModal}=await import(pathToFileURL(bundle));const root=createRoot(document.getElementById('app'));
const button=name=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===name||b.getAttribute('aria-label')===name);
const click=async name=>{const b=button(name);assert.ok(b,`Missing button ${name}`);await act(async()=>b.click());};
const region=name=>document.querySelector(`[role="region"][aria-label="${name}"]`);
function assertControlFlow(){
 const actions=document.querySelector('[data-modal-editorial-actions]');const playback=document.querySelector('[data-modal-playback-controls]');const owner=actions?.closest('[data-modal-control-stack]');
 assert.ok(owner,'Editorial and playback controls need one layout owner');assert.equal(actions.parentElement,owner);assert.equal(playback.parentElement,owner);
 assert.equal(actions.style.position,'');assert.equal(actions.style.bottom,'');assert.equal(playback.style.position,'relative');assert.equal(actions.nextElementSibling,playback);
 assert.equal(owner.style.maxHeight,'100%');assert.equal(owner.style.overflowY,'auto');
 for(const b of actions.querySelectorAll('button'))assert.equal(b.style.minHeight,'44px');
}

const alpha={slug:'alpha',credits:{written_by:['Release writer']},recording:{id:'source',lyrics:'Ordinary saved lyric\nSecond line',credits:{written_by:['Recording writer']}},tracks:[]};
const album={slug:'album',title:'Album',artist:'Artist',tracks:[{id:'catalog-one',track_id:'source-one',slug:'one',title:'One',lyrics:'Stale lyrics'},{id:'catalog-two',track_id:'source-two',slug:'two',title:'Two'}]};
const freshAlbum={slug:'album',credits:{written_by:['Album writer']},tracks:[{id:'source-one',catalog_track_id:'catalog-one',slug:'one',title:'One',lyrics:'[00:01.5]Fresh timed lyric',credits:{written_by:['One writer']}},{id:'source-two',catalog_track_id:'catalog-two',slug:'two',title:'Two',lyrics:'',credits:[]}]};
let failure=false;globalThis.fetch=async url=>{if(failure)return new Response('{"error":"offline"}',{status:503});const data=String(url).endsWith('/album')?freshAlbum:alpha;return Response.json({release:data});};
let checks=0;const passed=name=>{checks++;console.log('PASS '+name);};
const render=async(Component,props)=>{await act(async()=>{root.render(React.createElement(Component,{persistent:true,...props}));await new Promise(r=>setTimeout(r,15));});};
try{
 await render(SingleModal,{track:{slug:'alpha',title:'Single',artist:'Artist'}});assertControlFlow();passed('single editorial buttons occupy a separate normal-flow row above playback');
 await click('Credits');assert.match(region('Credits').textContent,/Recording writer/);await click('Close credits');assert.equal(region('Credits'),null);passed('single Credits opens with scoped saved data and closes');
 await click('Lyrics');assert.match(region('Lyrics').textContent,/Ordinary saved lyric/);assert.match(region('Lyrics').textContent,/Second line/);await click('Close glyphs');assert.equal(region('Lyrics'),null);passed('single Lyrics opens ordinary saved text and closes');
 await click('Lyrics');const overlay=region('Lyrics');assert.notEqual(overlay.parentElement,document.body);assert.equal(overlay.style.position,'absolute');assert.match(overlay.style.background,/0.76/);const plain=overlay.querySelector('[data-lyric-line]');assert.equal(plain.style.color,'rgb(255, 255, 255)');assert.equal(plain.style.fontWeight,'800');assert.match(plain.style.fontSize,/22px/);await click('Close glyphs');passed('default lyrics stay inside artwork with a dark scrim and large white text');
 const credits=button('Credits');await act(async()=>credits.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0})));assert.equal(captures,0);passed('slow-locked artwork does not capture button presses');
 const artwork=button('Lyrics').closest('[data-modal-control-stack]').parentElement;
 await act(async()=>artwork.dispatchEvent(new MouseEvent('pointerdown',{bubbles:true,button:0})));assert.equal(captures,1);
 await act(async()=>artwork.dispatchEvent(new MouseEvent('pointerup',{bubbles:true,button:0})));passed('artwork presses retain gesture ownership');
 await click('Lyrics');await act(async()=>region('Lyrics').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));assert.equal(region('Lyrics'),null);passed('Escape dismisses the lyric panel');
 await click('Lyrics');await render(SingleModal,{track:{slug:'alpha',title:'Single'},open:false});await render(SingleModal,{track:{slug:'alpha',title:'Single'},open:true});assert.equal(region('Lyrics'),null);assert.equal(region('Credits'),null);passed('closing and reopening a persistent modal resets panels');
 await render(AlbumModal,{album});assertControlFlow();passed('album editorial buttons share the non-overlapping bounded control stack');await click('Credits');assert.match(region('Credits').textContent,/Album writer/);
 const select=document.querySelector('[aria-label="Credits scope"]');await act(async()=>{select.value='source-one';select.dispatchEvent(new Event('change',{bubbles:true}));});assert.match(region('Credits').textContent,/One writer/);await click('Close credits');passed('album Credits switches release and recording scope');
 await click('Lyrics');assert.match(region('Lyrics').textContent,/Fresh timed lyric/);assert.doesNotMatch(region('Lyrics').textContent,/Stale lyrics/);
 globalThis.fixtureCurrentTime=1.5;await render(AlbumModal,{album});assert.match(region('Lyrics').querySelector('[aria-current="true"]').textContent,/Fresh timed lyric/);globalThis.fixtureCurrentTime=0;passed('the recorded timestamp activates its lyric against the playback clock');
 await click('Fullscreen lyrics');assert.equal(region('Lyrics').parentElement,document.body);await click('Exit fullscreen');await click('Back to preview');assert.equal(region('Lyrics'),null);passed('album Lyrics resolves canonical recording identity, fullscreen and Back');
 await render(AlbumModal,{album:{...album,tracks:[album.tracks[1]]}});await click('Lyrics');assert.match(region('Lyrics').textContent,/No lyrics have been added/);assert.doesNotMatch(region('Lyrics').textContent,/Fresh timed lyric|Stale lyrics/);await click('Close glyphs');passed('an explicit empty recording never borrows another recording lyrics');
 await render(AlbumModal,{album:{...album,slug:'different'}});assert.equal(region('Lyrics'),null);assert.equal(region('Credits'),null);passed('release changes reset both album panels');
 await act(async()=>root.unmount());
 const retryRoot=createRoot(document.getElementById('app'));failure=true;await act(async()=>{retryRoot.render(React.createElement(SingleModal,{persistent:true,track:{slug:'alpha',title:'Single'}}));await new Promise(r=>setTimeout(r,15));});await click('Credits');assert.match(region('Credits').textContent,/could not be loaded/);await click('Close credits');await click('Lyrics');assert.match(region('Lyrics').textContent,/could not be loaded/);failure=false;await click('Retry');assert.match(region('Lyrics').textContent,/Ordinary saved lyric/);await click('Close glyphs');await click('Credits');assert.match(region('Credits').textContent,/Recording writer/);await act(async()=>retryRoot.unmount());passed('failed requests expose Retry in both panels and recover');
 let finish;globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});const loadingRoot=createRoot(document.getElementById('app'));
 await act(async()=>{loadingRoot.render(React.createElement(SingleModal,{persistent:true,track:{slug:'alpha',title:'Single'}}));});await click('Lyrics');assert.match(region('Lyrics').textContent,/Loading lyrics/);assert.doesNotMatch(region('Lyrics').textContent,/No lyrics have been added/);
 await act(async()=>{finish(Response.json({release:alpha}));});assert.match(region('Lyrics').textContent,/Ordinary saved lyric/);await act(async()=>loadingRoot.unmount());passed('pending lyric reads distinguish loading from truly empty text');
 assert.equal(globalThis.fixtureCalls.length,0);passed('opening, closing and scoping editorial panels sends no playback commands');
 console.log(`${checks} simulated DOM checks passed; layout, browser hit testing, authentication and physical devices remain unverified.`);
}finally{await fs.rm(directory,{recursive:true,force:true});dom.window.close();}
