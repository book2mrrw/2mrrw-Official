// Real listener panel and shared presentation. Geometry/media/animation are fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const {JSDOM}=await import(pathToFileURL(process.env.MODAL_JSDOM_MODULE||'/private/tmp/modal-verification/node_modules/jsdom/lib/api.js'));
const {build}=await import('esbuild');
const dom=new JSDOM('<div id="app"></div>',{url:'https://fixture.invalid',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','Element','Event','MouseEvent','KeyboardEvent'])globalThis[key]=dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const scrolls=[];dom.window.HTMLElement.prototype.scrollTo=function(options){scrolls.push({element:this,...options});this.scrollTop=options.top;};
const observers=new Set();globalThis.ResizeObserver=class {constructor(callback){this.callback=callback;observers.add(this);}observe(){}disconnect(){observers.delete(this);}};
window.matchMedia=()=>({matches:true});
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lyric-lines-')),file=path.join(directory,'panel.mjs');
await build({entryPoints:[process.env.LYRIC_PANEL_COMPONENT_FILE||'src/components/preview/GlyphLyricsPanel.js'],outfile:file,bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.js':'jsx'},alias:{'@':path.resolve('src')},plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/^(react|react-dom)(\/|$)/},a=>({path:require.resolve(a.path),external:true}));
  b.onResolve({filter:/^framer-motion$/},()=>({path:'motion',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`import React from 'react';export const useReducedMotion=()=>true;export const AnimatePresence=({children})=>children;const cache=new Map();export const motion=new Proxy({}, {get:(_,tag)=>{if(!cache.has(tag))cache.set(tag,React.forwardRef(({initial,animate,exit,transition,...props},ref)=>React.createElement(tag,{...props,ref})));return cache.get(tag);}});`}));
}}]});
try{const style=document.createElement('style');style.textContent=await fs.readFile(path.join(directory,'panel.css'),'utf8');document.head.append(style);}catch(error){if(error.code!=='ENOENT')throw error;}
const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');const {default:Panel}=await import(pathToFileURL(file));
const root=createRoot(document.getElementById('app'));const seeks=[];const onSeek=time=>seeks.push(time);
const lyrics='[2mrrw:1,'+'a'.repeat(64)+',20]\n[00:01.000]<00:01.000>Held <00:01.500><00:01.500>phrase<00:02.000>\n\n[00:10.000]Next phrase\n[00:15.000]Long final note';
const base={open:true,lrcText:lyrics,syncStatus:'verified',recordingKey:'recording-one',onClose(){},onSeek};
const render=async(time,extra={})=>{await act(async()=>root.render(React.createElement(Panel,{...base,playbackTime:time,...extra})));};
const rows=()=>[...document.querySelectorAll('[data-lyric-line]')];
const active=()=>document.querySelector('[data-lyric-line][aria-current="true"]');
const follow=()=>[...document.querySelectorAll('button')].find(button=>button.textContent==='Back to current lyric');
let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
try{
  await render(1.25);assert.ok(!document.querySelector('[data-lyric-word]'),'Whole-line playback must not render word-level illumination');assert.equal(active().textContent.trim(),'Held phrase');assert.equal(dom.window.getComputedStyle(active()).color,'rgb(255, 255, 255)');assert.equal(rows()[1].dataset.lyricState,'upcoming');pass('whole-line illumination is the default even for precise word-timed documents');
  for(const time of [2,5,9.999]){await render(time);assert.equal(active(),rows()[0]);}pass('the entire held phrase remains active after its last word ends and through its following interval');
  await render(10);assert.equal(active(),rows()[1]);assert.equal(rows()[0].dataset.lyricState,'previous');assert.equal(rows()[2].dataset.lyricState,'upcoming');assert.notEqual(dom.window.getComputedStyle(rows()[0]).color,dom.window.getComputedStyle(rows()[2]).color);assert.notEqual(dom.window.getComputedStyle(rows()[1]).color,dom.window.getComputedStyle(rows()[2]).color);pass('the exact next boundary changes active, previous and upcoming states together');
  await render(.999);assert.equal(active(),null);await render(1);assert.equal(active(),rows()[0]);await render(15);assert.equal(active(),rows()[2]);await render(19.999);assert.equal(active(),rows()[2]);await render(20);assert.equal(active(),null);pass('seeks, exact starts and the known final recording boundary remain deterministic');
  await render(null);assert.equal(active(),null);assert.match(document.body.textContent,/Playback position unavailable/);await render(16);assert.equal(active(),rows()[2]);pass('an unavailable playback position is explicit and recovers from the next real position');
  await render(1);let mutations=0;const observer=new dom.window.MutationObserver(records=>{mutations+=records.length;});observer.observe(document.querySelector('[data-lyric-mode]'),{subtree:true,childList:true,attributes:true,characterData:true});
  for(const time of [1,1.1,1.25,2,3,3])await render(time);observer.disconnect();assert.equal(mutations,0);pass('repeated playback samples within a phrase do not mutate or re-illuminate its rendered lines');
  const viewport=document.querySelector('[aria-label="Lyrics text"]');Object.defineProperty(viewport,'clientHeight',{configurable:true,value:300});rows().forEach((row,index)=>{Object.defineProperty(row,'offsetTop',{configurable:true,value:index*500});Object.defineProperty(row,'offsetHeight',{configurable:true,value:80});});
  const before=scrolls.length;await render(10);assert.equal(scrolls.length,before+1);assert.equal(scrolls.at(-1).behavior,'auto');const afterBoundary=scrolls.length;await render(11);await render(12);assert.equal(scrolls.length,afterBoundary);pass('follow scrolls only when a new active line leaves the comfortable viewport, respecting reduced motion');
  await act(async()=>viewport.dispatchEvent(new Event('touchmove',{bubbles:true})));assert.ok(follow());const paused=scrolls.length;await render(15);assert.equal(scrolls.length,paused);await act(async()=>follow().click());assert.equal(scrolls.length,paused+1);assert.deepEqual(seeks,[]);pass('manual touch scrolling suspends follow; Back to current lyric resumes positioning without seeking or autoplay');
  assert.equal(observers.size,1);viewport.scrollTop=0;const beforeResize=scrolls.length;await act(async()=>[...observers][0].callback());assert.equal(scrolls.length,beforeResize+1);await render(16);assert.equal(observers.size,1);pass('layout changes reposition the current phrase without accumulating layout subscriptions');
  await act(async()=>rows()[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));assert.deepEqual(seeks,[10]);await act(async()=>rows()[2].dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true})));assert.deepEqual(seeks,[10,15]);pass('accessible lyric navigation sends one seek command per keyboard action');
  await act(async()=>viewport.dispatchEvent(new Event('wheel',{bubbles:true})));assert.ok(follow());await render(15,{open:false});assert.equal(document.querySelector('[aria-label="Lyrics"]'),null);assert.equal(observers.size,0);await render(15);assert.equal(active().textContent.trim(),'Long final note');assert.equal(follow(),undefined);assert.equal(observers.size,1);pass('close/reopen cleans up subscriptions and restores the actual line with fresh follow state');
  await render(4,{recordingKey:'recording-two',lrcText:'[00:03.000]Different song'});assert.equal(active().textContent.trim(),'Different song');assert.doesNotMatch(document.body.textContent,/Held phrase|Long final note/);pass('recording changes cannot retain the previous transcript or follow state');
  await render(6,{lrcText:'First row\n\nSecond row\nRepeated row\nRepeated row',recordingKey:'plain'});assert.deepEqual(rows().map(row=>row.textContent.trim()),['First row','Second row','Repeated row','Repeated row']);assert.equal(active(),null);assert.equal(rows()[0].dataset.lyricState,'plain');assert.match(document.body.textContent,/not synchronized/);pass('unsynchronized text retains line order, repeated phrases and stanza spacing without invented cues');
  await render(5,{lrcText:lyrics,syncStatus:'audio_changed'});assert.equal(active(),null);assert.match(document.body.textContent,/recording changed/);assert.equal(rows()[0].getAttribute('role'),null);pass('unverified changed-audio timing falls back to readable text without navigation timestamps');
  await render(null,{lrcText:'',status:'loading'});assert.match(document.body.textContent,/Loading lyrics/);await render(null,{lrcText:'',status:'error',onRetry(){}});assert.match(document.body.textContent,/could not be loaded/);await render(null,{lrcText:'',status:'ready'});assert.match(document.body.textContent,/No lyrics have been added/);pass('loading, retryable error and unavailable lyrics remain separate states');
  console.log(`${checks} whole-line presentation checks passed. Simulated geometry, animation and playback samples; no browser/device visual or audio claim.`);
}finally{await act(async()=>root.unmount());await fs.rm(directory,{recursive:true,force:true});dom.window.close();}
