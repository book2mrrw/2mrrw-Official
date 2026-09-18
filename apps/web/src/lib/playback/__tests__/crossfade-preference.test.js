import test from 'node:test';
import assert from 'node:assert/strict';
import { getCrossfadeEnabled, setCrossfadeEnabled, releaseCrossfadeScope, playlistCrossfadeScope, trackCrossfadeScope, subscribeCrossfade } from '../crossfade/preference.js';

test('release overrides remain independent of other releases and the homepage default', () => {
  const a = releaseCrossfadeScope({ slug: 'a' }); const b = releaseCrossfadeScope({ slug: 'b' });
  setCrossfadeEnabled(false); setCrossfadeEnabled(true, a); setCrossfadeEnabled(false, b);
  assert.equal(getCrossfadeEnabled(a), true); assert.equal(getCrossfadeEnabled(b), false);
  assert.equal(getCrossfadeEnabled(), false);
  setCrossfadeEnabled(true);
  assert.equal(getCrossfadeEnabled(b), false); assert.equal(getCrossfadeEnabled('release:new'), true);
  setCrossfadeEnabled(false); setCrossfadeEnabled(false, a);
});
test('playlist identity takes precedence over constituent album identity', () => {
  const scope = playlistCrossfadeScope({ id: 'my-list' });
  assert.equal(trackCrossfadeScope({ source: 'playlist', metadata: { playlistId: 'my-list', albumSlug: 'album' } }), scope);
  assert.equal(trackCrossfadeScope({ metadata: { albumSlug: 'album' } }), releaseCrossfadeScope({ slug: 'album' }));
  assert.equal(trackCrossfadeScope({ source: 'playlist', metadata: { albumSlug: 'album' } }), null);
});
test('card and modal subscribers observe one scoped preference and unsubscribe cleanly', () => {
  const scope = 'release:shared'; let card = 0; let modal = 0;
  const a = subscribeCrossfade(() => { card++; }); const b = subscribeCrossfade(() => { modal++; });
  setCrossfadeEnabled(true, scope); assert.equal(card, 1); assert.equal(modal, 1);
  a(); b(); setCrossfadeEnabled(false, scope); assert.equal(card, 1); assert.equal(modal, 1);
});

test('saved collection overrides survive reload and migrate the previous homepage preference', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map([['2mrrw_song_crossfade_v1', '1']]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
  } } });
  try {
    const first = await import('../crossfade/preference.js?first'); first.initializeCrossfadePreference();
    assert.equal(first.getCrossfadeEnabled(), true);
    first.setCrossfadeEnabled(false, 'release:saved');
    const reloaded = await import('../crossfade/preference.js?reloaded'); reloaded.initializeCrossfadePreference();
    assert.equal(reloaded.getCrossfadeEnabled(), true);
    assert.equal(reloaded.getCrossfadeEnabled('release:saved'), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original); else delete globalThis.window;
  }
});
