import { createAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { getFanSessionUser } from "@/lib/auth/session-user";
import { normalizeEmail } from "@/lib/guest-session";
import { hashGiftLinkToken } from "@/lib/gifts/token-hash";

export { getFanSessionUser };

export async function getGiftByToken(token) {
  const admin = createAdminClient();
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

  const admin = createAdminClient();
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
  const admin = createAdminClient();
  const { data: direct } = await admin
    .from("products")
    .select("id, slug, title, cover_url, product_type")
    .eq("id", gift.item_id)
    .maybeSingle();
  if (direct) return direct;

  const { data: byRelease } = await admin
    .from("releases")
    .select("slug, title, release_type, cover_art_r2_key")
    .eq("id", gift.item_id)
    .maybeSingle();

  if (!byRelease?.slug) return null;

  const slug = byRelease.slug.endsWith("-digital") ? byRelease.slug : `${byRelease.slug}-digital`;
  const { data: product } = await admin
    .from("products")
    .select("id, slug, title, cover_url, product_type")
    .eq("slug", slug)
    .maybeSingle();

  return product;
}

export async function claimGiftForUser(gift, user) {
  const admin = createAdminClient();
  const product = await resolveProductForGift(gift);
  if (!product) {
    throw new Error("Gift item is not available in the catalog yet.");
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
    purchase_type: "gift",
    gifted_by: gift.sender_id,
    gift_id: gift.id,
    item_id: product.id,
    item_type: gift.item_type,
    price_paid: 0,
  };

  const { data: purchase, error: purchaseError } = await admin
    .from("purchases")
    .insert(purchaseRow)
    .select("id")
    .single();
  if (purchaseError) throw purchaseError;

  await grantLibraryItems({
    userId: user.id,
    purchaseId: purchase.id,
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
    .select("*")
    .single();
  if (giftError) throw giftError;

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

  return {
    gift: updatedGift,
    product,
    purchaseId: purchase.id,
  };
}
