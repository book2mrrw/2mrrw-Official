import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

class FakeHls {
  static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', FRAG_BUFFERED: 'buffered' };
  static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
  static ErrorDetails = { KEY_LOAD_ERROR: 'key', FRAG_DECRYPT_ERROR: 'decrypt' };
  static DefaultConfig = { loader: class {}, abrController: class {} };
  static supported = true;
  static isSupported() { return this.supported; }
  constructor(config) {
    this.config = config;
    this.handlers = new Map();
    this.levels = [{ bitrate: 64000 }, { bitrate: 96000 }, { bitrate: 160000 }, { bitrate: 320000 }];
    this.currentLevel = -1;
  }
  get autoLevelEnabled() { return this.currentLevel === -1; }
  on(event, fn) { this.handlers.set(event, fn); }
  startLoad() {}
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
  test(`${network} startup keeps live adaptation enabled after manifest parsing`, async (t) => {
    environment(t, network);
    const engine = new HLSEngine();
    assert.equal(await engine.loadTrack('/master.m3u8', {}), true);
    assert.equal(engine._hls.startLevel, index);
    assert.equal(engine._hls.autoLevelEnabled, true);
    engine.detach();
    assert.equal(engine.isLoaded, false);
  });
}

test('an explicit quality pin remains manual and clearing it restores auto', async (t) => {
  environment(t, '4g');
  const engine = new HLSEngine();
  engine.setQualityLevel(1);
  await engine.loadTrack('/master.m3u8', {});
  assert.equal(engine._hls.currentLevel, 2);
  assert.equal(engine._hls.autoLevelEnabled, false);
  engine.setQualityLevel(-1);
  assert.equal(engine._hls.autoLevelEnabled, true);
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
  const engine = new HLSEngine();
  const audio = { canPlayType: () => 'probably' };
  assert.equal(await engine.loadTrack('/native.m3u8', audio), true);
  assert.equal(engine.isLoaded, true);
  engine.detach();
  assert.equal(engine.isLoaded, false);
  assert.equal(await engine.loadTrack('/unsupported.m3u8', { canPlayType: () => '' }), false);
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
