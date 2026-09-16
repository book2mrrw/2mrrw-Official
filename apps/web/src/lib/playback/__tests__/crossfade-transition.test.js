import assert from 'node:assert/strict';
import test from 'node:test';
import { CrossfadeTransition, eligiblePair, fadeCurves } from '../crossfade/transition.js';

const track = (id, source = 'playlist') => ({ id, src: `/${id}.mp3`, source, metadata: { access: { canStream: true } } });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(overrides = {}) {
  const state = { key: 'queue:0', track: track('a'), next: track('b'), playing: true,
    blocked: false, canPrepare: true, remaining: 10, ...overrides };
  const calls = { prepare: 0, request: [], release: 0, snapshot: 0 };
  const deck = { ready: () => true, prime: async () => true };
  const owner = new CrossfadeTransition({
    snapshot: () => { calls.snapshot++; return state; },
    prepare: async () => { calls.prepare++; return deck; },
    request: (candidate) => { calls.request.push(candidate); return true; },
    release: () => calls.release++,
  });
  return { owner, calls, state, deck };
}

test('off does no queue inspection, preparation, or playback', async () => {
  const h = harness();
  for (let i = 0; i < 100; i++) h.owner.tick();
  await settle();
  assert.deepEqual(h.calls, { prepare: 0, request: [], release: 0, snapshot: 0 });
});
test('on prepares one next track and requests it exactly once at the overlap boundary', async () => {
  const h = harness(); h.owner.setEnabled(true);
  for (let i = 0; i < 100; i++) h.owner.tick();
  await settle();
  assert.equal(h.calls.prepare, 1); assert.equal(h.calls.request.length, 0);
  h.state.remaining = 4;
  for (let i = 0; i < 100; i++) h.owner.tick();
  await settle();
  assert.equal(h.calls.request.length, 1);
  const candidate = h.calls.request[0];
  assert.equal(h.owner.take(candidate.token, h.state.next), candidate);
  assert.equal(h.owner.take(candidate.token, h.state.next), null);
  h.owner.tick(); await settle();
  assert.equal(h.calls.prepare, 1);
});
for (const [name, change] of [
  ['pause', { playing: false }], ['sleep/repeat-one/CS/interruption', { blocked: true }],
  ['natural end', { remaining: 0 }], ['queue reorder or account change', { key: 'queue:changed' }],
]) {
  test(`${name} cancels prepared work without requesting a successor`, async () => {
    const h = harness(); h.owner.setEnabled(true); h.owner.tick(); await settle();
    Object.assign(h.state, change, { canPrepare: false });
    h.owner.tick(); await settle();
    assert.equal(h.calls.request.length, 0); assert.equal(h.calls.release, 1);
  });
}
test('an aborted preparation resolving late releases only its own result', async () => {
  const h = harness(); let resolve;
  h.owner.prepare = () => new Promise((r) => { resolve = r; });
  h.owner.setEnabled(true); h.owner.tick(); await settle();
  h.owner.setEnabled(false); resolve(h.deck); await settle();
  assert.equal(h.owner.candidate, null); assert.equal(h.calls.release, 1);
  assert.equal(h.calls.request.length, 0);
});
test('rejected silent play does not submit a playback intent or retry every tick', async () => {
  const h = harness({ remaining: 4 }); h.deck.prime = async () => { throw Error('NotAllowedError'); };
  h.owner.setEnabled(true); h.owner.tick(); await settle();
  h.owner.tick(); await settle();
  assert.equal(h.calls.request.length, 0); assert.equal(h.calls.prepare, 1);
});
test('a user action while silent play is pending invalidates that request', async () => {
  const h = harness({ remaining: 4 }); let resolve;
  h.deck.prime = () => new Promise((r) => { resolve = r; });
  h.owner.setEnabled(true); h.owner.tick(); await settle();
  h.owner.cancel(); resolve(true); await settle();
  assert.equal(h.calls.request.length, 0);
});
test('unready target or wrong token cannot be adopted', async () => {
  const h = harness({ remaining: 4 }); h.owner.setEnabled(true); h.owner.tick(); await settle();
  const { token } = h.calls.request[0];
  assert.equal(h.owner.take(token + 1, h.state.next), null);
  assert.equal(h.owner.take(token, track('other')), null);
  h.deck.ready = () => false;
  assert.equal(h.owner.take(token, h.state.next), null);
});
test('weak-network budget defers preparation without consuming the attempt', async () => {
  const h = harness({ canPrepare: false }); h.owner.setEnabled(true); h.owner.tick(); await settle();
  assert.equal(h.calls.prepare, 0);
  h.state.canPrepare = true; h.owner.tick(); await settle(); assert.equal(h.calls.prepare, 1);
});
test('preview, singles, same-track repetition, and exhausted queues keep ordinary completion', () => {
  const { state } = harness();
  for (const next of [null, state.track, track('single', 'single_card'),
    { ...track('preview'), metadata: { access: { canStream: true, previewOnly: true } } }]) {
    assert.equal(eligiblePair({ ...state, next }), false);
  }
  assert.equal(eligiblePair({ ...state, track: track('single', 'single_card') }), false);
});
test('album and mixtape tracks use the same contract as playlists', () => {
  const { state } = harness();
  const releaseTrack = (id) => ({ ...track(id, 'album_modal'), metadata: { albumSlug: 'album', access: { canStream: true } } });
  assert.equal(eligiblePair({ ...state, track: releaseTrack('a'), next: releaseTrack('b') }), true);
});
test('fade endpoints and midpoint maintain equal power at unity gain', () => {
  const { out, incoming } = fadeCurves();
  assert.equal(out[0], 1); assert.equal(incoming[0], 0);
  assert.equal(out[64], 0); assert.equal(incoming[64], 1);
  for (let i = 0; i < 65; i++) assert.ok(Math.abs(out[i] ** 2 + incoming[i] ** 2 - 1) < 1e-6);
  assert.equal(fadeCurves(0.5, 0.75).out[0], 0.5);
  assert.equal(fadeCurves(0.5, 0.75).incoming[64], 0.75);
});
