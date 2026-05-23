import { isMissingSupabaseTable } from "@/lib/commerce/entitlements";

const NULL_SOURCE_ID = "00000000-0000-0000-0000-000000000000";

export function mapLibrarySourceToEntitlementSource(source) {
  switch (String(source || "purchase")) {
    case "gift":
      return "gifted";
    case "grant":
      return "admin_grant";
    case "bundle":
      return "purchase";
    case "purchase":
    default:
      return "purchase";
  }
}

export function isEntitlementsTableMissing(error) {
  return isMissingSupabaseTable(error);
}

async function hasActiveProductEntitlement(admin, userId, productId) {
  const { data, error } = await admin
    .from("entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("resource_type", "product")
    .eq("resource_id", productId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isEntitlementsTableMissing(error)) return null;
    throw error;
  }
  return Boolean(data);
}

export async function userOwnsProductViaEntitlements(admin, userId, productId) {
  const entitled = await hasActiveProductEntitlement(admin, userId, productId);
  return entitled;
}

export async function grantEntitlementsForProducts({
  admin,
  userId,
  purchaseId = null,
  products = [],
  source = "purchase",
}) {
  if (!products?.length) return { granted: 0, skipped: false };

  const sourceType = mapLibrarySourceToEntitlementSource(source);
  let granted = 0;

  for (const product of products) {
    const row = {
      user_id: userId,
      resource_type: "product",
      resource_id: product.id,
      source_type: sourceType,
      source_id: purchaseId || null,
      status: "active",
      metadata: {
        product_slug: product.slug,
        library_source: source,
      },
    };

    const { error: insertError } = await admin.from("entitlements").insert(row);

    if (!insertError) {
      granted += 1;
      continue;
    }

    if (isEntitlementsTableMissing(insertError)) {
      return { granted: 0, skipped: true };
    }

    if (insertError.code !== "23505") {
      throw insertError;
    }

    const { data: updated, error: updateError } = await admin
      .from("entitlements")
      .update({
        status: "active",
        source_id: purchaseId || null,
        metadata: row.metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("resource_type", "product")
      .eq("resource_id", product.id)
      .eq("source_type", sourceType)
      .eq("status", "active")
      .select("id");

    if (updateError) {
      if (isEntitlementsTableMissing(updateError)) {
        return { granted: 0, skipped: true };
      }
      throw updateError;
    }

    if ((updated || []).length) granted += 1;
  }

  return { granted, skipped: false };
}

export async function revokeEntitlementsForPurchase(admin, purchaseId) {
  if (!purchaseId) return { revoked: 0 };

  const { data, error } = await admin
    .from("entitlements")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("source_type", "purchase")
    .eq("source_id", purchaseId)
    .eq("status", "active")
    .select("id");

  if (error) {
    if (isEntitlementsTableMissing(error)) {
      return { revoked: 0, skipped: true };
    }
    throw error;
  }

  return { revoked: (data || []).length };
}

export async function revokeEntitlementsForGiftClaim(admin, { userId, productId, giftId }) {
  if (!userId || !productId) return { revoked: 0 };

  let query = admin
    .from("entitlements")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("resource_type", "product")
    .eq("resource_id", productId)
    .eq("source_type", "gifted")
    .eq("status", "active");

  if (giftId) {
    query = query.contains("metadata", { gift_id: giftId });
  }

  const { data, error } = await query.select("id");

  if (error) {
    if (isEntitlementsTableMissing(error)) {
      return { revoked: 0, skipped: true };
    }
    throw error;
  }

  return { revoked: (data || []).length };
}

export { NULL_SOURCE_ID };
