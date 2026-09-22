import test from "node:test";
import assert from "node:assert/strict";
import { applySessionCommand, SESSION_STATES } from "../session-model.js";

function draft() {
  return { id: "session", type: "listening_session", state: "DRAFT", sequence: 0,
    currentItemId: null, mediaPosition: 0, effectiveAt: 0, isPlaying: false,
    authorizationEpoch: 0, items: ["a", "b", "c", "d"].map((id, position) => ({
      id, trackId: `canonical-${id}`, position, prepared: true, excluded: false, completed: false, durationSeconds: 180,
    })) };
}
function command(session, type, payload = {}, time = 1000) {
  return applySessionCommand(session, { type, payload, expectedSequence: session.sequence }, time);
}
function playing() {
  return command(command(draft(), "GO_LIVE"), "START_TRACK", { itemId: "a" }, 2000);
}

test("full lifecycle preserves canonical identities and captures pause/resume timing", () => {
  let s = command(draft(), "SCHEDULE", { scheduledAt: 10000 });
  s = command(s, "PRE_SHOW");
  s = command(s, "CUE_TRACK", { itemId: "a" });
  s = command(s, "GO_LIVE");
  s = command(s, "START_TRACK", {}, 2000);
  s = command(s, "PAUSE_TRACK", {}, 42000);
  assert.equal(s.mediaPosition, 40);
  s = command(s, "RESUME_TRACK", {}, 52000);
  s = command(s, "START_COMMENTARY", {}, 62000);
  assert.equal(s.mediaPosition, 50);
  assert.equal(s.isPlaying, false);
  s = command(s, "END_COMMENTARY");
  s = command(s, "NEXT_TRACK");
  assert.equal(s.currentItemId, "b");
  assert.equal(s.items[0].completed, true);
  s = command(s, "END_TRACK");
  s = command(s, "INTERMISSION");
  s = command(s, "END_INTERMISSION");
  s = command(s, "FINALE");
  s = command(s, "AFTERSHOW");
  s = command(s, "END_SESSION");
  assert.equal(s.authorizationEpoch, 1);
  assert.equal(s.state, "ENDED");
  assert.deepEqual(s.items.map((item) => item.trackId), draft().items.map((item) => item.trackId));
  assert.throws(() => command(s, "GO_LIVE"), /immutable/);
});

test("live reorder changes upcoming order without changing active playback or input", () => {
  const before = playing();
  const original = structuredClone(before);
  const after = command(before, "REORDER_TRACKS", { itemIds: ["a", "d", "b", "c"] }, 30000);
  assert.deepEqual(before, original);
  for (const key of ["currentItemId", "mediaPosition", "effectiveAt", "isPlaying"]) assert.equal(after[key], before[key]);
  assert.equal(command(after, "NEXT_TRACK").currentItemId, "d");
  assert.throws(() => command(before, "REORDER_TRACKS", { itemIds: ["b", "a", "c", "d"] }), /cannot move/);
  assert.throws(() => command(before, "REORDER_TRACKS", { itemIds: ["a", "b", "b", "d"] }), /exactly once/);
  assert.throws(() => command(before, "REORDER_TRACKS", { itemIds: ["a", "b", "c", "unknown"] }), /does not belong/);
});

test("completed tracks cannot be resumed or started again", () => {
  const ended = command(playing(), "END_TRACK", {}, 4000);
  assert.throws(() => command(ended, "RESUME_TRACK"), /available/);
  assert.throws(() => command(ended, "START_TRACK", { itemId: "a" }), /available/);
});

test("nonmusic sessions can go live without a project; music sessions cannot", () => {
  assert.throws(() => command({ ...draft(), items: [] }, "GO_LIVE"), /track/);
  assert.throws(() => command({ ...draft(), items: draft().items.map((item) => ({ ...item, prepared: false })) }, "GO_LIVE"), /prepared/);
  assert.equal(command({ ...draft(), type: "interview", items: [] }, "GO_LIVE").state, "LIVE_INTRO");
});

test("stale commands, invalid transitions, and unknown tracks fail before mutation", () => {
  assert.throws(() => applySessionCommand(draft(), { type: "GO_LIVE", expectedSequence: 20 }, 1000), /reconcile/);
  assert.throws(() => command(draft(), "START_TRACK", { itemId: "a" }), /Go live/);
  assert.throws(() => command(playing(), "GO_LIVE"), /already started/);
  assert.throws(() => command(playing(), "CUE_TRACK", { itemId: "b" }), /Pause or end/);
  assert.throws(() => command(draft(), "CUE_TRACK", { itemId: "foreign" }), /unavailable/);
  assert.throws(() => command(playing(), "UPDATE_CONFIGURATION", { accessPolicy: "PUBLIC" }), /lock/);
  assert.throws(() => command(draft(), "UPDATE_CONFIGURATION", { accessPolicy: "EVERYONE" }), /Invalid/);
});

test("mixing cannot introduce unverified doubled music", () => {
  const before = playing();
  assert.throws(() => command(before, "SET_MIX", { musicGain: 0.2, videoPolicy: "artist" }), /music-free/);
  const ducked = command(before, "SET_MIX", { musicGain: 0.2, videoPolicy: "muted" });
  assert.equal(ducked.effectiveAt, before.effectiveAt);
  assert.equal(ducked.musicGain, 0.2);
  assert.throws(() => command(before, "SET_MIX", { musicGain: NaN, videoPolicy: "muted" }), /between/);
});

test("visual events never mutate audio timing or identity", () => {
  const before = playing();
  const after = command(before, "VISUAL_CUE", { cue: "VAULT_OPEN" }, 45000);
  for (const key of ["currentItemId", "mediaPosition", "effectiveAt", "isPlaying", "musicGain"]) assert.equal(after[key], before[key]);
  assert.equal(after.visualCue.effectiveAt, 45000);
});

test("termination is valid from every nonterminal state and blocks playback", () => {
  for (const state of SESSION_STATES.filter((state) => state !== "ENDED")) {
    const ended = command({ ...playing(), state }, "END_SESSION", {}, 10000);
    assert.equal(ended.state, "ENDED");
    assert.equal(ended.isPlaying, false);
    assert.equal(ended.videoPolicy, "muted");
    assert.equal(ended.authorizationEpoch, 1);
  }
});
