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

export async function claimGiftForUser(gift, user) {
  const admin = getAdminClient();
  const product = await resolveProductForGift(gift);
  if (!product) {
    throw new Error("Gift item is not available in the catalog yet.");
  }

  // Atomically mark the gift as claimed FIRST using a conditional UPDATE that only
  // succeeds if the gift is still unclaimed. This is the DB-level mutex: two concurrent
  // requests both passing the route-level state check can race here, but only one row
  // update can win. The loser gets 0 rows back → throw 409 before any purchase is written.
  const recipientEmail = normalizeEmail(user.email);
  const { data: updatedGift, error: giftError } = await admin
    .from("gifts")
    .update({
      claimed: true,
      claimed_at: new Date().toISOString(),
      status: "claimed",
      recipient_id: user.id,
      recipient_email: recipientEmail || gift.recipient_email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gift.id)
    .neq("status", "claimed")
    .eq("claimed", false)
    .select("*")
    .maybeSingle();
  if (giftError) throw giftError;
  if (!updatedGift) {
    const conflict = new Error("Gift already claimed");
    conflict.code = "ALREADY_CLAIMED";
    conflict.status = 409;
    throw conflict;
  }

  const purchaseRow = {
    user_id: user.id,
    amount_cents: 0,
    status: "completed",
    items: [
      {
        product_id: product.id,
        slug: product.slug,
        title: gift.item_title || product.title,
        type: gift.item_type || product.product_type,
      },
    ],
  };

  const { data: purchase, error: purchaseError } = await admin
    .from("purchases")
    .insert(purchaseRow)
    .select("id")
    .single();
  if (purchaseError) {
    console.warn("[gift-claim] purchases insert failed (non-fatal):", purchaseError.message);
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

  await admin.from("signals").insert({
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
