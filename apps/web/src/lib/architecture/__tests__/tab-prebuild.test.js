import assert from "node:assert/strict";
import test from "node:test";

import { createPanelHandle, createTabPrebuildQueue } from "@/lib/storefront/tab-prebuild";

/** Deterministic queue: every wait is a gate the test opens explicitly. */
function harness() {
  let settle;
  const screen = new Promise((resolve) => { settle = resolve; });
  let audioStarting = false;
  const audioWaiters = [];
  const idleWaiters = [];
  const queue = createTabPrebuildQueue({
    whenScreenSettled: () => screen,
    whenAudioIdle: () => (audioStarting ? new Promise((resolve) => audioWaiters.push(resolve)) : Promise.resolve()),
    nextIdle: () => new Promise((resolve) => idleWaiters.push(resolve)),
  });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    queue,
    settle: async () => { settle(); await flush(); },
    idle: async () => { idleWaiters.shift()?.(); await flush(); },
    setAudioStarting: async (value) => {
      audioStarting = value;
      if (!value) audioWaiters.splice(0).forEach((resolve) => resolve());
      await flush();
    },
    idleWaiting: () => idleWaiters.length,
  };
}

test("a panel handle is prepared once and notifies once", () => {
  const handle = createPanelHandle();
  let calls = 0;
  handle.subscribe(() => { calls += 1; });
  assert.equal(handle.isPrepared(), false);
  handle.prepare();
  handle.prepare();
  assert.equal(handle.isPrepared(), true);
  assert.equal(calls, 1);
});

test("nothing is prepared until what is on screen has loaded, then one panel per idle slot, in page order", async () => {
  const h = harness();
  const [home, music, shop] = [createPanelHandle(), createPanelHandle(), createPanelHandle()];
  [home, music, shop].forEach((panel) => h.queue.add(panel));
  await h.idle();
  assert.deepEqual([home, music, shop].map((p) => p.isPrepared()), [false, false, false]);

  await h.settle();
  assert.equal(h.idleWaiting(), 1, "waits for an idle slot");
  await h.idle();
  assert.deepEqual([home, music, shop].map((p) => p.isPrepared()), [true, false, false]);
  await h.idle();
  assert.deepEqual([home, music, shop].map((p) => p.isPrepared()), [true, true, false]);
  await h.idle();
  assert.deepEqual([home, music, shop].map((p) => p.isPrepared()), [true, true, true]);
  assert.equal(h.queue.pendingCount(), 0);
});

test("tabs still to be built go before media load-ahead for tabs that are already built", async () => {
  const h = harness();
  const [home, music, shop, cards] = [createPanelHandle(), createPanelHandle(), createPanelHandle(), createPanelHandle()];
  h.queue.add(home);
  h.queue.add(music);
  h.queue.add(shop, { build: true });
  h.queue.add(cards, { build: true });
  await h.settle();
  const order = [];
  for (let step = 0; step < 4; step += 1) {
    await h.idle();
    order.push(["home", "music", "shop", "cards"].find((name, i) => [home, music, shop, cards][i].isPrepared() && !order.includes(name)));
  }
  assert.deepEqual(order, ["shop", "cards", "home", "music"]);
});

test("an opened panel jumps ahead of panels nobody has asked for", async () => {
  const h = harness();
  const [music, shop, vault] = [createPanelHandle(), createPanelHandle(), createPanelHandle()];
  [music, shop, vault].forEach((panel) => h.queue.add(panel));
  h.queue.add(vault, { first: true });
  await h.settle();
  await h.idle();
  assert.equal(vault.isPrepared(), true);
  assert.equal(music.isPrepared(), false);
  assert.equal(h.queue.pendingCount(), 2, "re-adding never duplicates");
});

test("preparation waits while a track is starting, so first audio goes first", async () => {
  const h = harness();
  const panel = createPanelHandle();
  await h.setAudioStarting(true);
  h.queue.add(panel);
  await h.settle();
  assert.equal(h.idleWaiting(), 0, "does not even wait for idle while audio starts");
  await h.setAudioStarting(false);
  await h.idle();
  assert.equal(panel.isPrepared(), true);
});

test("a removed (unmounted) panel is never prepared, and a prepared one is never queued again", async () => {
  const h = harness();
  const [kept, removed] = [createPanelHandle(), createPanelHandle()];
  h.queue.add(kept);
  h.queue.add(removed);
  h.queue.remove(removed);
  await h.settle();
  await h.idle();
  assert.equal(kept.isPrepared(), true);
  assert.equal(removed.isPrepared(), false);
  h.queue.add(kept);
  assert.equal(h.queue.pendingCount(), 0);
});

test("a tab built ahead of time also fetches its CSS background art, pseudo-elements included", async () => {
  const { warmBackgroundImages } = await import("@/lib/storefront/tab-prebuild");
  const started = [];
  globalThis.Image = class { set src(url) { started.push(url); } decode() { return Promise.resolve(); } };
  const styles = new Map([
    ["door", { null: 'url("/vault/vault-closed-tall.webp")', "::before": "none", "::after": 'url(/vault/vault-chamber-tall.webp), linear-gradient(red, blue)' }],
    ["plain", { null: "none", "::before": "none", "::after": "none" }],
  ]);
  globalThis.getComputedStyle = (el, pseudo) => ({ backgroundImage: styles.get(el.id)[pseudo ?? "null"] });
  const plain = { id: "plain" };
  const door = { id: "door", querySelectorAll: () => [plain] };
  assert.equal(warmBackgroundImages(door), 2);
  assert.deepEqual(started.sort(), ["/vault/vault-chamber-tall.webp", "/vault/vault-closed-tall.webp"]);
});
