import { getAdminClient } from "@/lib/supabase/admin";
import { isCollectorAccessSlug, isMissingCollectorOwnershipsTable } from "@/lib/commerce/entitlements";
import { invalidateEntitlementTierCache } from "@/lib/server/entitlement-cache";

function collectorTypeForSlug(slug) {
  if (slug?.startsWith("exc-bundle")) return "collector_bundle";
  if (slug?.startsWith("exc-card")) return "collector_card";
  return "verified_collectible";
}

function addressFromPayment(payment) {
  const shipping = payment?.shipping_details || payment?.shipping || {};
  const customer = payment?.customer_details || {};
  const address = shipping.address || customer.address || {};

  return {
    name: shipping.name || customer.name || null,
    email: customer.email || payment?.receipt_email || payment?.metadata?.email || null,
    phone: shipping.phone || customer.phone || payment?.metadata?.phone || null,
    country: address.country || null,
    state: address.state || null,
    city: address.city || null,
    postalCode: address.postal_code || null,
    line1: address.line1 || null,
    line2: address.line2 || null,
  };
}

export async function grantCollectorOwnerships({ userId, purchaseId, slugs, items = [], payment }) {
  if (!slugs?.length) return [];

  const admin = getAdminClient();

  // Query products table including is_collector_product column (authoritative).
  // is_collector_product == null means the migration hasn't run yet — fall back to slug
  // pattern so existing behaviour is preserved during the transition period.
  const { data: allProducts, error: productErr } = await admin
    .from("products")
    .select("id, slug, title, product_type, metadata, is_collector_product")
    .in("slug", slugs);

  if (productErr) throw productErr;

  const products = (allProducts || []).filter((p) =>
    p.is_collector_product === true ||
    (p.is_collector_product == null && isCollectorAccessSlug(p.slug))
  );

  if (!products?.length) return [];

  const itemBySlug = new Map((items || []).map((item) => [item.slug, item]));
  const shipping = addressFromPayment(payment);
  const purchasedAt = new Date().toISOString();

  const rows = products.map((product) => {
    const item = itemBySlug.get(product.slug) || {};
    return {
      user_id: userId,
      product_id: product.id,
      purchase_id: purchaseId,
      product_slug: product.slug,
      title: product.title,
      collector_type: collectorTypeForSlug(product.slug),
      sku: item.sku || product.metadata?.sku || product.slug,
      version: item.version || product.metadata?.version || item.badge || null,
      stripe_payment_intent_id: payment?.object === "payment_intent" ? payment.id : (typeof payment?.payment_intent === "string" ? payment.payment_intent : payment?.payment_intent?.id || null),
      stripe_checkout_session_id: payment?.object === "checkout.session" ? payment.id : null,
      payment_status: "completed",
      verification_status: "verified",
      entitlement_status: "active",
      customer_email: shipping.email,
      customer_phone: shipping.phone,
      shipping_name: shipping.name,
      shipping_country: shipping.country,
      shipping_state: shipping.state,
      shipping_city: shipping.city,
      shipping_postal_code: shipping.postalCode,
      shipping_address_line1: shipping.line1,
      shipping_address_line2: shipping.line2,
      metadata: {
        item,
        payment_object: payment?.object || null,
        source: "stripe_webhook",
      },
      purchased_at: purchasedAt,
      verified_at: purchasedAt,
    };
  });

  const { data, error: upsertError } = await admin
    .from("collector_ownerships")
    .upsert(rows, { onConflict: "user_id,product_id" })
    .select("*");

  if (upsertError) {
    if (isMissingCollectorOwnershipsTable(upsertError)) {
      console.warn("collector_ownerships table missing; skipping collector ledger write until migration is applied");
      return [];
    }
    throw upsertError;
  }

  // Collector ownership granted → user is now a collector, tier cache must be invalidated.
  invalidateEntitlementTierCache(userId).catch(() => {});

  return data || [];
}
