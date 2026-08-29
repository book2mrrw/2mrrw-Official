import "./dom-shim.mjs";

import test from "node:test";
import assert from "node:assert/strict";
import { FakeAudioElement } from "./dom-shim.mjs";
import { WebAudioEngine } from "@/lib/audio/WebAudioEngine";
import { AUDIO_ENGINE_EVENTS as E } from "@/lib/audio/AudioEngineInterface";

test("physical DOM transport events are forwarded as generic engine observations", () => {
  const engine = new WebAudioEngine();
  const audio = new FakeAudioElement("https://media.example/track.mp3");
  audio.currentTime = 12;
  audio.duration = 180;
  audio.error = { code: 3, message: "decode" };

  const observed = [];
  const eventPairs = [
    ["play", E.PLAY],
    ["playing", E.BUFFERED],
    ["pause", E.PAUSE],
    ["waiting", E.BUFFERING],
    ["stalled", E.STALLED],
    ["seeking", E.SEEKING],
    ["seeked", E.SEEKED],
    ["ended", E.ENDED],
    ["error", E.ERROR],
  ];
  const unsubs = eventPairs.map(([, engineEvent]) =>
    engine.on(engineEvent, (payload) => observed.push({ engineEvent, payload })),
  );

  engine._attachAudioElementListeners(audio);
  for (const [domEvent] of eventPairs) audio.dispatchEvent({ type: domEvent });

  assert.deepEqual(observed.map((entry) => entry.engineEvent), eventPairs.map(([, event]) => event));
  assert.equal(observed.find((entry) => entry.engineEvent === E.PLAY).payload.currentTime, 12);
  assert.equal(observed.find((entry) => entry.engineEvent === E.SEEKED).payload.currentTime, 12);
  assert.equal(observed.find((entry) => entry.engineEvent === E.ERROR).payload.code, 3);

  for (const unsub of unsubs) unsub();
  engine._detachAudioElementListeners();
});
