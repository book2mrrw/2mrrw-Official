import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { clearSegmentCache, getSegment, setSegment } from '../../audio/hls-segment-cache.js';
import { createPrefetchLoaderClass } from '../../audio/hls-prefetch-loader.js';

beforeEach(clearSegmentCache);
const url = 'https://media.test/track-4/segment-0.ts';
const bytes = () => new Uint8Array([1, 2, 3, 4]).buffer;

test('decoder transfer cannot detach retained segment bytes', () => {
  setSegment(url, bytes());
  const first = getSegment(url);
  structuredClone(first, { transfer: [first] });
  assert.equal(first.byteLength, 0);
  assert.deepEqual([...new Uint8Array(getSegment(url))], [1, 2, 3, 4]);
});

test('cache owns a snapshot independent of the prefetch producer', () => {
  const input = bytes();
  setSegment(url, input);
  new Uint8Array(input)[0] = 99;
  structuredClone(input, { transfer: [input] });
  assert.deepEqual([...new Uint8Array(getSegment(url))], [1, 2, 3, 4]);
});

test('separate readers cannot mutate each other or the retained cache', () => {
  setSegment(url, bytes());
  const first = getSegment(url);
  const second = getSegment(url);
  new Uint8Array(first)[0] = 99;
  assert.deepEqual([...new Uint8Array(second)], [1, 2, 3, 4]);
  assert.deepEqual([...new Uint8Array(getSegment(url))], [1, 2, 3, 4]);
});

test('empty, detached, and over-budget segments remain cache misses', () => {
  const detached = bytes();
  structuredClone(detached, { transfer: [detached] });
  for (const input of [new ArrayBuffer(0), detached, new ArrayBuffer(15 * 1024 * 1024 + 1)]) {
    setSegment(url, input);
    assert.equal(getSegment(url), null);
  }
  setSegment(url, bytes());
  assert.equal(getSegment(url).byteLength, 4);
});

test('cache retains its size bound and clearing removes owned bytes', () => {
  setSegment('first', new ArrayBuffer(8 * 1024 * 1024));
  setSegment('second', new ArrayBuffer(8 * 1024 * 1024));
  assert.equal(getSegment('first'), null);
  assert.equal(getSegment('second').byteLength, 8 * 1024 * 1024);
  clearSegmentCache();
  assert.equal(getSegment('second'), null);
});

test('real prefetch loader delivers intact bytes on repeated decoder consumption and falls back on empty input', async () => {
  let networkLoads = 0;
  class NetworkLoader {
    load(context, config, callbacks) {
      networkLoads++;
      callbacks.onSuccess({ data: bytes() }, {}, context, null);
    }
  }
  const Loader = createPrefetchLoaderClass(NetworkLoader);
  const load = () => new Promise(resolve => new Loader({}).load({ url }, {}, { onSuccess: resolve }));
  setSegment(url, bytes());
  for (let i = 0; i < 3; i++) {
    const { data } = await load();
    assert.deepEqual([...new Uint8Array(data)], [1, 2, 3, 4]);
    structuredClone(data, { transfer: [data] });
  }
  assert.equal(networkLoads, 0);
  clearSegmentCache();
  setSegment(url, new ArrayBuffer(0));
  assert.equal((await load()).data.byteLength, 4);
  assert.equal(networkLoads, 1);
});
