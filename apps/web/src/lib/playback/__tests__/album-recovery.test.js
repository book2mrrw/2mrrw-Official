import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryFixture, flush, deferred } from './recovery-fixture.mjs';
import * as streamClient from '../stream-client.js';
const { fetchLibraryStreamForTrack } = streamClient;

function respond(t, h, transform = url => url) {
  const urls=[];
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    urls.push([url,opts]);
    return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
      json:async()=>({url:transform(h.track.src),sessionId:'s',streamEventId:'e'})};
  });
  return urls;
}

test('album error recovery retains song three, position, queue and authenticated request',async t=>{
  const h=recoveryFixture(t), urls=respond(t,h),queue=h.deps.queueRef.current;
  h.audio.error={code:2};
  const pending=h.handlers().onError();await flush();
  assert.equal(h.audio.plays,1);assert.equal(h.state.isPlaying,false);
  assert.equal(new URL(urls[0][0],'https://fixture.test').searchParams.get('trackSlug'),'song-three');
  h.audio.error=null;h.advance();assert.equal(await pending,true);
  assert.equal(new URL(urls[0][0],'https://fixture.test').searchParams.get('slug'),'album');
  assert.equal(urls[0][1].credentials,'include');
  assert.equal(h.deps.queueRef.current,queue);assert.equal(h.deps.queueIndexRef.current,2);
  assert.equal(h.state.currentTrack.id,'album:song-three');assert.equal(h.audio.currentTime,64.3);
});

for(const response of ['wrong-track','missing-track','wrong-release','opaque']) {
  test(`album retry rejects a ${response} response before applying it`,async t=>{
    const h=recoveryFixture(t),original=h.audio.src;
    respond(t,h,()=>response==='opaque'?'https://cdn.fixture.test/audio.mp3':
      `/api/library/stream?slug=${response==='wrong-release'?'other':'album'}&redirect=1${response==='missing-track'?'':`&trackSlug=${response==='wrong-track'?'song-one':'song-three'}`}`);
    assert.equal(await h.handlers().onError(),false);
    assert.equal(h.audio.src,original);assert.equal(h.audio.plays,0);assert.equal(h.state.playbackState,'paused');
  });
}

test('repeated resolution failures stop at three requests, including repeated error events',async t=>{
  const h=recoveryFixture(t);let calls=0;const urls=[];
  t.mock.method(globalThis,'fetch',async url=>{calls++;urls.push(url);throw Error('network fixture failure');});
  const handlers=h.handlers();const pending=handlers.onError();
  assert.equal(handlers.onError(),pending);
  await flush();t.mock.timers.tick(250);await flush();t.mock.timers.tick(1000);await flush();
  assert.equal(await pending,false);assert.equal(calls,3);
  assert.ok(urls.every(url=>new URL(url,'https://fixture.test').searchParams.get('trackSlug')==='song-three'));
  await handlers.onError();assert.equal(calls,3);
  assert.equal(h.state.playbackState,'paused');assert.equal(h.state.streamRetryable,true);
  assert.equal(h.state.currentTrack,h.track);assert.equal(h.deps.queueIndexRef.current,2);
});

test('server entitlement denial remains terminal and never calls play',async t=>{
  const h=recoveryFixture(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;return {ok:false,status:403};});
  assert.equal(await h.handlers().onError(),false);
  assert.equal(calls,1);assert.equal(h.audio.plays,0);assert.equal(h.state.accessDenied,true);
});

for(const change of ['different-song-same-album','same-song-new-request','pause']) {
  test(`a late album response cannot replace ${change}`,async t=>{
    const h=recoveryFixture(t),gate=deferred(),original=h.audio.src;
    t.mock.method(globalThis,'fetch',()=>gate.promise);
    const pending=h.handlers().onError();await flush();
    if(change==='different-song-same-album')h.state.currentTrack={...h.track,id:'album:song-four',metadata:{...h.track.metadata,trackSlug:'song-four',trackIndex:3}};
    if(change==='same-song-new-request')h.deps.playRequestIdRef.current++;
    if(change==='pause')h.deps.userIntentPausedRef.current=true;
    h.state.playbackState='newer-state';
    gate.resolve({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({url:h.track.src})});
    assert.equal(await pending,false);assert.equal(h.audio.src,original);assert.equal(h.audio.plays,0);
    assert.equal(h.state.playbackState,'newer-state');assert.equal(h.deps.streamMetaRef.current,null);
  });
}

test('a rejected next-track handoff stays on the ended occurrence with an explicit retry state',t=>{
  const h=recoveryFixture(t);h.state.isPlaying=true;h.audio.ended=true;
  h.deps.requestAuthoritativePlay=()=>false;
  const handlers=h.handlers();handlers.onEnded();handlers.onEnded();
  assert.equal(h.deps.queueIndexRef.current,2);assert.equal(h.state.currentTrack,h.track);
  assert.equal(h.state.playbackState,'paused');assert.equal(h.state.streamRetryable,true);assert.ok(h.state.error);
});

test('missing album recording identity cannot silently request track one',async t=>{
  const h=recoveryFixture(t);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('must not fetch');});
  await assert.rejects(async()=>fetchLibraryStreamForTrack({...h.track,src:'/api/library/stream?slug=album',metadata:{albumSlug:'album'}}),{code:'STREAM_TRACK_IDENTITY_MISSING'});
  assert.equal(calls,0);
});

test('an unresponsive resolver is aborted and stops at the same three-request bound',async t=>{
  const h=recoveryFixture(t),signals=[];
  t.mock.method(globalThis,'fetch',(_,options)=>{signals.push(options.signal);return new Promise(()=>{});});
  const pending=h.handlers().onError();await flush();
  for(const backoff of [250,1000,0]) {
    t.mock.timers.tick(12000);await flush();
    if(backoff){t.mock.timers.tick(backoff);await flush();}
  }
  assert.equal(await pending,false);assert.equal(signals.length,3);assert.ok(signals.every(s=>s.aborted));
  assert.equal(h.state.playbackState,'paused');assert.equal(h.audio.plays,0);
});

test('a first play with no prior selection resolves its exact recording',async t=>{
  const h=recoveryFixture(t);h.state.currentTrack=null;respond(t,h);
  const result=await h.helpers.resolveLibraryStreamForTrack(h.track,{force:true});
  assert.equal(result.track.src,h.track.src);assert.equal(result.meta.trackSlug,'song-three');
});

test('hard source recovery keeps the failed recording and its saved position',async t=>{
  const h=recoveryFixture(t),urls=respond(t,h);h.audio.error={code:2};
  const context=h.context,queue=h.deps.queueRef.current;
  const pending=h.commands.recoverAudioHard('media_error_2',{resumeAfter:true});await flush();
  assert.equal(h.audio.plays,1);h.advance();assert.equal(await pending,true);
  assert.equal(new URL(urls[0][0],'https://fixture.test').searchParams.get('trackSlug'),'song-three');
  assert.equal(h.audio.currentTime,64.3);assert.equal(h.deps.audioCtxRef.current,context);
  assert.equal(h.deps.queueRef.current,queue);assert.equal(h.deps.queueIndexRef.current,2);
});

test('hard recovery cannot overlap a pending recording retry',async t=>{
  const h=recoveryFixture(t),gate=deferred();t.mock.method(globalThis,'fetch',()=>gate.promise);
  const error=h.handlers().onError();await flush();
  assert.equal(await h.commands.recoverAudioHard('media_error_2',{resumeAfter:true}),false);
  h.deps.playRequestIdRef.current++;
  gate.resolve({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>({url:h.track.src})});
  assert.equal(await error,false);assert.equal(h.audio.plays,0);
});
