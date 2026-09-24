import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import Hls from 'hls.js';
import { createCacheAwareAbrController } from '../../audio/cache-aware-abr.js';
import { createPrefetchLoaderClass } from '../../audio/hls-prefetch-loader.js';
import { setSegment, clearSegmentCache } from '../../audio/hls-segment-cache.js';

const originalSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
before(() => Object.defineProperty(globalThis, 'self', {value:globalThis, configurable:true}));
after(() => { if (originalSelf) Object.defineProperty(globalThis, 'self', originalSelf); else delete globalThis.self; });

async function cachedStats() {
  clearSegmentCache();
  setSegment('cached', new ArrayBuffer(24000));
  const Loader = createPrefetchLoaderClass(Hls.DefaultConfig.loader);
  const loader = new Loader(Hls.DefaultConfig);
  const retained = loader.stats;
  const stats = await new Promise(resolve => loader.load({url:'cached'}, {}, {
    onSuccess: (_, stats) => resolve(stats),
  }));
  assert.equal(stats, retained, 'fragment loader retains this exact object before load');
  stats.parsing.end = stats.loading.start + 5;
  loader.destroy();
  return stats;
}

test('installed hls.js excludes cached measurements but retains ABR bookkeeping and network sampling', async () => {
  const hls = new Hls({abrController:createCacheAwareAbrController(Hls.DefaultConfig.abrController)});
  try {
    const abr = hls.abrController;
    const samples = [];
    const ttfb = [];
    abr.bwEstimator.sample = (...args) => samples.push(args);
    abr.bwEstimator.sampleTTFB = (...args) => ttfb.push(args);
    const frag = {type:'main',sn:1,level:0,duration:6,stats:await cachedStats()};
    abr._nextAutoLevel = 0;
    abr.onFragLoaded(Hls.Events.FRAG_LOADED,{frag});
    abr.onFragBuffered(Hls.Events.FRAG_BUFFERED,{frag});
    assert.equal(samples.length,0);
    assert.equal(ttfb.length,0);
    assert.equal(abr.lastLoadedFragLevel,0);
    assert.equal(abr._nextAutoLevel,-1);
    frag.bitrateTest = true;
    abr.onFragLoaded(Hls.Events.FRAG_LOADED,{frag});
    assert.equal(frag.bitrateTest,false);
    assert.equal(samples.length,0,'nested bitrate-test sampling is also excluded');
    frag.stats = {...frag.stats,loading:{start:0,first:100,end:2000},parsing:{end:2010}};
    abr.onFragLoaded(Hls.Events.FRAG_LOADED,{frag});
    abr.onFragBuffered(Hls.Events.FRAG_BUFFERED,{frag});
    assert.equal(samples.length,1);
    assert.equal(samples[0][1],24000);
    assert.deepEqual(ttfb,[[100]]);
  } finally { hls.destroy(); }
});

test('aborting or destroying before the cache microtask prevents late delivery', async () => {
  const Loader = createPrefetchLoaderClass(Hls.DefaultConfig.loader);
  for (const action of ['abort','destroy']) {
    setSegment('cancelled',new ArrayBuffer(10));
    const loader = new Loader(Hls.DefaultConfig);
    let delivered = false;
    loader.load({url:'cancelled'},{},{onSuccess:()=>{delivered=true;}});
    loader[action]();
    await Promise.resolve();
    assert.equal(delivered,false,action);
  }
});

test('an upstream exception cannot leave subsequent network measurement disabled', async () => {
  const stats = await cachedStats();
  const sample = () => {};
  const sampleTTFB = () => {};
  class ThrowingController {
    constructor() { this.bwEstimator = { sample, sampleTTFB }; }
    onFragLoaded() { throw new Error('upstream failure'); }
  }
  const Controller = createCacheAwareAbrController(ThrowingController);
  const controller = new Controller();
  assert.throws(() => controller.onFragLoaded('loaded',{frag:{stats}}), /upstream failure/);
  assert.equal(controller.bwEstimator.sample,sample);
  assert.equal(controller.bwEstimator.sampleTTFB,sampleTTFB);
});
