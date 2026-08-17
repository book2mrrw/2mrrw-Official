import { getAdminClient } from "@/lib/supabase/admin";
import {
  releaseTypeToGiftItemType,
  resolveGiftProduct,
} from "@/lib/commerce/resolve-storefront-product";
import { isAdminUser } from "@/lib/auth/constants";
import { buildGiftLink, sendGiftEmail } from "@/lib/gifts/email";
import { createGiftLinkToken } from "@/lib/gifts/token-hash";
import { sendSMS } from "@/lib/server/twilio";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function findRecipientProfile(email) {
  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .ilike("email", email)
    .maybeSingle();
  return profile;
}

async function findRecipientProfileByPhone(phone) {
  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .eq("phone", phone)
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
  const phone = recipientPhone?.trim() || null;

  if (!email && !phone) {
    throw new GiftSendError("Recipient email or phone number is required", { code: "RECIPIENT_CONTACT_REQUIRED", status: 400 });
  }

  const admin = getAdminClient();
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

  // Look up existing account by email first, then phone as fallback
  const recipientProfile = email
    ? await findRecipientProfile(email)
    : await findRecipientProfileByPhone(phone);

  const itemType = releaseTypeToGiftItemType(releaseType, product.product_type);
  const expiresAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();

  const { raw: giftTokenRaw, hash: giftTokenHash } = createGiftLinkToken();

  const { data: gift, error } = await admin
    .from("gifts")
    .insert({
      sender_id: senderUser.id,
      recipient_id: recipientProfile?.id ?? null,
      recipient_email: email || null,
      recipient_phone: phone,
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
    recipientEmail: email || null,
    recipientPhone: phone || null,
    deliveredToExistingUser: Boolean(recipientProfile?.id),
  });

  const giftLink = buildGiftLink(giftTokenRaw);
  let smsSent = false;
  let emailSent = false;

  if (email) {
    const emailResult = await sendGiftEmail({
      to: email,
      itemTitle: gift.item_title || product.title,
      message,
      giftLink,
      expiresAt: gift.expires_at,
      coverUrl: product.cover_url || null,
    });
    emailSent = Boolean(emailResult.sent);
    if (!emailSent) {
      console.error("[gift-send] gift email NOT delivered", {
        giftId: gift.id,
        to: email,
        loggedOnly: emailResult.loggedOnly,
        resendError: emailResult.resendError,
        httpStatus: emailResult.status,
      });
    } else {
      console.info("[gift-send] gift email delivered", { giftId: gift.id, to: email });
    }
  }

  if (phone) {
    const title = gift.item_title || product.title;
    const smsBody = [
      `🎁 You have a gift from 2MRRW${title ? `: ${title}` : ""}!`,
      message?.trim() ? `"${message.trim()}"` : null,
      `Claim it here: ${giftLink}`,
    ].filter(Boolean).join("\n");

    const smsResult = await sendSMS({ to: phone, body: smsBody });
    smsSent = Boolean(smsResult.ok);
    if (!smsSent) {
      console.error("[gift-send] gift SMS NOT delivered", { giftId: gift.id, to: phone });
    } else {
      console.info("[gift-send] gift SMS delivered", { giftId: gift.id, to: phone });
    }
  }

  // Never auto-claim on send — recipient must click their link and claim it themselves.
  // Marking the gift as claimed at send time prevents the recipient from ever claiming it.
  const delivered = false;

  return {
    gift,
    giftLink,
    delivered,
    emailSent,
    smsSent,
    recipientEmail: email || null,
    recipientPhone: phone || null,
    recipientName: recipientName?.trim() || null,
  };
}
