/**
 * Audio Visual entitlement authority. Deliberately independent of
 * src/lib/entitlements.js (the unrelated boolean-flag file) and of
 * isDigitalProduct()/userCanStreamProduct() (the products/slug-based
 * digital-access gate) — a video purchase has no products row and no
 * slug (audio_visuals is a stable-ID-only table, see the schema
 * migration's own header comment), so it is entitled purely via
 * entitlements.resource_type = 'audio_visual', resource_id = videoId.
 *
 * Reuses the real, existing membership/collector authority functions
 * (getActiveMembership, membershipHasPremiumAccess, getCollectorAccessState
 * — all from src/lib/commerce/entitlements.js) rather than reimplementing
 * subscriber/collector logic here — those tiers apply the same way to
 * Audio Visual as to everything else; only the "did they buy *this one*"
 * check is new.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { isAdminUserId } from "@/lib/auth/admin-authority";
import {
  getActiveMembership,
  membershipHasPremiumAccess,
  getCollectorAccessState,
  isMissingSupabaseTable,
} from "@/lib/commerce/entitlements";

/**
 * @param {object} admin - Supabase service client
 * @param {string} userId
 * @param {string} videoId
 * @returns {Promise<boolean>}
 */
export async function ownsAudioVisual(admin, userId, videoId) {
  if (!admin || !userId || !videoId) return false;

  const { data, error } = await admin
    .from("entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("resource_type", "audio_visual")
    .eq("resource_id", videoId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSupabaseTable(error)) return false;
    throw error;
  }
  return Boolean(data);
}

/**
 * @param {string} userId
 * @param {string} videoId
 * @param {object} [admin] - optional Supabase service client to reuse (defaults to a fresh one)
 * @param {object} [overrides] - injectable function overrides, for tests only —
 *   real callers should never need this. ESM named exports can't be monkey-patched
 *   from outside, so this is the same injectable-dependency pattern already used
 *   throughout the encoding worker (spawnFn/readFileFn/etc.), applied here.
 * @returns {Promise<{ peek: true, full: boolean, tier: string }>} peek is always
 *   allowed for any signed-in caller — only `full` is ever gated.
 */
export async function userCanWatchAudioVisual(userId, videoId, admin = null, overrides = {}) {
  const {
    isAdminUserIdFn = isAdminUserId,
    getActiveMembershipFn = getActiveMembership,
    membershipHasPremiumAccessFn = membershipHasPremiumAccess,
    getCollectorAccessStateFn = getCollectorAccessState,
    ownsAudioVisualFn = ownsAudioVisual,
  } = overrides;
  const client = admin || getAdminClient();

  if (await isAdminUserIdFn(userId, client)) {
    return { peek: true, full: true, tier: "admin" };
  }

  const membership = await getActiveMembershipFn(userId);
  if (membershipHasPremiumAccessFn(membership)) {
    return { peek: true, full: true, tier: "subscriber" };
  }

  const { hasCollectorAccess } = await getCollectorAccessStateFn(client, userId, []);
  if (hasCollectorAccess) {
    return { peek: true, full: true, tier: "collector" };
  }

  if (await ownsAudioVisualFn(client, userId, videoId)) {
    return { peek: true, full: true, tier: "purchaser" };
  }

  return { peek: true, full: false, tier: "entry" };
}

/**
 * Grants Audio Visual entitlements for a completed purchase. This is the
 * ONLY thing that makes a purchased video watchable at the "full" tier —
 * unlike product purchases, there is no parallel library_items row or
 * dual-verify fallback, so a write failure here is a real failure, not a
 * soft/logged skip.
 *
 * Idempotent: a Stripe webhook retry re-granting the same (userId,
 * videoId, purchaseId) hits entitlements_active_unique and is treated as
 * already-granted, never a duplicate active row or a thrown error.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.purchaseId
 * @param {Array<{ video_id: string, title?: string, price?: number }>} params.items - audio_visual-typed purchase items only
 * @param {object} [params.admin]
 * @returns {Promise<{ granted: number }>}
 */
export async function grantAudioVisualEntitlements({ userId, purchaseId, items, admin = null }) {
  const client = admin || getAdminClient();
  const list = (Array.isArray(items) ? items : []).filter((item) => item?.video_id);
  if (!list.length) return { granted: 0 };

  let granted = 0;
  for (const item of list) {
    const { error } = await client.from("entitlements").insert({
      user_id: userId,
      resource_type: "audio_visual",
      resource_id: item.video_id,
      source_type: "purchase",
      source_id: purchaseId || null,
      status: "active",
      metadata: { title: item.title || null, purchased_at: new Date().toISOString() },
    });
    if (!error) {
      granted += 1;
    } else if (error.code !== "23505") {
      throw new Error(`grantAudioVisualEntitlements: ${error.message}`);
    }
  }
  return { granted };
}
