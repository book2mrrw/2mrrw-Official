import { createAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems } from "@/lib/commerce/entitlements";
import {
  releaseTypeToGiftItemType,
  resolveGiftProduct,
} from "@/lib/commerce/resolve-storefront-product";
import { isAdminUser } from "@/lib/auth/constants";
import { buildGiftLink, sendGiftEmail } from "@/lib/gifts/email";
import { claimGiftForUser } from "@/lib/gifts/helpers";
import { createGiftLinkToken } from "@/lib/gifts/token-hash";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
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

export class GiftSendError extends Error {
  constructor(message, { code = "GIFT_SEND_FAILED", details = null, status = 500 } = {}) {
    super(message);
    this.name = "GiftSendError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

export async function sendStorefrontGift({
  senderUser,
  releaseSlug,
  releaseTitle,
  releaseType,
  productId,
  recipientEmail,
  recipientPhone,
  recipientName,
  message,
}) {
  const logCtx = {
    releaseSlug: String(releaseSlug || "").trim() || null,
    releaseType: releaseType || null,
    productId: productId || null,
    senderId: senderUser?.id || null,
  };

  if (!isAdminUser(senderUser)) {
    console.warn("[gift-send] rejected: not admin", logCtx);
    throw new GiftSendError("Admin account required", { code: "ADMIN_REQUIRED", status: 403 });
  }

  const email = normalizeEmail(recipientEmail);
  if (!email) {
    throw new GiftSendError("Recipient email is required", { code: "RECIPIENT_EMAIL_REQUIRED", status: 400 });
  }

  const admin = createAdminClient();
  const { product, steps } = await resolveGiftProduct(admin, {
    slug: logCtx.releaseSlug,
    productId,
    releaseType,
  });

  console.info("[gift-send] product resolution", { ...logCtx, steps });

  if (!product) {
    console.error("[gift-send] product not found", { ...logCtx, steps });
    throw new GiftSendError("Could not resolve storefront product for this release.", {
      code: "PRODUCT_NOT_FOUND",
      details: { releaseSlug: logCtx.releaseSlug, releaseType: logCtx.releaseType, steps },
      status: 422,
    });
  }

  const recipientProfile = await findRecipientProfile(email);
  const itemType = releaseTypeToGiftItemType(releaseType, product.product_type);
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

  if (error) {
    console.error("[gift-send] gift insert failed", { ...logCtx, productId: product.id, error: error.message });
    throw error;
  }

  console.info("[gift-send] gift created", {
    ...logCtx,
    giftId: gift.id,
    productSlug: product.slug,
    itemType,
    recipientEmail: email,
    deliveredToExistingUser: Boolean(recipientProfile?.id),
  });

  const giftLink = buildGiftLink(giftTokenRaw);
  await sendGiftEmail({
    to: email,
    itemTitle: gift.item_title || product.title,
    message,
    giftLink,
    expiresAt: gift.expires_at,
    coverUrl: product.cover_url || null,
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
      console.info("[gift-send] auto-claimed for recipient", { giftId: gift.id, userId: recipientProfile.id });
    } catch (claimErr) {
      console.warn("[gift-send] claim fallback to grantLibraryItems", {
        giftId: gift.id,
        error: claimErr?.message,
      });
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
