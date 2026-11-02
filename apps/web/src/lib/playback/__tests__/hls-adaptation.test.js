import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import ActualHls from 'hls.js';

class FakeHls {
  static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', FRAG_BUFFERED: 'buffered' };
  static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
  static ErrorDetails = { KEY_LOAD_ERROR: 'key', FRAG_DECRYPT_ERROR: 'decrypt', FRAG_PARSING_ERROR: 'parse' };
  static DefaultConfig = { loader: class {}, abrController: class {} };
  static supported = true;
  static isSupported() { return this.supported; }
  constructor(config) {
    this.config = config;
    this.handlers = new Map();
    this.levels = [{ bitrate: 64000 }, { bitrate: 96000 }, { bitrate: 160000 }, { bitrate: 320000 }];
    this._currentLevel = -1;
    this._loadLevel = -1;
    this.manualLevel = -1;
    this.immediateSwitches = 0;
  }
  get currentLevel() { return this._currentLevel; }
  set currentLevel(value) { this._currentLevel = value; this.manualLevel = value; this.immediateSwitches++; }
  get loadLevel() { return this._loadLevel; }
  set loadLevel(value) { this._loadLevel = value; this.manualLevel = value; }
  get autoLevelEnabled() { return this.manualLevel === -1; }
  on(event, fn) { this.handlers.set(event, fn); }
  startLoad() { this.manualLevelAtFirstRequest = this.manualLevel; }
  loadSource() {}
  attachMedia() { queueMicrotask(() => this.handlers.get('manifest')?.('manifest', { levels: this.levels })); }
  detachMedia() {}
  destroy() { this.handlers.clear(); }
}
mock.module('hls.js', { defaultExport: FakeHls });
const { HLSEngine } = await import('../../audio/HLSEngine.js');

function environment(t, effectiveType) {
  for (const [key, value] of Object.entries({ window: {}, navigator: { connection: { effectiveType } } })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (old) Object.defineProperty(globalThis, key, old); else delete globalThis[key]; });
  }
}

for (const [network, index] of [['2g', 0], ['3g', 2], ['4g', 3]]) {
  test(`${network} selects one rendition before any segment request`, async (t) => {
    environment(t, network);
    const engine = new HLSEngine();
    assert.equal(await engine.loadTrack('/master.m3u8', {}), true);
    assert.equal(engine._hls.startLevel, index);
    assert.equal(engine._hls.manualLevelAtFirstRequest, index);
    assert.equal(engine._hls.autoLevelEnabled, false);
    assert.equal(engine._hls.autoLevelCapping, index);
    engine.detach();
    assert.equal(engine.isLoaded, false);
  });
}

test('quality preferences apply to the next load and cannot reopen ABR on the playing song', async (t) => {
  environment(t, '4g');
  const engine = new HLSEngine();
  engine.setQualityLevel(1);
  await engine.loadTrack('/master.m3u8', {});
  assert.equal(engine._hls.loadLevel, 2);
  assert.equal(engine._hls.autoLevelEnabled, false);
  assert.equal(engine.holdCurrentQualityForPlayback(), null, 'an explicit pin remains authoritative');
  engine.setQualityLevel(-1);
  assert.equal(engine._hls.autoLevelEnabled, false);
  assert.equal(engine._hls.loadLevel, 2);
  engine.detach();
  await engine.loadTrack('/next', {});
  assert.equal(engine._hls.loadLevel, 3);
  engine.detach();
});

for (const network of ['3g', '4g']) {
  test(`installed hls.js recovery cannot clear or escape the ${network} selected tier`, async t => {
    environment(t, network);
    const engine = new HLSEngine(); t.after(() => engine.destroy());
    await engine.loadTrack('/master', {});
    const selected = engine._trackQualityCap;
    const config = engine._hls.config;
    const actual = new ActualHls({ enableWorker: false, autoStartLoad: false,
      preserveManualLevelOnError: config.preserveManualLevelOnError, minAutoBitrate: config.minAutoBitrate });
    t.after(() => actual.destroy());
    const levels = [64000, 96000, 160000, 320000].map(bitrate => ({ bitrate, maxBitrate: bitrate,
      loadError: 0, fragmentError: 0, codecSet: 'mp4a', attrs: {} }));
    Object.assign(actual.levelController, { _levels: levels, manualLevelIndex: selected,
      currentLevelIndex: selected, currentLevel: levels[selected] });
    actual.autoLevelCapping = engine._hls.autoLevelCapping;
    const errors = actual.networkControllers.find(controller => controller instanceof ActualHls.DefaultConfig.errorController);
    const action = errors.getLevelSwitchAction({ details: ActualHls.ErrorDetails.FRAG_LOAD_ERROR,
      frag: { type: 'main', level: selected } }, selected);
    assert.equal(actual.autoLevelEnabled, false, 'retry exhaustion must not silently clear manual selection');
    assert.equal(action.nextAutoLevel, undefined, 'recovery cannot select another encoder stream');
    assert.equal(actual.minAutoLevel, selected);
    assert.equal(actual.maxAutoLevel, selected);
  });
}

test('automatic quality is held at the selected startup rendition after the buffer gate', async (t) => {
  environment(t, '4g');
  const engine = new HLSEngine();
  await engine.loadTrack('/master.m3u8', {});
  engine._hls._currentLevel = 3;
  assert.equal(engine.holdCurrentQualityForPlayback(), 3);
  assert.equal(engine._hls.autoLevelEnabled, false, 'the selected rendition is fixed for this play');
  assert.equal(engine._hls.loadLevel, 3);
  assert.equal(engine._hls.immediateSwitches, 0, 'locking does not flush the existing startup buffer');

  engine._hls.handlers.get('level')('level', { level: 2 });
  assert.equal(engine._hls.loadLevel, 3, 'an observed level event cannot change the fixed rendition');
  assert.equal(engine._trackQualityCap, 3);
  engine.detach();
  assert.equal(engine._trackQualityCap, null, 'a new track starts with a fresh selection');
});

test('a late buffered event cannot replace the rendition selected before startup', async (t) => {
  environment(t, '4g');
  const engine = new HLSEngine();
  await engine.loadTrack('/master.m3u8', {});
  engine._hls._currentLevel = -1;
  engine._hls.handlers.get('buffered')('buffered', {
    frag: { type: 'main', sn: 1, level: 2, stats: { loaded: 1024, aborted: false } },
  });
  assert.equal(engine.holdCurrentQualityForPlayback(), 3);
  assert.equal(engine._hls.loadLevel, 3);
  engine.detach();
});

test('a token refresh reloads the same rendition during the active play', async (t) => {
  environment(t, '4g');
  const engine = new HLSEngine();
  await engine.loadTrack('/master.m3u8', {});
  engine._hls._currentLevel = 2; // A stale observation cannot change the selected tier.
  engine.holdCurrentQualityForPlayback();
  await engine.loadTrack('/master.m3u8', {});
  assert.equal(engine._hls.loadLevel, 3);
  assert.equal(engine._hls.autoLevelEnabled, false);
  engine.detach();
});

test('an old async load cannot attach over a successor after detach', async (t) => {
  environment(t, '4g');
  const engine = new HLSEngine();
  const old = engine.loadTrack('/old.m3u8', {});
  engine.detach();
  const next = engine.loadTrack('/next.m3u8', {});
  assert.equal(await old, false);
  assert.equal(await next, true);
  assert.equal(engine._manifestUrl, '/next.m3u8');
  engine.detach();
});

test('native HLS counts as loaded and unsupported browsers fall back', async (t) => {
  environment(t, '4g');
  FakeHls.supported = false;
  t.after(() => { FakeHls.supported = true; });
  t.mock.method(globalThis, 'fetch', async () => new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\n/low\n#EXT-X-STREAM-INF:BANDWIDTH=320000\n/high'));
  const engine = new HLSEngine();
  const audio = { canPlayType: () => 'probably' };
  assert.equal(await engine.loadTrack('/native.m3u8', audio), true);
  assert.equal(audio.src, 'https://www.2mrrw.com/high', 'native decoder gets one rendition, never an adaptive master');
  assert.equal(engine.isLoaded, true);
  engine.detach();
  assert.equal(engine.isLoaded, false);
  assert.equal(await engine.loadTrack('/unsupported.m3u8', { canPlayType: () => '' }), false);
});

test('native manifest authorization failure never falls through to an uncontrolled adaptive master', async t => {
  environment(t, '4g'); FakeHls.supported = false;
  t.after(() => { FakeHls.supported = true; });
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
  const engine = new HLSEngine(); const audio = { canPlayType: () => 'probably' };
  assert.equal(await engine.loadTrack('/denied', audio), false);
  assert.equal(audio.src, undefined);
  assert.equal(engine.isLoaded, false);
  engine.destroy();
});

test('a decoder-rejected cached fragment cannot survive recovery or a late prefetch', async t => {
  environment(t, '4g');
  const { encryptedSegmentStore: store } = await import('../../audio/encrypted-segment-store.js');
  const { setSegment, getSegment } = await import('../../audio/hls-segment-cache.js');
  const url = 'https://cdn.test/rejected-by-decoder.ts?v=one';
  await store.put(url, new ArrayBuffer(16));
  assert.ok(await store.get(url));
  const engine = new HLSEngine(); t.after(() => engine.destroy());
  await engine.loadTrack('/master', {});
  engine._hls.handlers.get('error')('error', { fatal: false, type: 'media', details: 'parse', frag: { url } });
  await store.writes;
  setSegment(url, new ArrayBuffer(16));
  assert.equal(getSegment(url), null);
  assert.equal(await store.get(url), null);
  assert.equal(await store.has(url), false);
  assert.equal(engine._hls.loadLevel, 3, 'cache repair cannot change the selected bitrate');
});

test('detaching during native manifest retrieval aborts and cannot attach a stale source', async t => {
  environment(t, '4g'); FakeHls.supported = false;
  t.after(() => { FakeHls.supported = true; });
  let release, signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal;
    return new Promise(resolve => { release = resolve; });
  });
  const engine = new HLSEngine(); const audio = { canPlayType: () => 'probably' };
  const pending = engine.loadTrack('/old', audio);
  await new Promise(resolve => setImmediate(resolve));
  engine.detach(); assert.equal(signal.aborted, true);
  release(new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=320000\n/high'));
  assert.equal(await pending, false);
  assert.equal(audio.src, undefined);
  assert.equal(engine.isLoaded, false);
  engine.destroy();
});

for (const details of ['key', 'decrypt']) {
  test(`${details} renewal remains bounded after manifest-only success`, async (t) => {
    environment(t, '4g');
    const engine = new HLSEngine();
    t.after(() => engine.destroy());
    await engine.loadTrack('/master.m3u8', {currentTime:12});
    for (const attempt of [1,2]) {
      engine._hls.handlers.get('error')('error', {fatal:true,type:details==='key'?'network':'media',details,response:{code:403}});
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(engine._renewalAttempts,attempt);
    }
    const last = engine._hls;
    engine._hls.handlers.get('error')('error', {fatal:true,type:details==='key'?'network':'media',details,response:{code:403}});
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(engine._hls === last || engine._hls === null);
  });
}

test('only active buffered media restores the renewal budget', async (t) => {
  environment(t,'4g');
  const engine = new HLSEngine();
  t.after(() => engine.destroy());
  await engine.loadTrack('/first.m3u8',{});
  const oldHandler = engine._hls.handlers.get('buffered');
  engine.detach();
  await engine.loadTrack('/next.m3u8',{});
  engine._renewalAttempts = 2;
  const data = {frag:{type:'main',sn:1,stats:{loaded:100,aborted:false}}};
  oldHandler('buffered',data);
  assert.equal(engine._renewalAttempts,2);
  const handler = engine._hls.handlers.get('buffered');
  handler('buffered',{frag:{...data.frag,sn:'initSegment'}});
  handler('buffered',{frag:{...data.frag,stats:{loaded:0}}});
  assert.equal(engine._renewalAttempts,2);
  handler('buffered',data);
  assert.equal(engine._renewalAttempts,0);
});

test('a renewal cancelled by a track change cannot invoke fallback on its successor', async (t) => {
  environment(t,'4g');
  const engine = new HLSEngine();
  t.after(() => engine.destroy());
  let fallback = 0;
  engine.onSegmentFatalError = () => fallback++;
  await engine.loadTrack('/old.m3u8', {currentTime:10});
  engine._hls.handlers.get('error')('error',{fatal:true,type:'network',details:'key',response:{code:403}});
  engine.detach();
  await engine.loadTrack('/next.m3u8',{});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fallback,0);
  assert.equal(engine._manifestUrl,'/next.m3u8');
});


test('a complete highest rendition seeds replay even on a weak link; eviction returns to the network hint', async t => {
  environment(t, '2g');
  const { encryptedSegmentStore: store } = await import('../../audio/encrypted-segment-store.js');
  const { setSegment, clearSegmentCache } = await import('../../audio/hls-segment-cache.js');
  const originalAttach = FakeHls.prototype.attachMedia;
  const high = 'https://site.test/variant?slug=replay&bitrate=320k&v=one&token=fresh';
  const url = 'https://cdn.test/replay/320k/one.ts?v=one';
  FakeHls.prototype.attachMedia = function () {
    this.levels[3].url = [high];
    originalAttach.call(this);
  };
  t.after(() => { FakeHls.prototype.attachMedia = originalAttach; clearSegmentCache(); });
  await store.remember(high, [url]);
  setSegment(url, new ArrayBuffer(4));
  const engine = new HLSEngine();
  await engine.loadTrack('/master', {});
  assert.equal(engine._hls.startLevel, 3);
  assert.equal(engine._hls.loadLevel, 3, 'fully warmed replay cannot be downgraded during startup');
  engine.detach();
  clearSegmentCache();
  await engine.loadTrack('/master', {});
  assert.equal(engine._hls.startLevel, 0);
  engine.detach();
});

test('standby HLS initialization cannot steal the download lease; a committed deck swap transfers ownership', async t => {
  environment(t, '4g');
  const { setActiveHLSEngine } = await import('../../audio/HLSEngine.js');
  const { hlsDownloadManager: downloads } = await import('../../audio/hls-download-manager.js');
  const active = new HLSEngine(); const standby = new HLSEngine();
  const first = new EventTarget(); const second = new EventTarget();
  t.after(() => { active.detach(); standby.detach(); setActiveHLSEngine(null); downloads.stop(); });
  setActiveHLSEngine(active);
  await active.loadTrack('/first', first);
  active._hls.levels[3].url = ['https://site.test/variant?slug=first&v=1'];
  active._hls._currentLevel = 3;
  active.holdCurrentQualityForPlayback();
  assert.equal(downloads.session.audio, first);
  await standby.loadTrack('/second', second);
  standby._hls.levels[3].url = ['https://site.test/variant?slug=second&v=1'];
  standby._hls._currentLevel = 3;
  standby.holdCurrentQualityForPlayback();
  assert.equal(downloads.session.audio, first);
  setActiveHLSEngine(standby);
  assert.equal(downloads.session.audio, second);
  active.detach();
  assert.equal(downloads.session.audio, second, 'destroying the old deck cannot stop its successor');
});

test('native format support alone does not replace the established MSE/Web Audio transport',async t=>{
  environment(t,'4g');FakeHls.supported=true;
  t.mock.method(globalThis,'fetch',async()=>new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=320000\n/variant'));
  const engine=new HLSEngine();t.after(()=>engine.destroy());const audio={canPlayType:()=> 'probably'};
  assert.equal(await engine.loadTrack('/master',audio),true);
  assert.ok(engine._hls instanceof FakeHls,'format support does not certify native compatibility with the Web Audio graph');
  assert.equal(engine._native,false);
});
