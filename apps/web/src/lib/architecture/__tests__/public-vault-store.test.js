import assert from "node:assert/strict";
import test from "node:test";

import { createPublicVaultStore } from "@/lib/storefront/public-vault-store";

test("listeners hear the Vault state only when it actually changes", async () => {
  let answer = { unlocked: false, sections: [] };
  let fetches = 0;
  const store = createPublicVaultStore(async () => {
    fetches += 1;
    return structuredClone(answer);
  });
  let notified = 0;
  store.subscribe(() => { notified += 1; });

  await store.load();
  assert.equal(notified, 1);
  const first = store.getSnapshot();
  assert.deepEqual(first, answer);

  await store.load();
  assert.equal(fetches, 2);
  assert.equal(notified, 1, "an identical answer changes nothing");
  assert.equal(store.getSnapshot(), first, "same object: no consumer re-renders");

  answer = { unlocked: true, sections: [{ slug: "drops" }] };
  await store.load();
  assert.equal(notified, 2);
  assert.equal(store.getSnapshot().unlocked, true);
});

test("a failed load keeps the current state", async () => {
  let fail = false;
  const store = createPublicVaultStore(async () => (fail ? null : { unlocked: true }));
  await store.load();
  const kept = store.getSnapshot();
  fail = true;
  await store.load();
  assert.equal(store.getSnapshot(), kept);
});
