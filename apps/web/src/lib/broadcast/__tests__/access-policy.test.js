import test from "node:test";
import assert from "node:assert/strict";
import { canAccessBroadcast, broadcastMediaItem, listenerSnapshot } from "../access-policy.js";
const session = { id: "s", state: "PRE_SHOW", accessPolicy: "PUBLIC", title: "Secret project", currentItemId: "a",
  presentation: { showTitle: false, showTracklist: false },
  items: ["a", "b", "c", "d"].map((id, position) => ({ id, position, title: "Secret title", trackId: "canonical-secret", storageKey: "private-key" })) };

test("all policies require an account; restricted policies require their exact entitlement", () => {
  for (const [policy, fact] of [["PUBLIC", null], ["ENTRY", "liveEntry"], ["PURCHASER", "purchaser"], ["SUBSCRIBER", "subscriber"], ["COLLECTOR_CARD_OWNER", "collector"]]) {
    const s = { ...session, accessPolicy: policy };
    assert.equal(canAccessBroadcast(s, { signedIn: false, admin: true }), false);
    assert.equal(canAccessBroadcast(s, { signedIn: true, [fact]: true }), true);
    if (fact) assert.equal(canAccessBroadcast(s, { signedIn: true }), false);
  }
  assert.equal(canAccessBroadcast({ ...session, accessPolicy: "ADMIN" }, { signedIn: true, subscriber: true }), false);
  assert.equal(canAccessBroadcast({ ...session, accessPolicy: "unknown" }, { signedIn: true }), false);
  assert.equal(canAccessBroadcast({ ...session, state: "DRAFT" }, { signedIn: true }), false);
});

test("invites expire, revoke, and cannot cross sessions or press/invite policies", () => {
  for (const [policy, kind] of [["INVITE_ONLY", "invite"], ["PRIVATE_PRESS_INDUSTRY", "press"]]) {
    const s = { ...session, accessPolicy: policy };
    const facts = { signedIn: true, grant: { sessionId: "s", kind, expiresAt: 2000 } };
    assert.equal(canAccessBroadcast(s, facts, 1000), true);
    assert.equal(canAccessBroadcast(s, facts, 2000), false);
    for (const patch of [{ sessionId: "other" }, { revokedAt: 100 }, { kind: "wrong" }, { expiresAt: NaN }]) {
      assert.equal(canAccessBroadcast(s, { ...facts, grant: { ...facts.grant, ...patch } }, 1000), false);
    }
  }
});

test("media window allows current/next only, respects reorder/exclusion, and closes on END", () => {
  assert.equal(broadcastMediaItem(session, "a")?.id, "a");
  assert.equal(broadcastMediaItem(session, "b")?.id, "b");
  assert.equal(broadcastMediaItem(session, "c"), null);
  assert.equal(broadcastMediaItem(session, "c", { admin: true })?.id, "c");
  assert.equal(broadcastMediaItem({ ...session, state: "ENDED" }, "a", { admin: true }), null);
  const changed = { ...session, items: session.items.map((item) => ({ ...item, excluded: item.id === "b" })) };
  assert.equal(broadcastMediaItem(changed, "b"), null);
  assert.equal(broadcastMediaItem(changed, "c")?.id, "c");
});

test("listener projection hides marketing metadata and drops internal identifiers/keys", () => {
  const dto = listenerSnapshot({ ...session, serviceSecret: "never", releaseId: "private-project" });
  const encoded = JSON.stringify(dto);
  for (const secret of ["Secret project", "Secret title", "private-key", "canonical-secret", "private-project", "never"]) assert.equal(encoded.includes(secret), false);
  assert.equal(dto.items[0].id, "a");
});
