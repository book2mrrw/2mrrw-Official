/**
 * GEOMETRY ISOLATION — Physical Certification Suite
 *
 * Run:
 *   node --experimental-loader ./alias-loader.mjs --test geometry-isolation.test.mjs
 *
 * PURPOSE: prove, against the real production singleton (not a description of it),
 * that the audio engine runtime and its <audio> element are stable under repeated
 * re-entry — the exact channel through which a rotation/fold-driven re-render
 * WOULD interrupt playback, if AudioProvider ever depended on viewport/orientation
 * state. Today nothing calls these entrypoints from a resize/orientation listener
 * (see adaptive-playback-continuity.test.js), so this suite calls them directly,
 * many times, standing in for "AudioProvider re-rendered on every geometry tick",
 * and asserts identity + in-flight playback are untouched.
 *
 * Real: getAudioEngineRuntime, ensureDetachedAudioElement, dispatchPlaybackCommand,
 *       the serial command queue. Fake: only the leaf handler bag (fake-media-layer),
 *       same as the rest of this physical suite.
 */

import "./dom-shim.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { installFakeMediaLayer, resetRuntimeRefs, settleSystem } from "./fake-media-layer.mjs";
import { dispatchPlaybackCommand } from "@/lib/playback/command-dispatcher";
import {
  getAudioEngineRuntime,
  ensureDetachedAudioElement,
} from "@/lib/playback/audio-engine-runtime";

const { runtime } = installFakeMediaLayer();
const A = { id: "track-a", slug: "track-a", title: "Track A" };

async function settle() {
  await settleSystem(null, runtime);
}

beforeEach(() => {
  runtime.reset();
  resetRuntimeRefs();
});

test("GEO-1 repeated singleton re-entry never changes runtime/audio-element identity or disturbs in-flight playback", async () => {
  dispatchPlaybackCommand("PLAY_TRACK", { track: A, options: {} });
  await settle();

  const before = runtime.snapshot();
  const logLengthBefore = runtime.log.length;
  const engineBefore = getAudioEngineRuntime();
  const audioBefore = ensureDetachedAudioElement();

  // Stand in for 50 geometry ticks during a physical fold/rotation transition
  // (foldables can emit several resize/orientation events per transition).
  for (let i = 0; i < 50; i += 1) {
    const engine = getAudioEngineRuntime();
    const audio = ensureDetachedAudioElement();
    assert.equal(engine, engineBefore, `runtime identity changed on re-entry ${i}`);
    assert.equal(audio, audioBefore, `<audio> element identity changed on re-entry ${i}`);
  }

  await settle();

  assert.deepEqual(
    runtime.snapshot(),
    before,
    "playback state (track/position/transport) must be untouched by geometry re-entry"
  );
  assert.equal(
    runtime.log.length,
    logLengthBefore,
    "no new physical media command may fire as a side effect of geometry re-entry"
  );
});

test("GEO-2 the detached <audio> element is created at most once per tab, never duplicated", () => {
  let created = 0;
  const originalCreateElement = globalThis.document.createElement;
  globalThis.document.createElement = (tag) => {
    if (tag === "audio") created += 1;
    return originalCreateElement(tag);
  };

  try {
    const first = ensureDetachedAudioElement();
    // 20 calls stand in for 20 geometry-driven re-renders of AudioProvider. Whether
    // the element already existed from an earlier test or is created here for the
    // first time, only ONE of these 21 calls may ever construct a new node.
    for (let i = 0; i < 20; i += 1) {
      const again = ensureDetachedAudioElement();
      assert.equal(again, first, "ensureDetachedAudioElement must return the same node every time");
    }
  } finally {
    globalThis.document.createElement = originalCreateElement;
  }

  assert.ok(created <= 1, `expected at most one <audio> element to be created, saw ${created}`);
});
