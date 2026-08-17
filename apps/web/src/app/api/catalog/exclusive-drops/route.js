import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BADGE_COLORS = {
  "FIRST EDITION": "#00ffff",
  "EARLY SUPPORTER": "#ff6b35",
  "LAUNCH BUNDLE": "#a259ff",
  SIGNED: "#00ffff",
  COLLECTOR: "#a259ff",
};

function mapProductToExclusiveItem(row) {
  const meta = row.metadata || {};
  const badge = meta.badge || meta.edition_label || "COLLECTOR";
  const price = (row.price_cents || 0) / 100;
  const features = Array.isArray(meta.features) ? meta.features : [];

  return {
    id: row.slug,
    slug: row.slug,
    title: row.title,
    subtitle: meta.edition_label || meta.subtitle || row.product_type,
    type: row.product_type === "bundle" ? "bundle" : row.product_type === "vinyl" ? "vinyl" : "collector-card",
    cover: row.cover_url || "/images/albums/lovehz.jpg",
    price,
    description: meta.description || row.title,
    features: features.length ? features : ["Collector ownership token", "Synced from control catalog"],
    badge,
    badgeColor: BADGE_COLORS[badge] || meta.badgeColor || "#a259ff",
    stock: meta.edition_size ?? meta.stock ?? null,
    contentId: meta.content_id || null,
    contentType: meta.content_type || null,
  };
}

export async function GET() {
  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("products")
      .select("slug, title, product_type, price_cents, cover_url, metadata, active")
      .eq("active", true)
      .in("product_type", ["vault", "bundle", "vinyl"])
      .order("title", { ascending: true });

    if (error) {
      return NextResponse.json({ items: [], source: "error", error: error.message });
    }

    const items = (data || [])
      .filter((row) => row.slug?.startsWith("exc-") || row.slug?.startsWith("collector-") || row.metadata?.content_type === "collector_card")
      .map(mapProductToExclusiveItem);

    return NextResponse.json({
      items,
      source: items.length ? "api" : "empty",
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("exclusive drops error:", err);
    return NextResponse.json({ items: [], source: "fallback", error: err.message });
  }
}
