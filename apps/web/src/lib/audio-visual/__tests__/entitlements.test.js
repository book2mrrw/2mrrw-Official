import assert from "node:assert/strict";
import test from "node:test";
import {
  grantAudioVisualEntitlements,
  ownsAudioVisual,
  userCanWatchAudioVisual,
} from "../entitlements.js";

function fakeAdmin({ entitlementRow = null, insertError = null } = {}) {
  const inserted = [];
  return {
    inserted,
    from(table) {
      assert.equal(table, "entitlements");
      return {
        select() { return this; },
        eq() { return this; },
        limit() { return this; },
        async maybeSingle() { return { data: entitlementRow, error: null }; },
        insert(row) {
          inserted.push(row);
          return Promise.resolve({ error: insertError });
        },
      };
    },
  };
}

// ── ownsAudioVisual ──

test("ownsAudioVisual returns false with no admin/userId/videoId, never throwing", async () => {
  assert.equal(await ownsAudioVisual(null, "user-1", "video-1"), false);
  assert.equal(await ownsAudioVisual(fakeAdmin(), null, "video-1"), false);
  assert.equal(await ownsAudioVisual(fakeAdmin(), "user-1", null), false);
});

test("ownsAudioVisual returns true when an active audio_visual entitlement row exists", async () => {
  const admin = fakeAdmin({ entitlementRow: { id: "ent-1" } });
  assert.equal(await ownsAudioVisual(admin, "user-1", "video-1"), true);
});

test("ownsAudioVisual returns false when no row is found", async () => {
  const admin = fakeAdmin({ entitlementRow: null });
  assert.equal(await ownsAudioVisual(admin, "user-1", "video-1"), false);
});

test("ownsAudioVisual treats a missing entitlements table as false, not a thrown error", async () => {
  const admin = {
    from: () => ({
      select() { return this; },
      eq() { return this; },
      limit() { return this; },
      async maybeSingle() {
        return { data: null, error: { code: "42P01", message: 'relation "entitlements" does not exist' } };
      },
    }),
  };
  assert.equal(await ownsAudioVisual(admin, "user-1", "video-1"), false);
});

// ── userCanWatchAudioVisual ──

function tierOverrides({
  isAdmin = false, membership = null, hasCollectorAccess = false, owns = false,
} = {}) {
  return {
    isAdminUserIdFn: async () => isAdmin,
    getActiveMembershipFn: async () => membership,
    membershipHasPremiumAccessFn: (m) => Boolean(m?.premium),
    getCollectorAccessStateFn: async () => ({ hasCollectorAccess, records: [] }),
    ownsAudioVisualFn: async () => owns,
  };
}

test("userCanWatchAudioVisual: admin gets full access regardless of any other tier", async () => {
  const result = await userCanWatchAudioVisual("user-1", "video-1", fakeAdmin(), tierOverrides({ isAdmin: true }));
  assert.deepEqual(result, { peek: true, full: true, tier: "admin" });
});

test("userCanWatchAudioVisual: an active subscriber gets full access without ever needing to own the video", async () => {
  const result = await userCanWatchAudioVisual(
    "user-1", "video-1", fakeAdmin(),
    tierOverrides({ membership: { premium: true }, owns: false })
  );
  assert.deepEqual(result, { peek: true, full: true, tier: "subscriber" });
});

test("userCanWatchAudioVisual: collector access grants full access", async () => {
  const result = await userCanWatchAudioVisual("user-1", "video-1", fakeAdmin(), tierOverrides({ hasCollectorAccess: true }));
  assert.deepEqual(result, { peek: true, full: true, tier: "collector" });
});

test("userCanWatchAudioVisual: a direct purchase (ownsAudioVisual) grants full access with no membership/collector status", async () => {
  const result = await userCanWatchAudioVisual("user-1", "video-1", fakeAdmin(), tierOverrides({ owns: true }));
  assert.deepEqual(result, { peek: true, full: true, tier: "purchaser" });
});

test("userCanWatchAudioVisual: with no admin/subscriber/collector/purchase status, peek is still allowed but full is denied — tier 'entry'", async () => {
  const result = await userCanWatchAudioVisual("user-1", "video-1", fakeAdmin(), tierOverrides());
  assert.deepEqual(result, { peek: true, full: false, tier: "entry" });
});

test("userCanWatchAudioVisual: tier precedence is admin > subscriber > collector > purchaser > entry — a lower-priority signal never overrides a higher one already satisfied", async () => {
  const result = await userCanWatchAudioVisual(
    "user-1", "video-1", fakeAdmin(),
    tierOverrides({ isAdmin: true, membership: { premium: true }, hasCollectorAccess: true, owns: true })
  );
  assert.equal(result.tier, "admin");
});

// ── grantAudioVisualEntitlements ──

test("grantAudioVisualEntitlements grants nothing and does not touch the DB when there are no audio_visual items", async () => {
  const admin = fakeAdmin();
  const result = await grantAudioVisualEntitlements({ userId: "user-1", purchaseId: "purchase-1", items: [], admin });
  assert.deepEqual(result, { granted: 0 });
  assert.equal(admin.inserted.length, 0);
});

test("grantAudioVisualEntitlements filters out items with no video_id — never inserts a malformed row", async () => {
  const admin = fakeAdmin();
  const result = await grantAudioVisualEntitlements({
    userId: "user-1", purchaseId: "purchase-1",
    items: [{ type: "audio_visual" }, { type: "audio_visual", video_id: "video-1", title: "My Video" }],
    admin,
  });
  assert.equal(result.granted, 1);
  assert.equal(admin.inserted.length, 1);
  assert.equal(admin.inserted[0].resource_id, "video-1");
  assert.equal(admin.inserted[0].resource_type, "audio_visual");
  assert.equal(admin.inserted[0].source_type, "purchase");
  assert.equal(admin.inserted[0].source_id, "purchase-1");
  assert.equal(admin.inserted[0].status, "active");
});

test("grantAudioVisualEntitlements grants one entitlement per item for multiple videos in one purchase", async () => {
  const admin = fakeAdmin();
  const result = await grantAudioVisualEntitlements({
    userId: "user-1", purchaseId: "purchase-1",
    items: [
      { type: "audio_visual", video_id: "video-1" },
      { type: "audio_visual", video_id: "video-2" },
    ],
    admin,
  });
  assert.equal(result.granted, 2);
  assert.deepEqual(admin.inserted.map((r) => r.resource_id), ["video-1", "video-2"]);
});

test("grantAudioVisualEntitlements treats a unique-constraint conflict (23505) as already-granted, not an error — a webhook retry must be safe", async () => {
  const admin = fakeAdmin({ insertError: { code: "23505", message: "duplicate key" } });
  const result = await grantAudioVisualEntitlements({
    userId: "user-1", purchaseId: "purchase-1", items: [{ type: "audio_visual", video_id: "video-1" }], admin,
  });
  assert.equal(result.granted, 0);
});

test("grantAudioVisualEntitlements throws on a real (non-23505) DB error — unlike product purchases, there is no parallel library_items fallback, so a write failure here must not be silently swallowed", async () => {
  const admin = fakeAdmin({ insertError: { code: "XX000", message: "connection reset" } });
  await assert.rejects(
    () => grantAudioVisualEntitlements({
      userId: "user-1", purchaseId: "purchase-1", items: [{ type: "audio_visual", video_id: "video-1" }], admin,
    }),
    /connection reset/
  );
});
