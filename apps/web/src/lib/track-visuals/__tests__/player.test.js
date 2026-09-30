import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackVisualPlayer } from '../player.js';
function element(native = false) {
 const handlers=new Map(), calls=[];
 return {calls,handlers,canPlayType:()=>native?'maybe':'',addEventListener:(n,f)=>handlers.set(n,f),removeEventListener:n=>handlers.delete(n),
 play:()=>{calls.push('play');return Promise.resolve();},pause:()=>calls.push('pause'),load:()=>calls.push('load'),removeAttribute:()=>calls.push('removeSrc')};
}
function fakeHls() {
 class Hls {
 static Events={ERROR:'error',MEDIA_ATTACHED:'attach'};
 static isSupported=()=>true;
 constructor(config){this.config=config;this.handlers={};this.calls=[];Hls.instance=this;}
 on(name,fn){this.handlers[name]=fn;}
 attachMedia(el){this.el=el;this.handlers.attach();}
 loadSource(url){this.calls.push(['source',url]);}
 startLoad(){this.calls.push(['start']);} stopLoad(){this.calls.push(['stop']);} destroy(){this.calls.push(['destroy']);}
 } return Hls;
}
test('pause/resume and layout updates retain the same video source and HLS instance',async()=>{
 const video=element(),Hls=fakeHls();const p=new TrackVisualPlayer(video,{loadHls:async()=>Hls});
 p.setPlaying(true);await p.load('/pinned-v1'); const instance=Hls.instance;
 p.setPlaying(true);p.setPlaying(false);p.setPlaying(true);
 assert.equal(p.hls,instance);assert.deepEqual(instance.calls.filter(x=>x[0]==='source'),[['source','/pinned-v1']]);
 assert.equal(video.volume,0);assert.equal(video.muted,true);
 assert.ok(!video.calls.includes('load'));p.destroy();assert.equal(video.handlers.size,0);
});
test('destroy during decoder import cannot attach to a later track',async()=>{
 let resolve;const loading=new Promise(r=>resolve=r),video=element(),Hls=fakeHls();
 const p=new TrackVisualPlayer(video,{loadHls:()=>loading});const pending=p.load('/old');p.destroy();resolve(Hls);await pending;
 assert.equal(Hls.instance,undefined);assert.equal(video.handlers.size,0);
});
test('fatal visual error stops only the owned visual and reports fallback',async()=>{
 const video=element(),Hls=fakeHls();let failed=0;const p=new TrackVisualPlayer(video,{loadHls:async()=>Hls,onFailure:()=>failed++});
 await p.load('/v1');p.setPlaying(true);Hls.instance.handlers.error(null,{fatal:true});
 assert.equal(failed,1);assert.equal(p.hls,null);assert.equal(p.wantsPlay,false);p.destroy();
});
test('native playback keeps its URL across pause and resume',async()=>{
 const video=element(true);const p=new TrackVisualPlayer(video,{loadHls:()=>{throw Error('must not import')}});
 await p.load('/native-v1');p.setPlaying(true);p.setPlaying(false);p.setPlaying(true);assert.equal(video.src,'/native-v1');p.destroy();
});
