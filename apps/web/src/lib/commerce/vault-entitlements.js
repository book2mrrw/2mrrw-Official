import { getAdminClient } from "@/lib/supabase/admin";
import { isMissingSupabaseTable, isVaultPassSlug } from "@/lib/commerce/entitlements";

export async function grantVaultPassEntitlement({ userId, purchaseId, slugs, items = [], payment }) {
  if (!(slugs || []).some(isVaultPassSlug)) return null;

  const admin = getAdminClient();
  const item = (items || []).find((line) => isVaultPassSlug(line.slug)) || {};
  const { data: product, error: productError } = await admin
    .from("products")
    .select("id, slug, title")
    .eq("slug", "vault-pass")
    .maybeSingle();

  if (productError) throw productError;

  const paymentIntentId = payment?.object === "payment_intent"
    ? payment.id
    : (typeof payment?.payment_intent === "string" ? payment.payment_intent : payment?.payment_intent?.id || null);
  const checkoutSessionId = payment?.object === "checkout.session" ? payment.id : null;

  const row = {
    user_id: userId,
    entitlement_type: "vault_pass",
    access_tier: "vault_pass",
    source_type: "purchase",
    source_id: purchaseId,
    status: "active",
    renewal_state: "none",
    purchase_id: purchaseId,
    product_id: product?.id || null,
    stripe_payment_intent_id: paymentIntentId,
    stripe_checkout_session_id: checkoutSessionId,
    metadata: {
      item,
      source: "stripe_webhook",
      payment_object: payment?.object || null,
    },
    starts_at: new Date().toISOString(),
  };

  const { data, error } = await admin
    .from("vault_entitlements")
    .upsert(row, { onConflict: "user_id,entitlement_type,source_type,source_id" })
    .select("*")
    .single();

  if (error) {
    if (isMissingSupabaseTable(error)) {
      console.warn("vault_entitlements table missing; skipping Vault Pass grant until migration is applied");
      return null;
    }
    throw error;
  }

  return data;
}
