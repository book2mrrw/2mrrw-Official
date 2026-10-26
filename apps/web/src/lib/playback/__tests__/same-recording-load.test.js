import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// JSX UI is outside the media preparation boundary exercised here.
mock.module('../../../context/AudioContext.js', { namedExports: { useAudioPlayer: () => ({}), useAudio: () => ({}) } });
const { attachStreamCommands } = await import('../PlaybackStreamCommands.js');
const ref = current => ({current});
const track = { id: 'album:three', slug: 'album', src: '/api/library/stream?slug=album&trackSlug=three&redirect=1',
  metadata: {albumSlug:'album', trackSlug:'three', trackIndex:2, access:{canStream:true,previewOnly:false}} };

for (const scenario of ['same-hls', 'same-native', 'same-progressive', 'next-album-recording', 'ended', 'error', 'empty', 'access-upgrade', 'access-downgrade', 'replacement-source', 'loading']) {
  test(`early media preparation: ${scenario}`, async () => {
    const same = scenario.startsWith('same-');
    const src = scenario === 'same-native' ? '/api/library/hls?slug=album&trackSlug=three'
      : scenario === 'same-progressive' ? 'https://cdn.test/three.mp3' : 'blob:active-hls';
    const audio = {src, currentSrc:src, readyState:scenario === 'empty' ? 0 : 4,
      ended:scenario === 'ended', error:scenario === 'error' ? {code:2} : null,
      paused:false, currentTime:64, pauses:0, loads:0,
      pause(){this.pauses++;this.paused=true;}, load(){this.loads++;}};
    let requested = scenario === 'next-album-recording'
      ? {...track,id:'album:four',src:'/api/library/stream?slug=album&trackSlug=four&redirect=1',metadata:{...track.metadata,trackSlug:'four',trackIndex:3}} : track;
    let loaded = track;
    if (scenario === 'access-upgrade') loaded = {...track,src:'/preview.mp3',metadata:{...track.metadata,access:{canStream:false,previewOnly:true}}};
    if (scenario === 'access-downgrade') requested = {...track,src:'/preview.mp3',metadata:{...track.metadata,access:{canStream:false,previewOnly:true}}};
    if (scenario === 'replacement-source') requested = {...track,src:'https://cdn.test/replacement.mp3'};
    const boundary = new Error('end of early media preparation');
    const values = {audioRef:ref(audio),stateRef:ref({currentTrack:loaded,playbackState:scenario === 'loading' ? 'loading' : 'playing'}),entitlementAccountStateRef:ref(null),
      playRequestIdRef:ref(1),activeStreamAbortRef:ref(null),userIntentPausedRef:ref(false),skipPauseInterruptionRef:ref(false),
      initWebAudio(){throw boundary;}};
    const deps = new Proxy(values,{get(o,k){if(k in o)return o[k];return String(k).endsWith('Ref')?(o[k]=ref(null)):()=>{};}});
    const service = {_deps:deps};attachStreamCommands(service);
    await assert.rejects(service.playTrackInternal(requested), error => error === boundary);
    assert.equal(audio.pauses, same ? 0 : 1);
    const replaceDirect = ['access-downgrade','replacement-source'].includes(scenario);
    assert.equal(audio.loads, replaceDirect ? 1 : 0);
    assert.equal(audio.src, replaceDirect ? requested.src : src);
    assert.equal(audio.currentTime, 64);
  });
}
