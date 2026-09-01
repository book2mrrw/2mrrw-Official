import { isMissingSupabaseTable } from "@/lib/commerce/entitlements";

export async function buildEntitlementsParityReport(admin, { limit = 25 } = {}) {
  const generatedAt = new Date().toISOString();

  const { data: libraryRows, error: libraryError } = await admin
    .from("library_items")
    .select("user_id, product_id")
    .not("product_id", "is", null);

  if (libraryError) {
    return { generatedAt, error: libraryError.message };
  }

  const { data: entitlementRows, error: entitlementsError } = await admin
    .from("entitlements")
    .select("user_id, resource_id")
    .eq("resource_type", "product")
    .eq("status", "active");

  if (entitlementsError) {
    if (isMissingSupabaseTable(entitlementsError)) {
      return {
        generatedAt,
        entitlementsTablePresent: false,
        libraryRows: (libraryRows || []).length,
        note: "entitlements table missing — apply 20260601000000_unified_entitlements.sql",
      };
    }
    return { generatedAt, error: entitlementsError.message };
  }

  const libraryKeys = new Set(
    (libraryRows || []).map((row) => `${row.user_id}:${row.product_id}`).filter((k) => !k.includes("null"))
  );
  const entitlementKeys = new Set(
    (entitlementRows || [])
      .map((row) => `${row.user_id}:${row.resource_id}`)
      .filter((k) => !k.includes("null"))
  );

  const libraryOnlyKeys = [...libraryKeys].filter((key) => !entitlementKeys.has(key));
  const entitlementsOnlyKeys = [...entitlementKeys].filter((key) => !libraryKeys.has(key));
  const matched = [...libraryKeys].filter((key) => entitlementKeys.has(key)).length;

  const toSample = (keys) =>
    keys.slice(0, limit).map((key) => {
      const [userId, productId] = key.split(":");
      return { userId, productId };
    });

  return {
    generatedAt,
    entitlementsTablePresent: true,
    libraryRows: libraryKeys.size,
    entitlementRows: entitlementKeys.size,
    matched,
    libraryOnly: libraryOnlyKeys.length,
    entitlementsOnly: entitlementsOnlyKeys.length,
    sampleLibraryOnly: toSample(libraryOnlyKeys),
    sampleEntitlementsOnly: toSample(entitlementsOnlyKeys),
  };
}
