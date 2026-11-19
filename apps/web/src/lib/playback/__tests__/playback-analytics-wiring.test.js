import test from "node:test";
import assert from "node:assert/strict";
import { recoveryFixture } from "./recovery-fixture.mjs";

// The real player handlers, driven like a browser would, with every analytics
// request captured. Proves what actually reaches /api/media/playback.

function capture(t) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes("/api/media/playback")) {
      const body = JSON.parse(init.body);
      for (const e of body.events || [body]) sent.push(e);
      return { status: 200, ok: true };
    }
    return { status: 200, ok: true, json: async () => ({}) };
  };
  t.after(() => { globalThis.fetch = realFetch; });
  return sent;
}

function startListen(t, { access = {}, duration = 180 } = {}) {
  const h = recoveryFixture(t);
  const sent = capture(t);
  Object.assign(h.track.metadata.access, access);
  h.audio.currentTime = 0;
  h.audio.duration = duration;
  h.audio.paused = false;
  const handlers = h.handlers();
  handlers.onPlay();
  // Step the clock like timeupdate does. Bounded: a handler that moved
  // currentTime backwards must fail the test, not hang it.
  const playTo = (seconds) => {
    let position = h.audio.currentTime;
    for (let guard = 0; position + 0.25 <= seconds; guard += 1) {
      if (guard > 4000) throw new Error(`playTo(${seconds}) stuck at ${h.audio.currentTime}`);
      position += 0.25;
      h.audio.currentTime = position;
      handlers.onTime();
    }
  };
  return { h, handlers, sent, playTo, types: () => sent.map((e) => e.eventType) };
}

test("a fresh listen sends a play carrying the album song's identity and a listen id", (t) => {
  const { sent } = startListen(t);
  const play = sent.find((e) => e.eventType === "play");
  assert.ok(play, "play event sent");
  assert.equal(play.releaseSlug, "album");
  assert.equal(play.trackSlug, "song-three");
  assert.match(play.listenId, /^[0-9a-f-]{36}$/);
  assert.match(play.eventId, /^[0-9a-f-]{36}$/);
});

test("30 seconds of listening sends exactly one qualified play, with the same listen id", (t) => {
  const { sent, playTo, types } = startListen(t);
  playTo(29);
  assert.ok(!types().includes("qualified"), "not before 30 s");
  playTo(90);
  const qualified = sent.filter((e) => e.eventType === "qualified");
  assert.equal(qualified.length, 1);
  assert.equal(qualified[0].listenId, sent.find((e) => e.eventType === "play").listenId);
  assert.ok(qualified[0].listenedSeconds >= 30);
});

test("dragging the scrubber past 30 s does not qualify the play", (t) => {
  const { h, handlers, playTo, types } = startListen(t);
  playTo(5);
  h.audio.currentTime = 120; // a scrub, not listening
  handlers.onTime();
  playTo(125);
  assert.ok(!types().includes("qualified"));
});

test("preview listening never sends a play or a qualified play", (t) => {
  const { playTo, types } = startListen(t, { access: { previewOnly: true } });
  playTo(40);
  assert.ok(!types().includes("play"));
  assert.ok(!types().includes("qualified"));
});

test("an admin listening past 30 s sends neither a play nor a qualified play (no preview cap stops it first)", (t) => {
  const { playTo, types } = startListen(t, { access: { admin: true } });
  playTo(60);
  assert.ok(!types().includes("play"));
  assert.ok(!types().includes("qualified"));
  assert.ok(types().includes("progress"), "the listen itself is still reported (the server flags it internal)");
});

test("a song shorter than 30 s qualifies when it plays to the end, before its complete", (t) => {
  const { h, handlers, playTo, types } = startListen(t, { duration: 20 });
  playTo(19.75);
  h.audio.currentTime = 20;
  h.audio.ended = true;
  handlers.onEnded();
  const order = types().filter((x) => x === "qualified" || x === "complete");
  assert.deepEqual(order, ["qualified", "complete"]);
});
