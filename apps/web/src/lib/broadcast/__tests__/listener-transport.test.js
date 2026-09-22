import test from 'node:test';
import assert from 'node:assert/strict';
import { BroadcastListenerTransport } from '../listener-transport.js';

function fixture() {
  let now = 10000;
  const audio = [];
  const timers = new Map();
  let timerId = 0;
  class Audio extends EventTarget {
    constructor() { super(); this.paused = true; this.readyState = 4; this.currentTime = 0; this.playCalls = 0; this.pauseCalls = 0; }
    play() { this.playCalls++; this.paused = false; return this.pendingPlay || Promise.resolve(); }
    pause() { this.pauseCalls++; this.paused = true; }
  }
  const session = { id: 'session', sequence: 1, state: 'TRACK_PLAYBACK', isPlaying: true,
    currentItemId: 'a', mediaPosition: 0, effectiveAt: 10000, musicGain: 1,
    items: ['a', 'b'].map((id, position) => ({ id, position, durationSeconds: 100 })) };
  const owner = new BroadcastListenerTransport({
    createAudio: () => { const el = new Audio(); audio.push(el); return el; },
    focus: { acquire: async () => async () => {} },
    fetcher: async () => ({ ok: true, json: async () => ({ session, serverTime: now }) }),
    monotonicNow: () => now,
    timers: { setInterval: (fn) => { timers.set(++timerId, fn); return timerId; }, clearInterval: (id) => timers.delete(id) },
  });
  return { owner, session, audio, timers, time: (value) => { now = value; } };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('future authoritative start remains silent until its effective time', async () => {
  const f = fixture(); f.session.effectiveAt = 12000;
  await f.owner.prepare('session'); await f.owner.enter('session');
  assert.equal(f.owner.active.audio.paused, true);
  assert.equal(f.owner.active.audio.muted, true);
  f.time(12000); f.owner.synchronize(); await flush();
  assert.equal(f.owner.active.audio.paused, false);
  assert.equal(f.owner.active.audio.muted, false);
  await f.owner.leave();
});

test('stale play settlement cannot pause a reused deck in a new listening epoch', async () => {
  const f = fixture(); await f.owner.prepare('session');
  const deck = f.owner.active;
  let settle;
  deck.audio.pendingPlay = new Promise((resolve) => { settle = resolve; });
  f.owner.publish({ listening: true }); f.owner.synchronize();
  await f.owner.leave({ resumePersonal: false });
  deck.audio.pendingPlay = null;
  f.owner.publish({ listening: true }); f.owner.synchronize();
  settle(); await flush();
  assert.equal(deck.audio.paused, false);
  assert.equal(deck.audio.muted, false);
  await f.owner.leave();
});

test('preparation and view subscriptions do not acquire personal audio focus', async () => {
  const f = fixture(); let acquired = 0;
  f.owner.focus.acquire = async () => { acquired++; return async () => {}; };
  await f.owner.prepare('session');
  const unsub = f.owner.subscribe(() => {}); unsub();
  assert.equal(acquired, 0); assert.equal(f.audio.length, 2);
  assert.equal(f.audio.every((a) => a.paused && a.muted), true);
});

test('duplicate snapshots retain media elements, source and playback position', async () => {
  const f = fixture(); await f.owner.prepare('session'); await f.owner.enter('session');
  const deck = f.owner.active; deck.audio.currentTime = 12;
  const source = deck.audio.src; const pauses = deck.audio.pauseCalls;
  await f.owner.refresh();
  assert.equal(f.owner.active, deck); assert.equal(deck.audio.src, source);
  assert.equal(deck.audio.currentTime, 12); assert.equal(deck.audio.pauseCalls, pauses);
  assert.equal(f.audio.length, 2);
  await f.owner.leave(); assert.equal(f.timers.size, 0);
});

test('authorization revocation stops both decks and releases focus without resuming personal music', async () => {
  const f = fixture(); const releases = [];
  f.owner.focus.acquire = async () => async (options) => releases.push(options);
  await f.owner.prepare('session'); await f.owner.enter('session');
  f.owner.fetcher = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await f.owner.refresh();
  assert.equal(f.owner.state.listening, false);
  assert.equal(f.audio.every((a) => a.paused && a.muted), true);
  assert.deepEqual(releases, [{ resumePersonal: false }]);
  assert.equal(f.timers.size, 0);
});

test('session end stops transport without recreating media or resuming personal audio', async () => {
  const f = fixture(); await f.owner.prepare('session'); await f.owner.enter('session');
  f.owner.accept({ ...f.session, sequence: 2, state: 'ENDED', isPlaying: false });
  await flush();
  assert.equal(f.owner.state.phase, 'ended'); assert.equal(f.owner.state.listening, false);
  assert.equal(f.audio.length, 2); assert.equal(f.timers.size, 0);
  assert.equal(f.audio.every((a) => a.paused && a.muted), true);
});

test('late snapshot response after leave cannot restart playback', async () => {
  const f = fixture(); await f.owner.prepare('session'); await f.owner.enter('session');
  let resolve;
  f.owner.fetcher = () => new Promise((done) => { resolve = done; });
  const request = f.owner.refresh();
  await f.owner.leave();
  resolve({ ok: true, json: async () => ({ session: { ...f.session, sequence: 2 }, serverTime: 10000 }) });
  await request;
  assert.equal(f.owner.state.listening, false);
  assert.equal(f.audio.every((a) => a.paused && a.muted), true);
  assert.equal(f.owner.state.session.sequence, 1);
});
