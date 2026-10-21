import { createPlaybackHelpers } from '../PlaybackHelperService.js';
import { attachRecoveryCommands } from '../PlaybackRecoveryCommands.js';
import { createPlaybackEventHandlers } from '../PlaybackEventHandlers.js';
import { installCurrentPhysicalEffectGuard } from '../../audio/physical-effect-authority.js';

export const ref = current => ({ current });
export const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };

export function recoveryFixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const track = { id:'album:song-three', slug:'album', src:'/api/library/stream?slug=album&trackSlug=song-three&redirect=1',
    metadata:{albumSlug:'album',trackSlug:'song-three',trackIndex:2,access:{canStream:true,previewOnly:false}} };
  const audio = Object.assign(new EventTarget(), { src:track.src, currentSrc:track.src,
    currentTime:64,duration:180,readyState:4,networkState:1,paused:true,ended:false,error:null,
    loads:0,plays:0,load(){this.loads++;this.error=null;},
    async play(){this.plays++;this.paused=false;},pause(){this.paused=true;},removeAttribute(){} });
  const context = Object.assign(new EventTarget(), { state:'running',currentTime:10,resumes:0,
    async resume(){this.resumes++;this.state='running';} });
  const state={currentTrack:track,isPlaying:false,hasStarted:true,playbackState:'paused',queueIndex:2};
  const patches=[];
  const d={audio, audioRef:ref(audio),stateRef:ref(state),audioCtxRef:ref(context),
    playRequestIdRef:ref(1),commandRequestIdRef:ref(1),activeCommandRef:ref(null),activeStreamAbortRef:ref(null),
    userPausedRef:ref(false),userIntentPausedRef:ref(false),playbackIntentBeforeHideRef:ref(true),
    skipPauseInterruptionRef:ref(false),
    queueRef:ref([{}, {}, track, {id:'album:four',slug:'album',src:'/four'}]),queueIndexRef:ref(2),
    webAudioInitializedRef:ref(true),isRecoveringRef:ref(false),recoveryCooldownUntilRef:ref(0),
    recoveryVerificationRef:ref(null),
    audibilitySampleRef:ref({lastTime:0,lastAt:0,frozenSince:null}),streamErrorRetriedRef:ref(0),streamMetaRef:ref(null),
    stopAfterEachTrackRef:ref(false),sleepTimerRef:ref({}),repeatModeRef:ref('off'),shuffleRef:ref(false),
    spuriousEndedGuardRef:ref(0),lastPersistRef:ref({}),listeningProgressRef:ref({}),
    patchState(p){patches.push(p);Object.assign(state,p);},blockRecoveryForLifecycleOsSuspended:()=>false,
    requestAuthoritativePlay:()=>true,
  };
  const deps = new Proxy(d,{get(obj,key){
    if(key in obj)return obj[key];
    return String(key).endsWith('Ref')?(obj[key]=ref(null)):()=>{};
  }});
  const helpers=createPlaybackHelpers(deps);
  const commands={_deps:deps};
  // Use real helper/command implementations; fake only host media and authority.
  d.attemptLightweightPlaybackResume=(...args)=>helpers.attemptLightweightPlaybackResume(...args);
  d.resolveLibraryStreamForTrack=(...args)=>helpers.resolveLibraryStreamForTrack(...args);
  helpers.initWebAudio=()=>{};
  helpers.patchState=d.patchState;
  attachRecoveryCommands(commands);
  const restore=installCurrentPhysicalEffectGuard({canApplyCurrentEffect:({mediaIdentity})=>
    mediaIdentity === state.currentTrack.id && !d.userIntentPausedRef.current && !d.userPausedRef.current});
  t.after(restore);
  const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});
  t.after(()=>{if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;});
  const advance=()=>{audio.currentTime+=0.3;audio.dispatchEvent(new Event('timeupdate'));};
  return {audio,context,state,track,deps,helpers,commands,patches,advance,
    handlers:()=>createPlaybackEventHandlers(deps)};
}
