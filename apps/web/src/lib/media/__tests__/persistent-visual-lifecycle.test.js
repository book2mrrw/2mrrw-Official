import test from "node:test";
import assert from "node:assert/strict";
import { createPersistentVisualLifecycle } from "../persistent-visual-lifecycle.js";

function createFakeVideo() {
  const listeners = new Map();
  let assignedSource = "";
  let sourceAssignments = 0;
  return {
    dataset: {},
    style: {},
    preload: "metadata",
    paused: true,
    ended: false,
    pauseCalls: 0,
    playCalls: 0,
    loadCalls: 0,
    get src() {
      return assignedSource;
    },
    set src(value) {
      assignedSource = value;
      sourceAssignments += 1;
    },
    get sourceAssignments() {
      return sourceAssignments;
    },
    play() {
      this.paused = false;
      this.playCalls += 1;
      return Promise.resolve();
    },
    pause() {
      this.paused = true;
      this.pauseCalls += 1;
    },
    load() {
      this.loadCalls += 1;
    },
    addEventListener(name, listener) {
      const existing = listeners.get(name) || [];
      existing.push(listener);
      listeners.set(name, existing);
    },
    removeEventListener(name, listener) {
      listeners.set(name, (listeners.get(name) || []).filter((entry) => entry !== listener));
    },
    dispatch(name) {
      for (const listener of listeners.get(name) || []) listener();
    },
  };
}

test("persistent cover art plays without pause, detach, reload, or duplicate source selection", async () => {
  const video = createFakeVideo();
  const lifecycle = createPersistentVisualLifecycle(video);

  assert.equal(lifecycle.setSource("https://media.example/art-a.mp4"), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(video.src, "https://media.example/art-a.mp4");
  assert.equal(video.sourceAssignments, 1);
  assert.equal(video.playCalls, 1);
  assert.equal(video.pauseCalls, 0);
  assert.equal(video.loadCalls, 0);

  assert.equal(lifecycle.setSource("https://media.example/art-a.mp4"), false);
  assert.equal(video.sourceAssignments, 1, "stable identity must not restart selection");

  video.paused = true;
  video.dispatch("pause");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(video.playCalls, 2, "an unexpected pause must self-heal");
  assert.equal(video.pauseCalls, 0, "the application must never pause cover motion");
  assert.equal(video.src, "https://media.example/art-a.mp4");

  lifecycle.dispose();
  assert.equal(video.pauseCalls, 0, "disposal must not introduce a visible pause");
  assert.equal(video.loadCalls, 0);
});

test("only an actual artwork identity change assigns another source", async () => {
  const video = createFakeVideo();
  const lifecycle = createPersistentVisualLifecycle(video);

  lifecycle.setSource("https://media.example/art-a.mp4");
  await new Promise((resolve) => setTimeout(resolve, 0));
  lifecycle.setSource("https://media.example/art-b.mp4");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(video.src, "https://media.example/art-b.mp4");
  assert.equal(video.sourceAssignments, 2);
  assert.equal(video.pauseCalls, 0);
  assert.equal(video.loadCalls, 0);

  lifecycle.dispose();
});
