import assert from "node:assert/strict";
import test from "node:test";

import { VRM, PRIORITY_VISIBLE } from "../video-resource-manager.js";

async function withNavigator(value, fn) {
  const existing = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value });
  try {
    return await fn();
  } finally {
    if (existing) Object.defineProperty(globalThis, "navigator", existing);
    else delete globalThis.navigator;
  }
}

function flush(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("reserveExternal shrinks the effective budget without registering anything", async () => {
  VRM._resetForTesting();
  VRM.setBudgetForTesting(3);
  const els = [{}, {}, {}];
  els.forEach((el) => {
    VRM.register(el, PRIORITY_VISIBLE);
    VRM.requestPlay(el, () => {});
  });
  await flush();
  assert.equal(VRM.getActiveCount(), 3);

  VRM.reserveExternal(2);
  await flush();
  assert.equal(VRM.getActiveCount(), 1, "budget(3) - reserved(2) leaves room for only 1");

  VRM.reserveExternal(0);
  await flush();
  assert.equal(VRM.getActiveCount(), 3, "clearing the reservation restores the full budget");

  VRM._resetForTesting();
});

test("iOS staggers onGranted calls when multiple grants land in the same pass", async () => {
  VRM._resetForTesting();
  VRM.setBudgetForTesting(4);
  const order = [];

  await withNavigator({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)" }, async () => {
    const els = [{}, {}];
    els.forEach((el, i) => {
      VRM.register(el, PRIORITY_VISIBLE);
      VRM.requestPlay(el, () => order.push({ i, t: Date.now() }));
    });
    await flush(400);
  });

  assert.equal(order.length, 2);
  assert.ok(
    order[1].t - order[0].t >= 100,
    `second grant should land well after the first on iOS (gap was ${order[1].t - order[0].t}ms)`
  );

  VRM._resetForTesting();
});

test("non-iOS platforms fire simultaneous grants synchronously in the same pass", async () => {
  VRM._resetForTesting();
  VRM.setBudgetForTesting(4);
  const order = [];

  await withNavigator({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, async () => {
    const els = [{}, {}];
    els.forEach((el, i) => {
      VRM.register(el, PRIORITY_VISIBLE);
      VRM.requestPlay(el, () => order.push({ i, t: Date.now() }));
    });
    await flush(50);
  });

  assert.equal(order.length, 2);
  assert.ok(
    order[1].t - order[0].t < 50,
    `grants should fire together off iOS (gap was ${order[1].t - order[0].t}ms)`
  );

  VRM._resetForTesting();
});
