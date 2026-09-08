import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

class FakeHls {
  static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level' };
  static ErrorTypes = {};
  static ErrorDetails = {};
  static DefaultConfig = { loader: class {} };
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
