import { getAdminClient } from "@/lib/supabase/admin";

import { releaseAvailability } from "@/lib/releases/release-availability";

/** Map cart lines to catalog products; availability and prices always come from DB. */
export async function resolveCartLines(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error("Cart is empty");
  }

  const slugs = [...new Set(cart.map((i) => i?.slug).filter(Boolean))];
  if (slugs.length === 0) throw new Error("Cart items missing slugs");

  const admin = getAdminClient();
  const { data: products, error } = await admin
    .from("products")
    .select("*, releases(id,status,scheduled_at,available_at,storefront_visible,upcoming_visible,preview_before_release,preorder_enabled,preorder_starts_at,preorder_price_cents,early_access_enabled,early_access_starts_at,unavailable_at)")
    .in("slug", slugs);

  if (error) throw error;

  const bySlug = new Map((products || []).map((p) => [p.slug, p]));
  const lines = [];

  for (const item of cart) {
    const product = bySlug.get(item.slug);
    if (!product) {
      throw new Error(`Unknown product: ${item.slug}`);
    }
    const lifecycle = Array.isArray(product.releases) ? product.releases[0] : product.releases;
    const availability = lifecycle ? releaseAvailability(lifecycle) : null;
    if (!lifecycle && !product.active) throw new Error(`Unknown product: ${item.slug}`);
    if (availability && !availability.canPurchase) {
      throw new Error(`Product is not currently available for purchase: ${item.slug}`);
    }
    lines.push({
      slug: product.slug,
      title: product.title,
      product_type: product.product_type,
      price_cents: availability?.preorderPriceCents ?? product.price_cents,
      cover_url: product.cover_url || item.cover,
      quantity: 1,
      release_id: product.release_id || lifecycle?.id || null,
      access_type: ["preorder", "early_access"].includes(availability?.phase) ? "preorder" : "purchase",
    });
  }

  return lines;
}
