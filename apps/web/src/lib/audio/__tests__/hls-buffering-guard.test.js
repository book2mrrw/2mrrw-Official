import assert from "node:assert/strict";
import test from "node:test";

import { attachBufferingGuard } from "../hls-buffering-guard.js";

function fakeMedia(currentTime, ranges) {
  const media = new EventTarget();
  media.currentTime = currentTime;
  media.buffered = { length: ranges.length, start: (i) => ranges[i][0], end: (i) => ranges[i][1] };
  return media;
}

function fakeHls(bufferingEnabled) {
  return { bufferingEnabled, resumed: 0, resumeBuffering() { this.resumed += 1; this.bufferingEnabled = true; } };
}

test("a seek outside the buffer resumes paused buffering (the iOS scrub freeze)", () => {
  const hls = fakeHls(false);
  const media = fakeMedia(146.4, [[0, 36]]);
  attachBufferingGuard(hls, media);
  media.dispatchEvent(new Event("seeking"));
  assert.equal(hls.resumed, 1);
});

test("a stall at an unbuffered position resumes buffering too", () => {
  const hls = fakeHls(false);
  const media = fakeMedia(40, [[0, 36]]);
  attachBufferingGuard(hls, media);
  media.dispatchEvent(new Event("waiting"));
  assert.equal(hls.resumed, 1);
});

test("inside the buffer the platform's pause is respected", () => {
  const hls = fakeHls(false);
  const media = fakeMedia(12, [[0, 36]]);
  attachBufferingGuard(hls, media);
  media.dispatchEvent(new Event("seeking"));
  assert.equal(hls.resumed, 0);
});

test("nothing happens while buffering is already on, and detaching removes the guard", () => {
  const on = fakeHls(true);
  const media = fakeMedia(146.4, [[0, 36]]);
  attachBufferingGuard(on, media);
  media.dispatchEvent(new Event("seeking"));
  assert.equal(on.resumed, 0);

  const off = fakeHls(false);
  const other = fakeMedia(146.4, [[0, 36]]);
  const detach = attachBufferingGuard(off, other);
  detach();
  other.dispatchEvent(new Event("seeking"));
  assert.equal(off.resumed, 0);
});
