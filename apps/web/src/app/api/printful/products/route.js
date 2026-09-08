import { getAdminClient } from "@/lib/supabase/admin";
import { readMerchCatalog } from "@/lib/commerce/merch-catalog";

// Without this, Next.js can statically cache this route's response at build/
// first-request time and keep serving that frozen snapshot indefinitely — a
// real Printful sync writes fresh rows to the DB, but every subsequent page
// load kept re-reading whatever was true the first time this route ever ran,
// which is exactly why it looked like syncing "didn't stick" until the next
// deploy. This route must always read the live merch table.
export const dynamic = "force-dynamic";

function pickCover(item) {
  const direct =
    item.thumbnail_url ||
    item.sync_product?.thumbnail_url ||
    item.thumbnail;
  if (direct) return direct;

  const variant = item.sync_variants?.[0];
  const file =
    variant?.files?.find((f) => f?.preview_url || f?.url) || variant?.files?.[0];
  return (
    file?.preview_url ||
    file?.thumbnail_url ||
    file?.url ||
    variant?.product?.image ||
    ""
  );
}

function normalizePrintfulItem(item) {
  return {
    id: item.id,
    slug: String(item.external_id || item.id),
    title: item.name || item.sync_product?.name || "Product",
    cover: pickCover(item),
    price: null,
    variants: [],
    product_type: "merch",
    source: "printful",
  };
}

async function merchFromCatalog() {
  return readMerchCatalog(getAdminClient());
}

// The synced catalog (products/product_variants, kept current by
// syncPrintfulCatalog() — see /api/admin/printful/sync) is the primary
// source, not a live Printful pass-through: a pass-through item's slug
// (external_id/id) never matches a real products row, so cart/checkout has
// nothing to resolve it against. The live call below only exists as a
// display-only fallback for the brief window before the catalog has ever
// been synced — checkout would not work correctly for whatever it returns,
// but showing *something* beats an empty shop tab.
export async function GET() {
  let catalog;
  try {
    catalog = await merchFromCatalog();
  } catch (error) {
    console.error("[printful/products] Catalog read failed", error.message);
    return Response.json({
      success: false, products: [], source: "catalog_error",
      error: "Shop options could not be loaded. Please try again shortly.",
    }, { status: 503 });
  }
  if (catalog.length > 0) {
    return Response.json({ success: true, products: catalog, source: "catalog" });
  }

  const apiKey = process.env.PRINTFUL_API_KEY;
  if (!apiKey) {
    return Response.json({
      success: false,
      products: [],
      source: "none",
      error: "PRINTFUL_API_KEY not configured, and the catalog has not been synced yet",
    });
  }

  try {
    const res = await fetch("https://api.printful.com/store/products?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok || (data.code && data.code !== 200)) {
      return Response.json({
        success: false,
        products: [],
        source: "printful_error",
        error: data.error?.message || data.result || `Printful HTTP ${res.status}`,
      });
    }

    let rawProducts = [];
    const result = data.result;
    if (Array.isArray(result)) {
      rawProducts = result;
    } else if (Array.isArray(result?.sync_products)) {
      rawProducts = result.sync_products;
    } else if (Array.isArray(result?.items)) {
      rawProducts = result.items;
    } else if (Array.isArray(result?.products)) {
      rawProducts = result.products;
    }

    const products = rawProducts.map(normalizePrintfulItem).filter((p) => p.cover);

    return Response.json({
      success: products.length > 0,
      products,
      source: products.length ? "printful_unsynced" : "none",
    });
  } catch (err) {
    return Response.json({
      success: false,
      products: [],
      source: "error",
      error: err.message,
    });
  }
}
