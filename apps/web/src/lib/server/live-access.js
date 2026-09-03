import { isAdminUser } from "@/lib/auth/constants";
import { getUserEntitlements } from "@/lib/entitlements";

/**
 * Single source of truth for "can this request watch this live broadcast."
 *
 * Free, automatic: admin, subscriber, collector_card.
 * Everyone else (entry-level, purchaser of other content, or no account at
 * all) must pay once for this specific broadcast — see
 * live_broadcast_purchases. A purchase never grants access to a different
 * broadcast, and being a "purchaser" of other 2mrrw content grants nothing
 * here; those are deliberately different tiers.
 *
 * @param {{ admin: object, user: {id:string,isGuest?:boolean}|null, broadcast: {id:string}|null }} args
 * @returns {Promise<{ access: "none"|"signup_required"|"payment_required"|"free", reason: string }>}
 */
export async function resolveLiveBroadcastAccess({ admin, user, broadcast }) {
  if (!broadcast) return { access: "none", reason: "not_live" };

  // A guest-session cookie is not a real account for this purpose — the
  // viewer must go through actual signup before a price is even shown.
  if (!user || user.isGuest) {
    return { access: "signup_required", reason: "no_account" };
  }

  if (isAdminUser(user)) return { access: "free", reason: "admin" };

  const entitlements = await getUserEntitlements(user.id, admin);
  if (entitlements.subscriber) return { access: "free", reason: "subscriber" };
  if (entitlements.collector_card) return { access: "free", reason: "collector_card" };

  const { data: purchase, error } = await admin
    .from("live_broadcast_purchases")
    .select("id, amount_cents")
    .eq("broadcast_id", broadcast.id)
    .eq("user_id", user.id)
    .eq("status", "paid")
    .maybeSingle();
  if (error) throw error;

  if (purchase) {
    return { access: "free", reason: "ppv_purchased", amountCents: purchase.amount_cents };
  }

  return { access: "payment_required", reason: "entry_level_or_purchaser" };
}
