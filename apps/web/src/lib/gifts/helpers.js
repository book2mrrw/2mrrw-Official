import { getAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { resolveGiftProduct } from "@/lib/commerce/resolve-storefront-product";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { normalizeEmail } from "@/lib/guest-session";
import { hashGiftLinkToken } from "@/lib/gifts/token-hash";
import { isGiftReminderToken, parseGiftReminderToken } from "@/lib/gifts/reminder-link";
import { grantEntitlementFlag } from "@/lib/entitlements";
import { invalidateAccountStateCache } from "@/lib/server/account-state-cache";

export { getFanSessionUser };

export async function getGiftByToken(token) {
  const admin = getAdminClient();

  if (isGiftReminderToken(token)) {
    const parsed = parseGiftReminderToken(token);
    if (!parsed?.giftId) return null;
    const { data, error } = await admin.from("gifts").select("*").eq("id", parsed.giftId).maybeSingle();
    if (error) throw error;
    return data;
  }

  const tokenHash = hashGiftLinkToken(token);

  const { data: byHash, error: hashError } = await admin
    .from("gifts")
    .select("*")
    .eq("gift_link_token_hash", tokenHash)
    .maybeSingle();
  if (hashError) throw hashError;
  if (byHash) return byHash;

  const { data, error } = await admin
    .from("gifts")
    .select("*")
    .eq("gift_link_token", token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function giftPublicState(gift) {
  if (!gift) return { state: "invalid" };
  if (gift.status === "revoked") return { state: "revoked", gift };
  if (gift.status === "claimed" || gift.claimed) return { state: "claimed", gift };
  if (gift.status === "expired") return { state: "expired", gift };
  if (gift.expires_at && new Date(gift.expires_at) < new Date()) {
    return { state: "expired", gift };
  }
  return { state: "valid", gift };
}

export async function expireGiftIfNeeded(gift) {
  if (!gift || gift.status !== "pending") return gift;
  if (!gift.expires_at || new Date(gift.expires_at) >= new Date()) return gift;

  const admin = getAdminClient();
  const { data, error } = await admin
    .from("gifts")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("id", gift.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function resolveProductForGift(gift) {
  const admin = getAdminClient();
  const { data: direct } = await admin
    .from("products")
    .select("id, slug, title, cover_url, product_type, content_type")
    .eq("id", gift.item_id)
    .maybeSingle();
  if (direct) return direct;

  const { data: byRelease } = await admin
    .from("releases")
    .select("slug, title, release_type, cover_art_r2_key")
    .eq("id", gift.item_id)
    .maybeSingle();

  if (!byRelease?.slug) return null;

  const { product } = await resolveGiftProduct(admin, {
    slug: byRelease.slug,
    releaseType: byRelease.release_type,
  });
  return product;
}

function isVaultGiftProduct(product, gift) {
  const slug = String(product?.slug || "").toLowerCase();
  const itemType = String(gift?.item_type || product?.product_type || "").toLowerCase();
  const contentType = String(product?.content_type || "").toLowerCase();
  return (
    slug === "vault-pass" ||
    slug === "vault_pass" ||
    itemType === "vault_access" ||
    itemType === "vault_item" ||
    contentType === "vault_access" ||
    contentType === "vault_item"
  );
}

/**
 * Is this principal the rightful recipient of this gift?
 *
 * ── AUTHORITY MODEL ─────────────────────────────────────────────────────────
 *
 * `recipient_email` is CANONICAL. `recipient_id` is a CACHE, resolved at send
 * time by a profile lookup that may be wrong, absent, or point at a principal
 * that has since been superseded — and it is only corrected at claim time.
 *
 * Authorising on `recipient_id` is what stranded a real gift: it was bound to a
 * legacy principal, the recipient registered a proper account, and every later
 * request compared his real id against the stale one and returned
 * "already claimed" — permanently, to the person the gift was for.
 *
 * A gift belongs to whoever controls the address it was sent to. That is true
 * before the claim, after the claim, and after any number of principal changes.
 * So every authorisation decision in this file reads the email.
 */
export function isGiftRecipient(gift, user) {
  const giftEmail = normalizeEmail(gift?.recipient_email);
  const userEmail = normalizeEmail(user?.email);
  if (!giftEmail || !userEmail) return false;
  return giftEmail === userEmail;
}

/**
 * Claim a gift for a user. IDEMPOTENT and SELF-HEALING.
 *
 * ── The failure this design removes ─────────────────────────────────────────
 *
 * The grant is not one transaction — it marks the gift claimed, then writes a
 * purchase, library items and entitlements through the entitlement engine.
 * If anything after the mark fails (engine throws, deploy mid-request, process
 * dies), the previous implementation left the gift permanently `claimed` while
 * the recipient owned NOTHING, and the only recovery path compared
 * `recipient_id`. A single transient error destroyed the gift.
 *
 * Making the whole thing one SQL transaction would mean reimplementing the
 * entitlement engine in plpgsql — a protected subsystem, and a far larger risk
 * than the bug. So the guarantee is obtained a different way:
 *
 *   MUTEX      a compare-and-set still ensures only ONE principal can win a
 *              contested gift. That is the only thing the CAS is for.
 *   REPAIR     if the CAS loses because the gift is already claimed BY THIS
 *              SAME RECIPIENT, that is not a conflict — it is an unfinished
 *              claim. Fall through and run the grant again.
 *   IDEMPOTENT the grant is safe to repeat: library_items upserts with
 *              ignoreDuplicates, entitlements are keyed per product.
 *
 * Net effect: a partially-applied claim heals itself the next time the rightful
 * recipient opens the link, and no ordering of failures can permanently
 * separate them from what they were given.
 */
export async function claimGiftForUser(gift, user) {
  const admin = getAdminClient();

  // AUTHORITY FIRST — before any state is touched.
  if (!isGiftRecipient(gift, user)) {
    const denied = new Error("Sign in with the email this gift was sent to.");
    denied.code = "EMAIL_MISMATCH";
    denied.status = 403;
    throw denied;
  }

  const product = await resolveProductForGift(gift);
  if (!product) {
    throw new Error("Gift item is not available in the catalog yet.");
  }

  const recipientEmail = normalizeEmail(user.email);
  const nowIso = new Date().toISOString();

  // MUTEX: only one principal may win an unclaimed gift.
  const { data: won, error: giftError } = await admin
    .from("gifts")
    .update({
      claimed: true,
      claimed_at: nowIso,
      status: "claimed",
      recipient_id: user.id,
      recipient_email: recipientEmail || gift.recipient_email,
      updated_at: nowIso,
    })
    .eq("id", gift.id)
    .neq("status", "claimed")
    .eq("claimed", false)
    .select("*")
    .maybeSingle();
  if (giftError) throw giftError;

  let updatedGift = won;
  let repairing = false;

  if (!won) {
    // The CAS lost. Determine WHY: a genuine conflict, or our own unfinished claim.
    const { data: current, error: readErr } = await admin
      .from("gifts")
      .select("*")
      .eq("id", gift.id)
      .maybeSingle();
    if (readErr) throw readErr;

    if (!current || !isGiftRecipient(current, user)) {
      const conflict = new Error("Gift already claimed");
      conflict.code = "ALREADY_CLAIMED";
      conflict.status = 409;
      throw conflict;
    }

    // Same recipient. This is a repair, not a conflict.
    repairing = true;
    updatedGift = current;

    // Re-point the cache if it drifted (legacy principal, account change).
    if (current.recipient_id !== user.id) {
      const { data: repointed } = await admin
        .from("gifts")
        .update({ recipient_id: user.id, updated_at: nowIso })
        .eq("id", gift.id)
        .select("*")
        .maybeSingle();
      if (repointed) updatedGift = repointed;
      console.info("[gift-claim] repointed stale recipient_id", {
        giftId: gift.id, from: current.recipient_id, to: user.id,
      });
    }
    console.info("[gift-claim] repairing an incomplete claim", { giftId: gift.id, userId: user.id });
  }

  // The zero-value purchase row is the provenance record for the grant. It must
  // be written at most ONCE per gift: the repair path re-enters this code, and a
  // blind insert would mint a duplicate $0 purchase on every repair.
  //
  // `gift_id` is the idempotency key. Look before writing.
  const { data: existingPurchase } = await admin
    .from("purchases")
    .select("id")
    .eq("user_id", user.id)
    .eq("gift_id", gift.id)
    .maybeSingle();

  let purchase = existingPurchase || null;

  if (!purchase) {
    const purchaseRow = {
      user_id: user.id,
      amount_cents: 0,
      status: "completed",
      gift_id: gift.id,
      gifted_by: gift.sender_id,
      purchase_type: "gift",
      items: [
        {
          product_id: product.id,
          slug: product.slug,
          title: gift.item_title || product.title,
          type: gift.item_type || product.product_type,
        },
      ],
    };

    const { data: inserted, error: purchaseError } = await admin
      .from("purchases")
      .insert(purchaseRow)
      .select("id")
      .maybeSingle();
    if (purchaseError) {
      console.warn("[gift-claim] purchases insert failed (non-fatal):", purchaseError.message);
    }
    purchase = inserted || null;
  }

  await grantLibraryItems({
    userId: user.id,
    purchaseId: purchase?.id ?? null,
    slugs: [product.slug],
    source: "gift",
    entitlementMetadata: { gift_id: gift.id },
  });

  const libraryPatch = {
    gifted_by: gift.sender_id,
    gift_id: gift.id,
    source: "gift",
  };
  await admin
    .from("library_items")
    .update(libraryPatch)
    .eq("user_id", user.id)
    .eq("product_id", product.id);

  if (isVaultGiftProduct(product, gift)) {
    const admin = getAdminClient();
    await grantEntitlementFlag(admin, user.id, "vault_access", "gift_claim", {
      metadata: { gift_id: gift.id, product_slug: product.slug },
    });
    console.log("[gift-claim] vault_access granted", { userId: user.id, giftId: gift.id });
  }

  // Announce the claim once. A repair is not a new event — re-announcing would
  // put a duplicate "Gift claimed" signal in the feed every time a partially
  // applied claim heals itself.
  if (!repairing) await admin.from("signals").insert({
    title: "Gift claimed",
    type: "text",
    status: "active",
    priority: 10,
    metadata: {
      kind: "gift_claimed",
      gift_id: gift.id,
      message: `${recipientEmail || "A fan"} claimed their gift — ${gift.item_title || product.title}`,
      recipient_email: recipientEmail || gift.recipient_email,
      item_title: gift.item_title || product.title,
      claimed_at: new Date().toISOString(),
    },
  });

  invalidateAccountStateCache(user.id).catch(() => {});

  return {
    gift: updatedGift,
    product,
    purchaseId: purchase?.id ?? null,
  };
}
