import { getAdminClient } from "@/lib/supabase/admin";

const PRINTFUL_BASE_URL = "https://api.printful.com";

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `merch-${Date.now()}`;
}

async function printfulGet(path, apiKey) {
  const res = await fetch(`${PRINTFUL_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.code && data.code !== 200)) {
    const message = data?.error?.message || `Printful request failed (HTTP ${res.status})`;
    throw new Error(message);
  }
  return data.result;
}

/**
 * Pulls every synced product + variant from this store's real Printful
 * catalog and mirrors it into products/product_variants — the merch page
 * renders from these DB rows (with Printful's own real mockup photos as
 * cover_url), not a live pass-through proxy, so cart/checkout has a stable
 * product_id/variant_id to resolve against. Idempotent: re-running updates
 * existing rows (matched by external_product_id/external_variant_id)
 * instead of duplicating them, and never overwrites an existing slug once
 * set, so a product's storefront URL survives a rename in Printful.
 */
export async function syncPrintfulCatalog({ admin: suppliedAdmin } = {}) {
  const apiKey = process.env.PRINTFUL_API_KEY;
  if (!apiKey) throw new Error("PRINTFUL_API_KEY is not configured");

  const admin = suppliedAdmin || getAdminClient();
  const summary = { products: 0, variants: 0, errors: [] };

  const syncProducts = [];
  for (let offset = 0; ; offset += 100) {
    const page = await printfulGet(`/store/products?limit=100&offset=${offset}`, apiKey);
    if (!Array.isArray(page)) throw new Error("Invalid Printful product list");
    syncProducts.push(...page);
    if (page.length < 100) break;
  }

  for (const summaryRow of syncProducts || []) {
    try {
      const detail = await printfulGet(`/store/products/${summaryRow.id}`, apiKey);
      const { sync_product: product, sync_variants: variants } = detail;

      const activeVariants = (variants || []).filter((v) => v.availability_status !== "discontinued");
      if (!activeVariants.length) continue;

      const priceCents = Math.round(parseFloat(activeVariants[0].retail_price) * 100) || 0;

      const { data: existing, error: lookupError } = await admin
        .from("products")
        .select("id, slug")
        .eq("external_product_id", String(product.id))
        .maybeSingle();

      if (lookupError) throw lookupError;

      // A fresh product (no existing row matched by external_product_id) must
      // not collide with any OTHER row's slug — products.slug is unique
      // platform-wide, and a same-named product (or a stale/manually-created
      // row that was never linked to a real Printful id) would otherwise
      // throw a duplicate-key error and drop this product from the sync
      // entirely. Same numeric-suffix dedup pattern as
      // /api/admin/audio-visual/draft's slug assignment.
      let slug = existing?.slug;
      if (!slug) {
        const base = slugify(product.name);
        slug = base;
        for (let attempt = 1; attempt <= 10; attempt++) {
          const { data: collision, error: collisionError } = await admin
            .from("products")
            .select("id")
            .eq("slug", slug)
            .maybeSingle();
          if (collisionError) throw collisionError;
          if (!collision) break;
          slug = `${base}-${attempt + 1}`;
        }
      }

      const { data: productRow, error: productErr } = await admin
        .from("products")
        .upsert(
          {
            slug,
            title: product.name,
            display_title: product.name,
            product_type: "merch",
            price_cents: priceCents,
            cover_url: product.thumbnail_url || null,
            image_path: product.thumbnail_url || null,
            external_product_id: String(product.id),
            active: true,
          },
          { onConflict: "external_product_id" }
        )
        .select("id")
        .single();

      if (productErr) {
        if (productErr.code === "42P10") {
          throw new Error("Apply migration 20260907120000_printful_product_upsert_index.sql, then run Sync Now again.");
        }
        throw productErr;
      }

      const variantRows = activeVariants.map((v) => ({
        product_id: productRow.id,
        external_variant_id: String(v.id),
        catalog_variant_id: v.variant_id != null ? String(v.variant_id) : null,
        sku: v.sku || null,
        size: v.size || null,
        color: v.color || null,
        price_cents: Math.round(parseFloat(v.retail_price) * 100) || priceCents,
        active: v.availability_status === "active",
      }));

      const { error: variantErr } = await admin
        .from("product_variants")
        .upsert(variantRows, { onConflict: "product_id,external_variant_id" });

      if (variantErr) throw variantErr;
      summary.products += 1;
      summary.variants += variantRows.length;
    } catch (err) {
      summary.errors.push({ printfulProductId: summaryRow.id, name: summaryRow.name, message: err.message });
    }
  }

  return summary;
}
