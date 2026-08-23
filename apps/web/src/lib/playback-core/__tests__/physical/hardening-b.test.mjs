/**
 * HARDENING-B — Physical Certification Suite (Slice 1B)
 *
 * Run:
 *   node --experimental-loader ./alias-loader.mjs --test hardening-b.test.mjs
 *
 * This suite asserts PHYSICAL OUTCOMES, not command delivery. Every assertion is
 * of the form "what track is loaded and where is the playhead", never "was a
 * command dispatched".
 *
 * Real: dispatchPlaybackCommand, serial queue, emergency bypass, watchdog,
 *       executePlaybackCommand, PlaybackCore, AuthorityGate, PlaybackCoreAdapter,
 *       wireProductionCore.
 * Fake: the leaf handler bag only (stands in for PSM/WebAudioEngine/HLS/<audio>).
 */

import "./dom-shim.mjs";
import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installFakeMediaLayer, resetRuntimeRefs, settleSystem, Transport } from "./fake-media-layer.mjs";
import { buildWiredCore } from "@/lib/playback-core/production/wireProductionCore";
import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";

const { runtime, gesture } = installFakeMediaLayer();

/**
 * Wait for full system quiescence: serial queue drained, no dispatch in flight,
 * no convergence pass running, physical snapshot stable. The argument is ignored
 * — settlement is detected, not timed.
 */
async function settle() {
  await settleSystem(core, runtime);
}

const A = { id: "track-a", slug: "track-a", title: "Track A" };
const B = { id: "track-b", slug: "track-b", title: "Track B" };
const X = { id: "track-x", slug: "track-x", title: "Track X (pre-existing)" };

let core;

beforeEach(() => {
  // Dispose the previous Core FIRST. A live ConvergenceEngine from the last test
  // would keep reconciling the shared runtime toward its own stale desired state.
  core?.destroy();
  runtime.reset();
  resetRuntimeRefs();
  gesture.initWebAudioCalls = 0;
  core = buildWiredCore({ loggerEnabled: false, probe: runtime.probe() });
});

// ─────────────────────────────────────────────────────────────────────────────
// HB-1 — The decisive case: PLAY A → SEEK 92
// ─────────────────────────────────────────────────────────────────────────────

describe("HARDENING-B/1 — PLAY A → SEEK 92 (physical)", () => {
  test("HB-1.1 from idle: expect A @ 92", async () => {
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    core.port.seek({ positionSeconds: 92 });
    await settle(50);

    assert.equal(runtime.mediaIdentity, "track-a",
      `PHYSICAL FAILURE: expected track-a loaded, got ${runtime.mediaIdentity}. ` +
      `Handler log: ${JSON.stringify(runtime.log)}`);
    assert.equal(runtime.position, 92,
      `PHYSICAL FAILURE: expected position 92, got ${runtime.position}`);
  });

  test("HB-1.2 with Track X already loaded: expect A @ 92, NOT X @ 92", async () => {
    // Simulate the real-world precondition: something is already playing.
    runtime.primeLoaded("track-x", 10, Transport.PLAYING);

    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    core.port.seek({ positionSeconds: 92 });
    await settle(50);

    assert.notEqual(runtime.mediaIdentity, "track-x",
      `PHYSICAL FAILURE: SEEK landed on the PREVIOUS track. ` +
      `mediaIdentity=${runtime.mediaIdentity} position=${runtime.position}. ` +
      `The user asked for A@92 and got X@${runtime.position}. ` +
      `Handler log: ${JSON.stringify(runtime.log)}`);
    assert.equal(runtime.mediaIdentity, "track-a");
    assert.equal(runtime.position, 92);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HB-2 — PLAY A → PAUSE
// ─────────────────────────────────────────────────────────────────────────────

describe("HARDENING-B/2 — PLAY A → PAUSE (physical)", () => {
  test("HB-2.1 expect A selected, transport PAUSED", async () => {
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    core.port.pause();
    await settle(50);

    assert.equal(runtime.mediaIdentity, "track-a",
      `PHYSICAL FAILURE: expected track-a prepared, got ${runtime.mediaIdentity}. ` +
      `Handler log: ${JSON.stringify(runtime.log)}`);
    assert.equal(runtime.transport, Transport.PAUSED,
      `PHYSICAL FAILURE: expected PAUSED, got ${runtime.transport}`);
  });

  test("HB-2.2 with Track X loaded: must not leave X selected", async () => {
    runtime.primeLoaded("track-x", 10, Transport.PLAYING);
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    core.port.pause();
    await settle(50);

    assert.equal(runtime.mediaIdentity, "track-a",
      `PHYSICAL FAILURE: PAUSE erased the track selection inherited from PLAY A. ` +
      `mediaIdentity=${runtime.mediaIdentity}. Handler log: ${JSON.stringify(runtime.log)}`);
    assert.equal(runtime.transport, Transport.PAUSED);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HB-3 — PLAY A → PAUSE → RESUME
// ─────────────────────────────────────────────────────────────────────────────

describe("HARDENING-B/3 — PLAY A → PAUSE → RESUME (physical)", () => {
  test("HB-3.1 expect A, transport PLAYING", async () => {
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    core.port.pause();
    core.port.resume();
    await settle(50);

    assert.equal(runtime.mediaIdentity, "track-a",
      `PHYSICAL FAILURE: expected track-a, got ${runtime.mediaIdentity}. ` +
      `Handler log: ${JSON.stringify(runtime.log)}`);
    assert.equal(runtime.transport, Transport.PLAYING,
      `PHYSICAL FAILURE: expected PLAYING, got ${runtime.transport}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HB-4 — PLAY A → PLAY B → SEEK 45
// ─────────────────────────────────────────────────────────────────────────────

describe("HARDENING-B/4 — PLAY A → PLAY B → SEEK 45 (physical)", () => {
  test("HB-4.1 expect B @ 45 — not A @ 45, not old @ 45", async () => {
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    core.port.play({ trackId: B.id, queueEntries: [B], queueIndex: 0 });
    core.port.seek({ positionSeconds: 45 });
    await settle(50);

    assert.equal(runtime.mediaIdentity, "track-b",
      `PHYSICAL FAILURE: expected track-b, got ${runtime.mediaIdentity}. ` +
      `Handler log: ${JSON.stringify(runtime.log)}`);
    assert.equal(runtime.position, 45,
      `PHYSICAL FAILURE: expected position 45, got ${runtime.position}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HB-5 — Emergency PAUSE must not queue behind a stalled PLAY
// ─────────────────────────────────────────────────────────────────────────────

describe("HARDENING-B/5 — Emergency PAUSE bypass (physical)", () => {
  test("HB-5.1 PAUSE during a 5s stalled PLAY completes immediately", async () => {
    runtime.loadLatencyMs = 5000;

    const t0 = Date.now();
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    await new Promise((r) => setTimeout(r, 100));
    core.port.pause();

    // Poll for the pause handler landing, up to 1s. If the emergency lane were
    // broken, PAUSE would sit behind the 5s stream load and never appear here.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && !runtime.log.some((e) => e.h === "pause")) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const elapsed = Date.now() - t0;

    assert.ok(runtime.log.some((e) => e.h === "pause"),
      `PHYSICAL FAILURE: PAUSE never reached the media layer within 1s while a ` +
      `5s PLAY was in flight. The emergency bypass lane is broken. ` +
      `Handler log: ${JSON.stringify(runtime.log)}`);
    assert.ok(elapsed < 1500,
      `PHYSICAL FAILURE: PAUSE took ${elapsed}ms — it queued behind the stalled PLAY.`);
  });

  test("HB-5.2 PAUSE during an indefinitely stalled PLAY still lands", async () => {
    runtime.stallLoad = true;

    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    await new Promise((r) => setTimeout(r, 50));
    core.port.pause();

    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && !runtime.log.some((e) => e.h === "pause")) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const landed = runtime.log.some((e) => e.h === "pause");
    runtime.releaseStall(); // don't leave the real 35s stream watchdog armed

    assert.ok(landed,
      `PHYSICAL FAILURE: PAUSE blocked behind a permanently stalled stream load. ` +
      `Handler log: ${JSON.stringify(runtime.log)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HB-6 — iOS gesture preservation
// ─────────────────────────────────────────────────────────────────────────────

describe("HARDENING-B/6 — iOS gesture-time unlock (physical)", () => {
  test("HB-6.1 initWebAudio runs SYNCHRONOUSLY inside port.play(), before any await", () => {
    const before = gesture.initWebAudioCalls;
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    // No await between the call and this assertion — if the Core path introduced
    // a microtask hop or dynamic import, this counter would still be at `before`
    // and iOS Safari would have dropped the activation token.
    assert.equal(gesture.initWebAudioCalls, before + 1,
      "PHYSICAL FAILURE: initWebAudio did not run synchronously within port.play(). " +
      "An await/microtask hop was introduced between the gesture and " +
      "dispatchPlaybackCommand — iOS Safari will refuse playback.");
  });

  test("HB-6.2 RESUME also unlocks synchronously (gesture command)", () => {
    const before = gesture.initWebAudioCalls;
    core.port.resume();
    assert.equal(gesture.initWebAudioCalls, before + 1,
      "PHYSICAL FAILURE: RESUME did not perform gesture-time unlock synchronously.");
  });

  test("HB-6.3 Core path unlock parity with direct legacy dispatch", () => {
    const beforeCore = gesture.initWebAudioCalls;
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    const coreDelta = gesture.initWebAudioCalls - beforeCore;

    const beforeLegacy = gesture.initWebAudioCalls;
    dispatchPlaybackCommand("PLAY_TRACK", { track: A, options: {} });
    const legacyDelta = gesture.initWebAudioCalls - beforeLegacy;

    assert.equal(coreDelta, legacyDelta,
      "PHYSICAL FAILURE: the Core path and the direct legacy path perform a " +
      "different number of synchronous gesture unlocks. Core must be transparent here.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HB-7 — Production scope containment
// ─────────────────────────────────────────────────────────────────────────────

describe("HARDENING-B/7 — Slice 1B production scope containment", () => {
  test("HB-7.1 NEXT does not reach the media layer through Core", async () => {
    core.port.next();
    await settle(30);
    assert.ok(!runtime.log.some((e) => e.h === "playNext"),
      "SCOPE VIOLATION: NEXT was routed live through Core. It is reserved for " +
      "the Selection Domain migration.");
  });

  test("HB-7.2 PREVIOUS does not reach the media layer through Core", async () => {
    core.port.previous();
    await settle(30);
    assert.ok(!runtime.log.some((e) => e.h === "playPrev"),
      "SCOPE VIOLATION: PREVIOUS was routed live through Core.");
  });

  test("HB-7.3 SET_QUEUE does not reach the media layer through Core", async () => {
    core.port.setQueue({ queueEntries: [A, B], queueIndex: 0 });
    await settle(30);
    assert.ok(!runtime.log.some((e) => e.h === "playQueue" || e.h === "setQueue"),
      "SCOPE VIOLATION: SET_QUEUE was routed live through Core.");
  });

  test("HB-7.4 in-scope commands still reach the media layer", async () => {
    core.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    await settle(30);
    assert.ok(runtime.log.some((e) => e.h === "playTrack"),
      "PLAY must remain live in Slice 1B scope.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HB-8 — Legacy path regression (Core must not degrade direct dispatch)
// ─────────────────────────────────────────────────────────────────────────────

describe("HARDENING-B/8 — Legacy direct-dispatch regression", () => {
  test("HB-8.1 direct dispatchPlaybackCommand still plays a track", async () => {
    await dispatchPlaybackCommand("PLAY_TRACK", { track: A, options: {} });
    await settle(30);
    assert.equal(runtime.mediaIdentity, "track-a");
    assert.equal(runtime.transport, Transport.PLAYING);
  });

  test("HB-8.2 direct SEEK uses payload.time and still applies", async () => {
    await dispatchPlaybackCommand("PLAY_TRACK", { track: A, options: {} });
    await dispatchPlaybackCommand("SEEK", { time: 33 });
    await settle(30);
    assert.equal(runtime.position, 33);
  });

  test("HB-8.3 legacy NEXT_TRACK is unaffected by Core scope gate", async () => {
    await dispatchPlaybackCommand("NEXT_TRACK", {});
    await settle(30);
    assert.ok(runtime.log.some((e) => e.h === "playNext"),
      "REGRESSION: the Core scope gate must not restrict the legacy path.");
  });
});
