import { createAdminClient } from "@/lib/supabase/admin";

/** Map cart lines to catalog products; prices always from DB. */
export async function resolveCartLines(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error("Cart is empty");
  }

  const slugs = [...new Set(cart.map((i) => i?.slug).filter(Boolean))];
  if (slugs.length === 0) throw new Error("Cart items missing slugs");

  const admin = createAdminClient();
  const { data: products, error } = await admin
    .from("products")
    .select("*")
    .in("slug", slugs)
    .eq("active", true);

  if (error) throw error;

  const bySlug = new Map((products || []).map((p) => [p.slug, p]));
  const lines = [];

  for (const item of cart) {
    const product = bySlug.get(item.slug);
    if (!product) {
      throw new Error(`Unknown product: ${item.slug}`);
    }
    lines.push({
      slug: product.slug,
      title: product.title,
      product_type: product.product_type,
      price_cents: product.price_cents,
      cover_url: product.cover_url || item.cover,
      quantity: 1,
    });
  }

  return lines;
}
