import { getAdminClient } from "@/lib/supabase/admin";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://2mrrw.com";

export default async function sitemap() {
  const staticRoutes = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
  ];

  try {
    const admin = getAdminClient();
    const { data: products } = await admin
      .from("products")
      .select("slug, product_type, updated_at")
      .eq("active", true);

    const SONG_TYPES = new Set(["single"]);
    const ALBUM_TYPES = new Set(["album", "ep"]);
    const FEATURE_TYPES = new Set(["feature"]);

    const productRoutes = (products || [])
      .filter((p) => {
        const t = String(p.product_type || "").toLowerCase();
        return SONG_TYPES.has(t) || ALBUM_TYPES.has(t) || FEATURE_TYPES.has(t);
      })
      .map((p) => {
        const type = String(p.product_type || "").toLowerCase();
        const section = SONG_TYPES.has(type) ? "song" : FEATURE_TYPES.has(type) ? "feature" : "album";
        return {
          url: `${BASE_URL}/${section}/${p.slug}`,
          lastModified: p.updated_at ? new Date(p.updated_at) : new Date(),
          changeFrequency: "monthly",
          priority: 0.7,
        };
      });

    return [...staticRoutes, ...productRoutes];
  } catch {
    return staticRoutes;
  }
}
