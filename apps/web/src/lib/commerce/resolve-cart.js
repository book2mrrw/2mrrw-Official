import { getAdminClient } from "@/lib/supabase/admin";

import { releaseAvailability } from "@/lib/releases/release-availability";
import { getPublicR2Url } from "@/lib/storage/r2";

/**
 * Map cart lines to catalog products OR Audio Visual videos; availability
 * and prices always come from DB. A cart item identifies what it wants
 * either by catalog `slug` or by Audio Visual `video_id` — audio_visuals
 * has no slug at all (a stable-ID-only table, see
 * supabase/migrations/20260906120000_audio_visual_schema_v2.sql's own
 * header comment), so it was never reachable through the slug-only path
 * this function used to have.
 *
 * @param {Array<object>} cart
 * @param {object} [admin] - optional Supabase service client to reuse (defaults to a fresh one) — test-only injection, matching the pattern already used throughout src/lib/audio-visual/entitlements.js.
 */
export async function resolveCartLines(cart, admin = null) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw new Error("Cart is empty");
  }

  const slugs = [...new Set(cart.map((i) => i?.slug).filter(Boolean))];
  const videoIds = [...new Set(cart.map((i) => i?.video_id).filter(Boolean))];
  if (slugs.length === 0 && videoIds.length === 0) throw new Error("Cart items missing slugs");

  const client = admin || getAdminClient();
  const [productsResult, audioVisualsResult] = await Promise.all([
    slugs.length
      ? client
          .from("products")
          .select("*, releases(id,status,scheduled_at,available_at,storefront_visible,upcoming_visible,preview_before_release,preorder_enabled,preorder_starts_at,preorder_price_cents,early_access_enabled,early_access_starts_at,unavailable_at)")
          .in("slug", slugs)
      : { data: [], error: null },
    videoIds.length
      ? client.from("audio_visuals").select("id, title, price_cents, poster_r2_key, publication_state").in("id", videoIds)
      : { data: [], error: null },
  ]);

  if (productsResult.error) throw productsResult.error;
  if (audioVisualsResult.error) throw audioVisualsResult.error;

  const bySlug = new Map((productsResult.data || []).map((p) => [p.slug, p]));
  const byVideoId = new Map((audioVisualsResult.data || []).map((v) => [v.id, v]));
  const lines = [];

  for (const item of cart) {
    if (item?.video_id) {
      const video = byVideoId.get(item.video_id);
      if (!video) throw new Error(`Unknown video: ${item.video_id}`);
      // Only a publicly published video is purchasable. 'ready' (has a
      // playable current_version_id but was never announced) is deliberately
      // excluded here even though the manifest route allows PLAYBACK for
      // 'ready' too (an already-entitled admin/subscriber previewing it) —
      // purchase and playback are different questions.
      if (video.publication_state !== "published") {
        throw new Error(`Video is not currently available for purchase: ${item.video_id}`);
      }
      lines.push({
        video_id: video.id,
        title: video.title,
        product_type: "audio_visual",
        price_cents: video.price_cents,
        cover_url: video.poster_r2_key ? getPublicR2Url(video.poster_r2_key) : null,
        quantity: 1,
        release_id: null,
        access_type: "purchase",
      });
      continue;
    }

    if (!item?.slug) {
      throw new Error("Cart item missing slug or video_id");
    }
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
