import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { grantLibraryItems, isMissingSupabaseColumn } from "@/lib/commerce/entitlements";

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

export function createGiftRedeemToken() {
  const raw = crypto.randomBytes(24).toString("hex");
  return { raw, hash: hashToken(raw) };
}

/**
 * Record a completed purchase-to-gift and grant library to recipient after redeem.
 */
export async function completeGiftTransaction({
  transactionId,
  recipientUserId,
  redeemTokenRaw
}) {
  const admin = getAdminClient();
  const redeemTokenHash = hashToken(redeemTokenRaw);

  const { data: txn, error: txnError } = await admin
    .from("gift_transactions")
    .select("id, product_id, status, products(slug)")
    .eq("id", transactionId)
    .maybeSingle();
  if (txnError) throw txnError;
  if (!txn || txn.status !== "pending") {
    throw new Error("Gift transaction is not pending.");
  }

  const slug = txn.products?.slug;
  if (!slug) throw new Error("Gift product not found.");

  await grantLibraryItems({
    userId: recipientUserId,
    purchaseId: null,
    slugs: [slug],
    source: "gift"
  });

  const { error: updateError } = await admin
    .from("gift_transactions")
    .update({
      status: "completed",
      redeem_token_hash: redeemTokenHash,
      redeemed_at: new Date().toISOString()
    })
    .eq("id", transactionId);
  if (updateError) throw updateError;

  return { ok: true, redeemToken: redeemTokenRaw };
}

export async function createPendingGiftTransaction({
  purchaserUserId,
  recipientEmail,
  productSlug,
  stripePaymentIntentId,
  amountCents
}) {
  const admin = getAdminClient();
  let productResult = await admin
    .from("products")
    .select("id, slug, gifting_enabled, metadata")
    .eq("slug", productSlug)
    .maybeSingle();

  if (productResult.error && isMissingSupabaseColumn(productResult.error)) {
    productResult = await admin.from("products").select("id, slug, metadata").eq("slug", productSlug).maybeSingle();
  }
  if (productResult.error) throw productResult.error;

  const product = productResult.data;
  if (!product) throw new Error("Product not found.");

  const giftingEnabled = Boolean(product.gifting_enabled ?? product.metadata?.gifting_enabled);
  if (!giftingEnabled) throw new Error("Gifting is not enabled for this product.");

  const { data, error } = await admin
    .from("gift_transactions")
    .insert({
      purchaser_user_id: purchaserUserId,
      recipient_email: String(recipientEmail || "").trim().toLowerCase(),
      product_id: product.id,
      stripe_payment_intent_id: stripePaymentIntentId ?? null,
      amount_cents: amountCents,
      status: "pending"
    })
    .select("id")
    .single();
  if (error) throw error;
  return data;
}
