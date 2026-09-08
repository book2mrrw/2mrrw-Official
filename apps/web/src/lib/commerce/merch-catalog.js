// A failed variant query is not an empty inventory. Propagate the error so the
// route reports an outage instead of silently returning image-only products.
export async function readMerchCatalog(admin) {
  const { data: products, error } = await admin.from("products")
    .select("id, slug, title, price_cents, cover_url")
    .eq("active", true).eq("product_type", "merch")
    .order("title", { ascending: true });
  if (error) throw error;
  if (!products?.length) return [];

  const byProduct = new Map();
  // Supabase caps row counts. Page variants so large catalogs keep every size.
  for (let offset = 0; ; offset += 500) {
    const { data: rows, error: variantError } = await admin.from("product_variants")
      .select("id, product_id, external_variant_id, catalog_variant_id, sku, size, color, price_cents")
      .in("product_id", products.map((p) => p.id)).eq("active", true)
      .order("id", { ascending: true }).range(offset, offset + 499);
    if (variantError) throw variantError;
    for (const row of rows || []) {
      const variants = byProduct.get(row.product_id) || [];
      variants.push({
        id: row.id, externalVariantId: row.external_variant_id,
        catalogVariantId: row.catalog_variant_id, sku: row.sku,
        size: row.size || null, color: row.color || null,
        price: row.price_cents / 100,
      });
      byProduct.set(row.product_id, variants);
    }
    if (!rows || rows.length < 500) break;
  }
  return products.map((row) => {
    const variants = byProduct.get(row.id) || [];
    return {
      id: row.slug, slug: row.slug, title: row.title, cover: row.cover_url,
      product_type: "merch", source: "catalog", variants,
      price: variants.length ? Math.min(...variants.map((v) => v.price)) : null,
    };
  });
}
