import assert from "node:assert/strict";
import test from "node:test";
import { FullVideoAuthority } from "../full-video-authority.js";

test.beforeEach(() => {
  FullVideoAuthority._resetForTesting();
});

test("granting a session with no prior holder calls onGranted, not onRevoked", () => {
  let granted = false;
  FullVideoAuthority.requestFullVideoSession("a", { onGranted: () => { granted = true; } });
  assert.equal(granted, true);
  assert.equal(FullVideoAuthority.getActiveSessionId(), "a");
});

test("a second session request revokes the first (pause-style callback), never the other way around", () => {
  let aRevoked = false;
  let bGranted = false;
  FullVideoAuthority.requestFullVideoSession("a", { onRevoked: () => { aRevoked = true; } });
  FullVideoAuthority.requestFullVideoSession("b", { onGranted: () => { bGranted = true; } });
  assert.equal(aRevoked, true);
  assert.equal(bGranted, true);
  assert.equal(FullVideoAuthority.getActiveSessionId(), "b");
});

test("re-requesting the same id that already holds authority does not revoke itself", () => {
  let revokedCount = 0;
  FullVideoAuthority.requestFullVideoSession("a", { onRevoked: () => { revokedCount += 1; } });
  FullVideoAuthority.requestFullVideoSession("a", { onRevoked: () => { revokedCount += 1; } });
  assert.equal(revokedCount, 0);
  assert.equal(FullVideoAuthority.getActiveSessionId(), "a");
});

test("releasing the current holder clears authority", () => {
  FullVideoAuthority.requestFullVideoSession("a");
  FullVideoAuthority.releaseFullVideoSession("a");
  assert.equal(FullVideoAuthority.getActiveSessionId(), null);
});

test("releasing an id that does not currently hold authority is a no-op", () => {
  FullVideoAuthority.requestFullVideoSession("a");
  FullVideoAuthority.releaseFullVideoSession("stale-id");
  assert.equal(FullVideoAuthority.getActiveSessionId(), "a");
});

test("a throwing onGranted/onRevoked callback never propagates — authority callbacks are isolated", () => {
  FullVideoAuthority.requestFullVideoSession("a", { onRevoked: () => { throw new Error("boom"); } });
  assert.doesNotThrow(() => {
    FullVideoAuthority.requestFullVideoSession("b", { onGranted: () => { throw new Error("boom"); } });
  });
  assert.equal(FullVideoAuthority.getActiveSessionId(), "b");
});

test("VRM's own decoder-budget arbitration is a completely separate module — this file never imports it", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../full-video-authority.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /^import .*video-resource-manager/m);
  assert.doesNotMatch(src, /\bVRM\./);
});
