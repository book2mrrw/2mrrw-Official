import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
mock.module('../../../context/AudioContext.js', { namedExports: { useAudioPlayer: () => ({}), useAudio: () => ({}) } });
const { attachStreamCommands }=await import('../PlaybackStreamCommands.js');
const { getHLSEngine }=await import('../../audio/HLSEngine.js');
const ref=current=>({current});
function fixture(t, fail){
 t.mock.method(globalThis,'fetch',async()=>new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\n/api/library/hls/variant?slug=album&bitrate=64&token=fixture'));
 const engine=getHLSEngine();engine.detach();t.after(()=>engine.detach());
 const audio=Object.assign(new EventTarget(),{src:'',currentSrc:'',paused:true,ended:false,error:null,readyState:0,networkState:0,currentTime:0,duration:180,
  buffered:{length:0},plays:0,loads:0,canPlayType:()=> 'probably',load(){this.loads++;},pause(){this.paused=true;},
  play(){this.plays++;if(fail && this.plays===1)return Promise.reject(fail);this.paused=false;this.readyState=4;return Promise.resolve();}});
 const state={currentTrack:null,isPlaying:false,playbackState:'idle'};
 const data={audioRef:ref(audio),stateRef:ref(state),audioCtxRef:ref({state:'running',resume:async()=>{}}),queueRef:ref([]),
  playRequestIdRef:ref(0),pausedDuringCurrentLoadRef:ref(false),nextTrackSignedUrlCacheRef:ref({}),listeningUserIdRef:ref(null),
  patchState(p){Object.assign(state,p);},patchTransport(p){Object.assign(state,p);},userVolumeRef:ref(1)};
 const deps=new Proxy(data,{get(o,k){if(k in o)return o[k];return String(k).endsWith('Ref')?(o[k]=ref(null)):()=>{};}});
 const service={_deps:deps};attachStreamCommands(service);
 const track={id:'album:one',slug:'album',title:'One',src:'/api/library/stream?slug=album&trackSlug=one&redirect=1',metadata:{trackSlug:'one',access:{canStream:true,previewOnly:false}}};
 const options={effectAuthorityMode:'CORE',effectAuthority:{},canApplyEffect:()=>true};
 return {audio,state,service,track,options};
}

test('real stream command starts metadata-only native HLS with one play and no progressive replacement',async t=>{
 const f=fixture(t);assert.equal(await f.service.playTrackInternal(f.track,f.options),true);
 assert.equal(f.audio.plays,1);assert.match(f.audio.src,/\/api\/library\/hls\/variant\?/);assert.equal(f.audio.loads,0);
});
test('real stream command falls back once after native decode rejection using the same authority',async t=>{
 const f=fixture(t,new DOMException('decoder unavailable','NotSupportedError'));
 assert.equal(await f.service.playTrackInternal(f.track,f.options),true);assert.equal(f.audio.plays,2);
 assert.match(f.audio.src,/\/api\/library\/stream\?/);assert.equal(f.audio.loads,1);
});
test('real stream command does not substitute sources or retry permission rejection',async t=>{
 const f=fixture(t,new DOMException('gesture required','NotAllowedError'));
 assert.equal(await f.service.playTrackInternal(f.track,f.options),false);assert.equal(f.audio.plays,1);
 assert.match(f.audio.src,/\/api\/library\/hls\/variant\?/);assert.equal(f.state.playbackNetworkState,'error_stream');assert.match(f.state.error,/permission/);
});

test('a pause cancels actual native startup and cannot trigger fallback or late resume',async t=>{
 const f=fixture(t);let resolve;const pending=new Promise(r=>{resolve=r;});
 f.audio.play=function(){this.plays++;return pending;};
 const result=f.service.playTrackInternal(f.track,f.options);
 for(let i=0;i<40 && !f.audio.plays;i++)await Promise.resolve();assert.equal(f.audio.plays,1);
 f.service._deps.pausedDuringCurrentLoadRef.current=true;f.service._deps.activeStreamAbortRef.current.abort();
 assert.equal(await result,false);assert.equal(f.audio.plays,1);assert.match(f.audio.src,/\/api\/library\/hls\/variant\?/);
 resolve();await Promise.resolve();assert.equal(f.audio.paused,true);
});

test('fallback rechecks authority and cannot make denied content audible',async t=>{
 const f=fixture(t,new DOMException('decoder unavailable','NotSupportedError'));let guards=0;
 f.options.canApplyEffect=()=>++guards===1;
 assert.equal(await f.service.playTrackInternal(f.track,f.options),false);
 assert.equal(f.audio.plays,1);assert.equal(guards,2);assert.equal(f.audio.paused,true);
});

test('native progressive previews retain their preview access stamp and bypass HLS',async t=>{
 const f=fixture(t);const preview={...f.track,src:'/api/media/preview?slug=album',metadata:{...f.track.metadata,access:{canStream:false,previewOnly:true}}};
 assert.equal(await f.service.playTrackInternal(preview,f.options),true);assert.equal(f.audio.plays,1);
 assert.equal(f.state.currentTrack.metadata.access.previewOnly,true);assert.doesNotMatch(f.audio.src,/\/library\/hls/);
});
