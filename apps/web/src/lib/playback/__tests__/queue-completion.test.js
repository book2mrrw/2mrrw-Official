import '../../playback-core/__tests__/physical/dom-shim.mjs';
import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { buildWiredCore } from '../../playback-core/production/wireProductionCore.js';
import { installFakeMediaLayer, resetRuntimeRefs, settleSystem, Transport } from '../../playback-core/__tests__/physical/fake-media-layer.mjs';
import { completeQueuePlayback } from '../queue-completion.js';

const { runtime } = installFakeMediaLayer();
let core;
const tracks = ['single-a', 'single-b'].map(id => ({ id, slug: id, src: `/${id}.mp3` }));
beforeEach(() => { runtime.reset(); resetRuntimeRefs(); core = buildWiredCore({ loggerEnabled: false, probe: runtime.probe() }); });
afterEach(() => core.destroy());

async function playLast() {
  core.port.play({ trackId: tracks[1].id, queueEntries: tracks, queueIndex: 1 });
  await settleSystem(core, runtime);
  runtime.transport = Transport.PAUSED; // the media element has naturally ended
}
test('negative control: physical pause alone allows Core to replay an ended song', async () => {
  await playLast();
  await core._executionEngine.converge('natural-end');
  await settleSystem(core, runtime);
  assert.equal(runtime.transport, Transport.PLAYING);
});
test('completed queue remains stopped across later Core reconciliation', async () => {
  await playLast();
  const plays = runtime.audibleCommitCount;
  assert.equal(completeQueuePlayback(core, tracks[1]), true);
  await settleSystem(core, runtime);
  await core._executionEngine.converge('natural-end');
  await settleSystem(core, runtime);
  assert.equal(runtime.transport, Transport.PAUSED);
  assert.equal(core.desiredState.desiredTransport, 'PAUSED');
  assert.equal(runtime.mediaIdentity, tracks[1].id);
  assert.equal(runtime.audibleCommitCount, plays);
});
test('stale completion cannot stop a newly selected track', async () => {
  await playLast();
  assert.equal(completeQueuePlayback(core, tracks[0]), false);
  assert.equal(core.desiredState.desiredTransport, 'PLAYING');
});
