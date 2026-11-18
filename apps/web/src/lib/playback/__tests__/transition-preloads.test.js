import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { previousTrackPrimeSrc } from '../PlaybackEventHandlers.js';
import { createPlaybackHelpers } from '../PlaybackHelperService.js';

const song = (src, canStream) => ({ src, metadata: { access: { canStream } } });
// normalizePlaybackSrc resolves against the page origin; compare path and query.
const prime = (track, hlsJsActive) => {
  const url = previousTrackPrimeSrc(track, { hlsJsActive });
  if (!url) return url;
  const parsed = new URL(url, 'http://localhost');
  return parsed.origin === 'http://localhost' ? parsed.pathname + parsed.search : url;
};

test('a song that plays through hls.js is never primed as a whole progressive download', () => {
  assert.equal(prime(song('/api/library/stream?slug=w2d&redirect=1', true), true), null);
});

test('priming the previous song never records a play', () => {
  for (const [track, hlsJsActive] of [
    [song('/api/library/stream?slug=w2d&redirect=1', true), false],
    [song('/api/library/stream?slug=w2d&redirect=1', false), true],
  ]) {
    assert.equal(prime(track, hlsJsActive), '/api/library/stream?slug=w2d&redirect=1&preload=1');
  }
  assert.equal(
    prime(song('/api/library/stream?slug=w2d&redirect=1&preload=1', false), true),
    '/api/library/stream?slug=w2d&redirect=1&preload=1');
});

test('previews and CDN files prime unchanged; signed-URL sources and empty tracks do not prime', () => {
  assert.equal(prime(song('https://cdn.example/preview.m4a', false), true), 'https://cdn.example/preview.m4a');
  assert.equal(prime(song('/api/library/stream?slug=w2d', false), true), null);
  assert.equal(prime(null, true), null);
});

test('the next hls.js song warms its whole first-play chain, not only segments', () => {
  const src = fs.readFileSync(new URL('../PlaybackHelperService.js', import.meta.url), 'utf8');
  const start = src.indexOf('async scheduleNextTrackPreload()');
  const branch = src.slice(start, src.indexOf('const preloadEl = self._deps.nextTrackPreloadRef.current;', start));
  assert.match(branch, /prefetchHlsSegmentsForTrack\(slug, trackSlug\)/);
  assert.match(branch, /warmHlsStart\(slug, trackSlug, \{ intent: true \}\)/);
});

test('hovering a signed-URL song makes no request: no stream session, no recorded play', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requests.push(String(url));
    return { ok: true, status: 200, json: async () => ({ url: 'https://cdn.example/w2d.m4a', expiresIn: 3600 }) };
  });
  const preload = { src: '', loads: 0, load() { this.loads += 1; } };
  const helper = createPlaybackHelpers({ intentPrewarmRef: { current: preload }, nextTrackSignedUrlCacheRef: { current: {} } });
  for (let i = 0; i < 3; i += 1) {
    await helper.hintUpcomingPlay({ src: '/api/library/stream?slug=w2d', slug: 'w2d', metadata: { access: { canStream: false } } });
  }
  assert.deepEqual(requests, []);
  assert.equal(preload.loads, 0);
});
