import assert from "node:assert/strict";
import test from "node:test";
import {
  giftsNeedingRepair,
  guestRightsToCopy,
  isGuestPrincipal,
  isRegisteredEmail,
} from "@/lib/commerce/email-bound-rights-rules";

const USER = "real-user";
const HOUR_GLASS = "3ead5e47";
const LOVE_HZ = "53d79121";

test("guest addresses are never treated as a verified email", () => {
  assert.equal(isRegisteredEmail("fan@example.com"), true);
  assert.equal(isRegisteredEmail("guest-abc@guest.2mrrw.local"), false);
  assert.equal(isRegisteredEmail(""), false);
  assert.equal(isGuestPrincipal({ email: "guest-abc@guest.2mrrw.local" }), true);
  assert.equal(isGuestPrincipal({ email: "fan@example.com", user_metadata: { guest: true } }), true);
  assert.equal(isGuestPrincipal({ email: "fan@example.com" }), false);
});

test("a gift claimed under a guest session (stale recipient_id) is repaired onto the email owner", () => {
  // Production case 2026-10-02: Hour Glass gift to the fan's email, claimed by a guest principal.
  const gifts = [
    { id: "g1", status: "claimed", recipient_id: "guest-principal", item_id: HOUR_GLASS },
    { id: "g2", status: "claimed", recipient_id: USER, item_id: LOVE_HZ },
  ];
  const owned = new Set([LOVE_HZ]);
  assert.deepEqual(giftsNeedingRepair(gifts, USER, owned).map((g) => g.id), ["g1"]);
});

test("a gift claimed by the right account but never granted is repaired", () => {
  const gifts = [{ id: "g3", status: "claimed", recipient_id: USER, item_id: HOUR_GLASS }];
  assert.deepEqual(giftsNeedingRepair(gifts, USER, new Set()).map((g) => g.id), ["g3"]);
});

test("pending / expired / revoked gifts are never auto-claimed", () => {
  const gifts = ["pending", "expired", "revoked"].map((status, i) => ({
    id: `p${i}`, status, recipient_id: null, item_id: HOUR_GLASS,
  }));
  assert.deepEqual(giftsNeedingRepair(gifts, USER, new Set()), []);
});

test("guest-held purchases and gifts are copied once per provenance, skipping what the user owns", () => {
  const rows = [
    { user_id: "guest-1", product_id: HOUR_GLASS, purchase_id: "p1", source: "purchase", products: { slug: "hour-glass" } },
    { user_id: "guest-1", product_id: LOVE_HZ, purchase_id: "p2", source: "gift", products: { slug: "love-hz-vol-1" } },
    { user_id: "guest-2", product_id: HOUR_GLASS, purchase_id: "p3", source: "purchase", products: { slug: "hour-glass" } },
  ];
  const groups = guestRightsToCopy(rows, new Set([LOVE_HZ]));
  assert.deepEqual(groups, [
    { fromPrincipal: "guest-1", purchaseId: "p1", source: "purchase", slugs: ["hour-glass"] },
  ]);
});

test("access-only rows (membership / collector / admin views) are never copied as ownership", () => {
  const rows = ["membership", "collector_access", "admin"].map((source, i) => ({
    user_id: "guest-1", product_id: `x${i}`, purchase_id: null, source, products: { slug: `s${i}` },
  }));
  assert.deepEqual(guestRightsToCopy(rows, new Set()), []);
});
