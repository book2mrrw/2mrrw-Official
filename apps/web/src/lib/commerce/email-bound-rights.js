import { claimGiftForUser, resolveProductForGift } from "@/lib/gifts/helpers";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import {
  escapeLikePattern,
  giftsNeedingRepair,
  guestRightsToCopy,
  isGuestPrincipal,
  isRegisteredEmail,
  normalizeEmail,
} from "@/lib/commerce/email-bound-rights-rules";

/**
 * Rights follow the verified email.
 *
 * Gifts are addressed to an email, and guest checkouts record the buyer's real
 * email on the guest identity. Before this module, whichever principal happened
 * to be signed in at claim/checkout time kept those rights forever: a gift
 * claimed under a guest session, or a purchase made before the buyer registered,
 * never reached the buyer's real account, so they heard previews of music they
 * own.
 *
 * Every /api/account/state build for a registered user runs this, so repair is
 * universal and automatic — no one has to reopen an old gift link.
 *
 * Safety model — rights only ever flow TOWARD the verified email owner, as a
 * copy:
 *   - Gifts: re-run the existing idempotent claimGiftForUser repair, which
 *     authorises by recipient_email and re-points a stale recipient_id.
 *   - Guest-held rights: copied from GUEST principals only (never from another
 *     registered account). The guest keeps its copy. A guest can only ever give
 *     rights to the email owner, never take them.
 */

const GUEST_PASS_COOLDOWN_MS = 10 * 60_000;
const _guestPassAt = new Map();

async function ownedProductIdsFor(admin, userId) {
  const { data, error } = await admin.from("library_items").select("product_id").eq("user_id", userId);
  if (error) throw error;
  return new Set((data || []).map((row) => row.product_id).filter(Boolean));
}

async function repairGifts(admin, user, email, owned) {
  const { data: gifts, error } = await admin
    .from("gifts")
    .select("*")
    .eq("status", "claimed")
    .ilike("recipient_email", escapeLikePattern(email));
  if (error) throw error;

  let repaired = 0;
  for (const gift of giftsNeedingRepair(gifts, user.id, owned)) {
    try {
      // item_id may reference a release rather than a product; resolve before
      // deciding, so an already-granted gift is not re-repaired on every load.
      if (gift.recipient_id === user.id) {
        const product = await resolveProductForGift(gift);
        if (!product || owned.has(product.id)) continue;
      }
      const result = await claimGiftForUser(gift, user);
      if (result?.product?.id) owned.add(result.product.id);
      repaired += 1;
      console.info("[email-bound-rights] gift repaired", { giftId: gift.id, userId: user.id });
    } catch (err) {
      console.warn("[email-bound-rights] gift repair failed", { giftId: gift.id, message: err?.message });
    }
  }
  return repaired;
}

async function copyGuestRights(admin, user, email, owned) {
  const last = _guestPassAt.get(user.id);
  if (last && Date.now() - last < GUEST_PASS_COOLDOWN_MS) return 0;
  _guestPassAt.set(user.id, Date.now());

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", escapeLikePattern(email))
    .neq("id", user.id);
  if (profileError) throw profileError;
  const candidateIds = (profiles || []).map((row) => row.id).filter(Boolean);
  if (!candidateIds.length) return 0;

  const { data: rows, error: rowsError } = await admin
    .from("library_items")
    .select("user_id, product_id, purchase_id, source, products(slug)")
    .in("user_id", candidateIds);
  if (rowsError) throw rowsError;
  if (!rows?.length) return 0;

  // Only guest principals donate. Confirm against auth, never the profile alone.
  const holderIds = [...new Set(rows.map((row) => row.user_id))];
  const guestIds = new Set();
  for (const id of holderIds) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (!error && isGuestPrincipal(data?.user)) guestIds.add(id);
  }

  let copied = 0;
  for (const group of guestRightsToCopy(rows.filter((row) => guestIds.has(row.user_id)), owned)) {
    try {
      const granted = await grantLibraryItems({
        userId: user.id,
        purchaseId: group.purchaseId,
        slugs: group.slugs,
        source: group.source,
        entitlementMetadata: {
          transferred_from_principal: group.fromPrincipal,
          transfer_reason: "email_bound_rights",
        },
      });
      for (const row of granted || []) if (row?.product_id) owned.add(row.product_id);
      copied += group.slugs.length;
      console.info("[email-bound-rights] guest rights copied", {
        userId: user.id,
        fromPrincipal: group.fromPrincipal,
        slugs: group.slugs,
      });
    } catch (err) {
      console.warn("[email-bound-rights] guest rights copy failed", { message: err?.message });
    }
  }
  return copied;
}

/**
 * Bring every right addressed to this user's verified email onto this account.
 * Never throws; returns whether anything changed so the caller can re-read.
 */
export async function reconcileEmailBoundRights(admin, user) {
  const email = normalizeEmail(user?.email);
  if (!user?.id || user.isGuest || !isRegisteredEmail(email)) return { changed: false };

  try {
    const owned = await ownedProductIdsFor(admin, user.id);
    const repairedGifts = await repairGifts(admin, user, email, owned);
    const copiedGuestRights = await copyGuestRights(admin, user, email, owned);
    return { changed: repairedGifts + copiedGuestRights > 0, repairedGifts, copiedGuestRights };
  } catch (err) {
    console.warn("[email-bound-rights] reconciliation failed", { userId: user.id, message: err?.message });
    return { changed: false };
  }
}
