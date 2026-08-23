/**
 * Differential Analysis — legacy path vs Core path
 *
 * ORIGINAL PURPOSE (Slice 1B):
 *   Establish whether the HB-2 failure (PLAY A → PAUSE ends PLAYING) was a
 *   regression introduced by PlaybackCore or pre-existing legacy behaviour.
 *   Answer: pre-existing. Both paths produced byte-identical wrong results.
 *
 * PURPOSE NOW (Slice 1C):
 *   The same comparison is the proof that desired-state convergence WORKS. The
 *   legacy path still exhibits the defect — nothing about it changed — while the
 *   Core path now converges to the user's actual intent. The divergence between
 *   the two columns is the deliverable.
 */

import "./dom-shim.mjs";
import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { installFakeMediaLayer, resetRuntimeRefs, settleSystem, Transport } from "./fake-media-layer.mjs";
import { buildWiredCore } from "@/lib/playback-core/production/wireProductionCore";
import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";

const { runtime, gesture } = installFakeMediaLayer();
const A = { id: "track-a", slug: "track-a", title: "Track A" };

/**
 * Wait for full system quiescence. The argument is ignored — settlement is
 * detected via engine idleness + physical stability, not timed.
 */
async function settle() {
  await settleSystem(core, runtime);
}

let core = null;
function newCore(loggerEnabled = false) {
  core?.destroy();
  core = buildWiredCore({ loggerEnabled, probe: runtime.probe() });
  return core;
}

beforeEach(() => {
  core?.destroy();
  core = null;
  runtime.reset();
  resetRuntimeRefs();
  gesture.initWebAudioCalls = 0;
});

after(() => { core?.destroy(); });

describe("DIFF-1 — PLAY A → PAUSE: legacy defect vs Core correction", () => {
  test("DIFF-1.1 LEGACY path still ends PLAYING (defect unchanged, as expected)", async () => {
    dispatchPlaybackCommand("PLAY_TRACK", { track: A, options: {} });
    dispatchPlaybackCommand("PAUSE", {});
    await settle();

    console.log("\n  [DIFF-1.1] LEGACY-ONLY:", JSON.stringify(runtime.snapshot()),
      "\n             order:", runtime.log.map((e) => e.h).join(" → "));

    assert.equal(runtime.transport, Transport.PLAYING,
      "The legacy path is untouched by Slice 1C and must still show the original " +
      "defect. If this ever passes as PAUSED, the legacy pipeline was modified.");
  });

  test("DIFF-1.2 CORE path converges to PAUSED (the Slice 1C fix)", async () => {
    const c = newCore();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.pause();
    await settle();

    console.log("\n  [DIFF-1.2] CORE-PATH  :", JSON.stringify(runtime.snapshot()),
      "\n             order:", runtime.log.map((e) => e.h).join(" → "),
      "\n             desired:", JSON.stringify(c.desiredState));

    assert.equal(runtime.mediaIdentity, "track-a", "media identity inherited by PAUSE");
    assert.equal(runtime.transport, Transport.PAUSED,
      "Convergence must correct the post-load PLAYING back to the desired PAUSED.");
  });

  test("DIFF-1.3 the two paths now DIVERGE — that divergence is the fix", async () => {
    dispatchPlaybackCommand("PLAY_TRACK", { track: A, options: {} });
    dispatchPlaybackCommand("PAUSE", {});
    await settle();
    const legacy = runtime.snapshot();

    runtime.reset();
    resetRuntimeRefs();
    const c = newCore();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.pause();
    await settle();
    const withCore = runtime.snapshot();

    console.log(`\n  [DIFF-1.3] legacy=${legacy.transport}  core=${withCore.transport}`);
    assert.notEqual(legacy.transport, withCore.transport,
      "Slice 1B recorded these as identical. Slice 1C must make them differ.");
    assert.equal(withCore.transport, Transport.PAUSED);
  });
});

describe("DIFF-2 — Where authority is actually enforced", () => {
  test("DIFF-2.1 the superseded PLAY still loads its media (preparation is allowed)", async () => {
    const c = newCore();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.seek({ positionSeconds: 92 });
    await settle();

    const order = runtime.log.map((e) => e.h);
    console.log("\n  [DIFF-2.1] order:", order.join(" → "),
      "\n             final:", JSON.stringify(runtime.snapshot()));

    assert.ok(order.includes("playTrack"),
      "A stale operation may still perform harmless PREPARATION work. What it may " +
      "not do is produce an effect inconsistent with the latest desired state.");
    assert.equal(runtime.mediaIdentity, "track-a");
    assert.equal(runtime.position, 92);
  });

  test("DIFF-2.2 desired revision advances once per in-scope intent", async () => {
    const c = newCore(true);
    const revs = [];
    c.logger.subscribe((e) => { if (e.type === "DESIRED_STATE_REVISED") revs.push(e); });

    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.pause();
    c.port.resume();
    await settle();

    console.log("\n  [DIFF-2.2] revisions:", revs.map((r) => `${r.commandType}@${r.revision}`).join(" "));
    assert.deepEqual(revs.map((r) => r.revision), [1, 2, 3],
      "desiredRevision is monotonic and advances exactly once per in-scope intent.");
  });

  test("DIFF-2.3 out-of-scope intents do NOT advance the desired revision", async () => {
    const c = newCore();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    const before = c.desiredState.revision;
    c.port.next();
    c.port.previous();
    c.port.setQueue({ queueEntries: [A], queueIndex: 0 });
    await settle();

    assert.equal(c.desiredState.revision, before,
      "Out-of-scope commands imply no desired-state change and therefore no " +
      "convergence work.");
  });
});

describe("DIFF-3 — Ordering and the emergency lane", () => {
  test("DIFF-3.1 PLAY→SEEK ordering preserved under load latency", async () => {
    const c = newCore();
    runtime.loadLatencyMs = 40;
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.seek({ positionSeconds: 92 });
    await settle(300);

    const order = runtime.log.map((e) => e.h);
    console.log("\n  [DIFF-3.1] order:", order.join(" → "),
      "\n             final:", JSON.stringify(runtime.snapshot()));

    assert.equal(runtime.mediaIdentity, "track-a");
    assert.equal(runtime.position, 92);
  });

  test("DIFF-3.2 emergency PAUSE lands early AND survives the later load", async () => {
    const c = newCore();
    runtime.loadLatencyMs = 120;
    const t0 = Date.now();
    c.port.play({ trackId: A.id, queueEntries: [A], queueIndex: 0 });
    c.port.pause();

    // The emergency lane must land the pause well before the 120ms load resolves.
    const deadline = Date.now() + 100;
    while (Date.now() < deadline && !runtime.log.some((e) => e.h === "pause")) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const pauseAt = Date.now() - t0;
    assert.ok(runtime.log.some((e) => e.h === "pause"),
      "emergency PAUSE must not wait for the load");

    await settle(400);
    console.log(`\n  [DIFF-3.2] pause landed at ~${pauseAt}ms; ` +
      `order: ${runtime.log.map((e) => e.h).join(" → ")}` +
      `\n             final: ${JSON.stringify(runtime.snapshot())}`);

    assert.equal(runtime.transport, Transport.PAUSED,
      "After the load completes and sets PLAYING, convergence must restore PAUSED.");
    assert.equal(runtime.mediaIdentity, "track-a");
  });
});
