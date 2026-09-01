import assert from "node:assert/strict";
import test from "node:test";

import { createAudioMediaPriorityCoordinator } from "../audio-media-priority.js";

function createHarness() {
  const timers = new Map();
  let nextTimer = 0;
  const coordinator = createAudioMediaPriorityCoordinator({
    schedule(callback) {
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    },
    cancel(timer) {
      timers.delete(timer);
    },
  });
  return { coordinator, timers };
}

test("startup lease owns media priority until released", () => {
  const { coordinator } = createHarness();
  const lease = coordinator.beginStartup();
  assert.deepEqual(coordinator.getSnapshot(), {
    active: true,
    startupActive: true,
    playbackActive: false,
    generation: 1,
  });
  assert.equal(lease.release(), true);
  assert.equal(coordinator.getSnapshot().active, false);
});

test("superseded lease cannot release a newer startup", () => {
  const { coordinator } = createHarness();
  const first = coordinator.beginStartup();
  const second = coordinator.beginStartup();
  assert.equal(first.release(), false);
  assert.equal(coordinator.getSnapshot().active, true);
  assert.equal(second.release(), true);
  assert.equal(coordinator.getSnapshot().active, false);
});

test("playback authority survives startup lease release", () => {
  const { coordinator } = createHarness();
  const lease = coordinator.beginStartup();
  assert.equal(lease.promoteToPlayback(), true);
  lease.release();
  assert.deepEqual(coordinator.getSnapshot(), {
    active: true,
    startupActive: false,
    playbackActive: true,
    generation: 1,
  });
  coordinator.setPlaybackActive(false);
  assert.equal(coordinator.getSnapshot().active, false);
});

test("superseded lease cannot promote itself to playback authority", () => {
  const { coordinator } = createHarness();
  const first = coordinator.beginStartup();
  const second = coordinator.beginStartup();
  assert.equal(first.promoteToPlayback(), false);
  assert.equal(coordinator.getSnapshot().playbackActive, false);
  assert.equal(second.promoteToPlayback(), true);
  assert.equal(coordinator.getSnapshot().playbackActive, true);
});

test("lease timeout fails safe without clearing playback authority", () => {
  const { coordinator, timers } = createHarness();
  coordinator.beginStartup();
  coordinator.setPlaybackActive(true);
  assert.equal(timers.size, 1);
  timers.values().next().value();
  assert.equal(coordinator.getSnapshot().startupActive, false);
  assert.equal(coordinator.getSnapshot().playbackActive, true);
  assert.equal(coordinator.getSnapshot().active, true);
});
