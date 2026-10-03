import { isPermanentLibrarySource } from "@/lib/library-ownership";

/**
 * Pure rules for email-bound rights reconciliation (see email-bound-rights.js).
 * Kept free of server imports so they can be unit-tested directly.
 */

/** Same normalization as guest-session normalizeEmail (which imports next/headers). */
export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export const GUEST_EMAIL_DOMAIN = "@guest.2mrrw.local";

export function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function isRegisteredEmail(email) {
  const normalized = normalizeEmail(email);
  return Boolean(normalized && normalized.includes("@") && !normalized.endsWith(GUEST_EMAIL_DOMAIN));
}

export function isGuestPrincipal(principal) {
  const email = normalizeEmail(principal?.email);
  return email.endsWith(GUEST_EMAIL_DOMAIN) || principal?.user_metadata?.guest === true;
}

/**
 * Pure: claimed gifts addressed to this user that still need repair — bound to a
 * different principal, or never granted to this one.
 */
export function giftsNeedingRepair(gifts = [], userId, ownedProductIds = new Set()) {
  return (gifts || []).filter(
    (gift) =>
      gift?.status === "claimed" &&
      (gift.recipient_id !== userId || !ownedProductIds.has(gift.item_id))
  );
}

/**
 * Pure: library rows held by guest principals that the user does not own yet,
 * grouped so each provenance (purchase + source) is granted once.
 */
export function guestRightsToCopy(guestRows = [], ownedProductIds = new Set()) {
  const groups = new Map();
  const seen = new Set();
  for (const row of guestRows || []) {
    const slug = row?.products?.slug;
    if (!slug || !row.product_id) continue;
    if (!isPermanentLibrarySource(row.source)) continue;
    if (ownedProductIds.has(row.product_id) || seen.has(row.product_id)) continue;
    seen.add(row.product_id);
    const source = row.source === "gift" ? "gift" : "purchase";
    const key = `${row.user_id}|${row.purchase_id || ""}|${source}`;
    if (!groups.has(key)) {
      groups.set(key, { fromPrincipal: row.user_id, purchaseId: row.purchase_id || null, source, slugs: [] });
    }
    groups.get(key).slugs.push(slug);
  }
  return [...groups.values()];
}
