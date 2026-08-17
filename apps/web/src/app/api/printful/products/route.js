import { getAdminClient } from "@/lib/supabase/admin";

const MERCH_COVER_FALLBACK = {
  hoodie: "/images/albums/tbh.jpg",
  shirt: "/images/albums/ad.jpg",
  hat: "/images/albums/lovehz.jpg",
};

function resolveMerchCover(url) {
  if (!url) return "";
  const match = url.match(/\/images\/merch\/(\w+)\./);
  if (match && MERCH_COVER_FALLBACK[match[1]]) return MERCH_COVER_FALLBACK[match[1]];
  return url;
}

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
  const priceRaw =
    item.retail_price ||
    item.sync_variants?.[0]?.retail_price ||
    0;
  return {
    id: item.id,
    slug: String(item.external_id || item.id),
    title: item.name || item.sync_product?.name || "Product",
    cover: pickCover(item),
    price: typeof priceRaw === "number" ? priceRaw : parseFloat(priceRaw) || 0,
    source: "printful",
  };
}

async function merchFromCatalog() {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("products")
      .select("slug, title, price_cents, cover_url")
      .eq("active", true)
      .eq("product_type", "merch")
      .order("title", { ascending: true });

    if (error || !data?.length) return [];

    return data.map((row) => ({
      id: row.slug,
      slug: row.slug,
      title: row.title,
      cover: resolveMerchCover(row.cover_url),
      price: (row.price_cents || 0) / 100,
      source: "catalog",
    }));
  } catch {
    return [];
  }
}

export async function GET() {
  const apiKey = process.env.PRINTFUL_API_KEY;
  if (!apiKey) {
    const catalog = await merchFromCatalog();
    return Response.json({
      success: catalog.length > 0,
      products: catalog,
      source: catalog.length ? "catalog" : "none",
      error: catalog.length ? undefined : "PRINTFUL_API_KEY not configured",
    });
  }

  try {
    const res = await fetch("https://api.printful.com/store/products?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 300 },
    });

    const data = await res.json();

    if (!res.ok || (data.code && data.code !== 200)) {
      const catalog = await merchFromCatalog();
      return Response.json({
        success: catalog.length > 0,
        products: catalog,
        source: catalog.length ? "catalog" : "printful_error",
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

    let products = rawProducts.map(normalizePrintfulItem).filter((p) => p.cover);

    if (products.length === 0) {
      const catalog = await merchFromCatalog();
      if (catalog.length > 0) {
        products = catalog.filter((p) => p.cover);
      }
    }

    return Response.json({
      success: products.length > 0,
      products,
      source: products[0]?.source || (rawProducts.length ? "printful" : "none"),
    });
  } catch (err) {
    const catalog = await merchFromCatalog();
    return Response.json({
      success: catalog.length > 0,
      products: catalog.filter((p) => p.cover),
      source: catalog.length ? "catalog" : "error",
      error: err.message,
    });
  }
}
