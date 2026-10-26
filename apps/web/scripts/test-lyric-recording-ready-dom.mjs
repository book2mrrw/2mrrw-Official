// Real shared editor; simulated network/audio/pointers. No browser or device claim.
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
let plays=0;const paused=[];const requests=[];
dom.window.HTMLMediaElement.prototype.play=function(){plays++;this.dispatchEvent(new Event('play'));return Promise.resolve();};
dom.window.HTMLMediaElement.prototype.pause=function(){paused.push(this);this.dispatchEvent(new Event('pause'));};
globalThis.fetch=async(url,options)=>{requests.push({url,options});return Response.json({fingerprint:'a'.repeat(64),duration:10});};
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'lyric-ready-'));const file=path.join(directory,'component.mjs');
await build({entryPoints:['src/components/admin/lyrics/LyricTimingEditor.js'],outfile:file,bundle:true,platform:'node',format:'esm',jsx:'automatic',loader:{'.js':'jsx'},alias:{'@':path.resolve('src')},plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/^react(\/|$)/},a=>({path:require.resolve(a.path),external:true}));
  b.onResolve({filter:/^@\/context\/AudioContext$/},()=>({path:'background',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useAudioPlayer=()=>({isPlaying:false});'}));
}}]});
const React=await import('react');const {act}=React;const {createRoot}=await import('react-dom/client');
const {default:Editor}=await import(pathToFileURL(file));const {decodeLyrics}=await import('../src/lib/lyrics/timing.js');
let value;function App({recordingId='track',releaseId='release',disabled=false}){const [lyrics,setLyrics]=React.useState('First\nSecond');value=lyrics;return React.createElement(Editor,{value:lyrics,onChange:setLyrics,releaseId,recordingId,title:'Recording',disabled});}
const root=createRoot(document.getElementById('app'));let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
const button=name=>[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===name||b.textContent.trim()===name);
const click=async name=>{assert.ok(button(name),name);await act(async()=>button(name).click());};
const render=async props=>{await act(async()=>root.render(React.createElement(App,props)));};
const audio=()=>document.querySelector('audio');
const metadata=async()=>{await act(async()=>{Object.defineProperty(audio(),'duration',{configurable:true,value:10});audio().dispatchEvent(new Event('loadedmetadata'));});};
const pointer=async(type,x=100,y=50,extra={})=>{await act(async()=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});for(const [key,value]of Object.entries({pointerId:7,pointerType:'touch',isPrimary:true,...extra}))Object.defineProperty(event,key,{value});button('Mark selected line').dispatchEvent(event);});};
try{
  await render();assert.equal(requests.length,1);assert.match(requests[0].url,/release\/tracks\/track\/lyrics-audio\?metadata=1$/);assert.ok(audio());assert.equal(button('Load recording reference'),undefined);assert.equal(plays,0);pass('entering lyrics automatically prepares the exact uploaded recording without autoplay or a Load gate');
  assert.equal(button('Play reference').disabled,true);await metadata();assert.equal(button('Play reference').disabled,false);await click('Play reference');assert.equal(plays,1);pass('Play becomes available only after the actual recording metadata arrives');
  const originalAudio=audio();await click('Synchronize');assert.equal(audio(),originalAudio);assert.equal(requests.length,1);await click('Text');assert.equal(audio(),originalAudio);assert.ok(paused.includes(originalAudio));await click('Preview');assert.equal(audio(),originalAudio);pass('Write, Time and Preview retain one prepared recording and do not repeat its metadata request');
  await click('Synchronize');await act(async()=>{audio().currentTime=2;});await pointer('pointerdown');await pointer('pointermove',100,100);await pointer('pointermove');await pointer('pointerup');assert.equal(value,'First\nSecond');pass('dragging out and back cannot accidentally stamp a lyric');
  await pointer('pointerdown');await pointer('pointerup');assert.equal(decodeLyrics(value).lines[0].time,2);pass('a primary touch records the exact native media position once');
  const before=value;await pointer('pointerdown',100,50,{isPrimary:false});await pointer('pointerup',100,50,{isPrimary:false});assert.equal(value,before);pass('secondary touches cannot overwrite an active lyric');
  const oldSignal=requests.at(-1).options.signal;await render({recordingId:'track-two'});assert.ok(oldSignal.aborted);assert.match(audio().src,/track-two\/lyrics-audio/);assert.equal(button('Play reference').disabled,true);assert.ok(paused.includes(originalAudio));pass('changing recording identity cancels old loading/playback and requires metadata from the new recording');
  let resolveOld;globalThis.fetch=(url,options)=>{requests.push({url,options});return new Promise(resolve=>{resolveOld=resolve;});};await render({recordingId:'slow'});const stale=resolveOld;
  globalThis.fetch=async(url,options)=>{requests.push({url,options});return Response.json({fingerprint:'b'.repeat(64),duration:10});};await render({recordingId:'latest'});await act(async()=>stale(Response.json({fingerprint:'c'.repeat(64),duration:10})));assert.match(audio().src,/latest\/lyrics-audio\?revision=b/);pass('a late superseded response cannot substitute another song into the transport');
  await render({recordingId:null});assert.equal(audio(),null);assert.match(document.body.textContent,/Upload.*audio|audio.*upload/i);pass('a recording without an uploaded track ID stays explicitly unavailable and never falls back to the first album track');
  globalThis.fetch=async()=>Response.json({error:'Your session needs sign-in.'},{status:401});await render({recordingId:'auth-error'});assert.match(document.body.textContent,/sign-in/);assert.ok(button('Reload recording reference'));assert.equal(audio(),null);pass('automatic preparation exposes authorization errors and a visible retry action without inventing access');
  globalThis.fetch=async()=>Response.json({fingerprint:'d'.repeat(64),duration:10});await click('Reload recording reference');await metadata();assert.equal(button('Play reference').disabled,false);pass('retry recovers the same selected song after a preparation failure');
  console.log(`${checks} recording readiness checks passed. Simulated audio/network/touch; real codecs, native touch and authenticated playback remain unverified.`);
}finally{await act(async()=>root.unmount());await fs.rm(directory,{recursive:true,force:true});dom.window.close();}
