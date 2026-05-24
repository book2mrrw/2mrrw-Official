import { createAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import { isAdminUser } from "@/lib/auth/constants";
import { buildGiftLink, sendGiftEmail } from "@/lib/gifts/email";
import { claimGiftForUser } from "@/lib/gifts/helpers";
import { createGiftLinkToken } from "@/lib/gifts/token-hash";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function productSlugForRelease(releaseSlug) {
  const slug = String(releaseSlug || "").trim();
  if (!slug) return null;
  return slug.endsWith("-digital") ? slug : `${slug}-digital`;
}

function itemTypeForRelease(releaseType) {
  const t = String(releaseType || "").toLowerCase();
  if (t === "album" || t === "ep") return t === "ep" ? "ep" : "album";
  if (t === "deluxe") return "deluxe";
  return "single";
}

async function resolveProductByReleaseSlug(releaseSlug) {
  const admin = createAdminClient();
  const slug = productSlugForRelease(releaseSlug);
  const { data: product, error } = await admin
    .from("products")
    .select("id, slug, title, cover_url, product_type")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return product;
}

async function findRecipientProfile(email) {
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .ilike("email", email)
    .maybeSingle();
  return profile;
}

export async function sendStorefrontGift({
  senderUser,
  releaseSlug,
  releaseTitle,
  releaseType,
  recipientEmail,
  recipientPhone,
  recipientName,
  message,
}) {
  if (!isAdminUser(senderUser)) {
    throw new Error("Admin account required");
  }

  const email = normalizeEmail(recipientEmail);
  if (!email) throw new Error("Recipient email is required");

  const product = await resolveProductByReleaseSlug(releaseSlug);
  if (!product) {
    throw new Error("Could not resolve storefront product for this release.");
  }

  const admin = createAdminClient();
  const recipientProfile = await findRecipientProfile(email);
  const itemType = itemTypeForRelease(releaseType || product.product_type);
  const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

  const { raw: giftTokenRaw, hash: giftTokenHash } = createGiftLinkToken();

  const { data: gift, error } = await admin
    .from("gifts")
    .insert({
      sender_id: senderUser.id,
      recipient_id: recipientProfile?.id ?? null,
      recipient_email: email,
      recipient_phone: recipientPhone?.trim() || null,
      item_type: itemType,
      item_id: product.id,
      item_title: releaseTitle || product.title,
      message: message?.trim() || null,
      expires_at: expiresAt,
      gift_link_token_hash: giftTokenHash,
      gift_link_token: null,
    })
    .select("*")
    .single();

  if (error) throw error;

  const giftLink = buildGiftLink(giftTokenRaw);
  await sendGiftEmail({
    to: email,
    itemTitle: gift.item_title || product.title,
    message,
    giftLink,
    expiresAt: gift.expires_at,
  });

  let delivered = false;
  if (recipientProfile?.id) {
    const recipientUser = {
      id: recipientProfile.id,
      email: recipientProfile.email || email,
      name: recipientName?.trim() || recipientProfile.full_name || "",
    };
    try {
      await claimGiftForUser(gift, recipientUser);
      delivered = true;
    } catch (claimErr) {
      await grantLibraryItems({
        userId: recipientProfile.id,
        purchaseId: null,
        slugs: [product.slug],
        source: "gift",
      });
      await admin
        .from("library_items")
        .update({ gifted_by: senderUser.id, gift_id: gift.id, source: "gift" })
        .eq("user_id", recipientProfile.id)
        .eq("product_id", product.id);
      delivered = true;
    }
  }

  return {
    gift,
    giftLink,
    delivered,
    recipientEmail: email,
    recipientName: recipientName?.trim() || null,
  };
}
