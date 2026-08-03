import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";
import { getProductCatalog } from "../src/lib/commerce/catalog.js";
import { getCanonicalTrackRows } from "../src/lib/media/canonical-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const PRODUCT_CATALOG = getProductCatalog();
const rows = PRODUCT_CATALOG.map((p) => ({
  slug: p.slug,
  title: p.title,
  display_title: p.display_title || p.title,
  product_type: p.product_type,
  price_cents: p.price_cents,
  cover_url: p.cover_url,
  storage_path: p.storage_path || null,
  preview_path: p.preview_path || null,
  artwork_path: p.artwork_path || null,
  video_path: p.video_path || null,
  release_date: p.release_date || null,
  metadata: p.metadata || {},
  active: true,
}));

const { data, error } = await admin.from("products").upsert(rows, { onConflict: "slug" }).select("slug");
if (error) {
  console.error("Seed failed:", error.message);
  process.exit(1);
}
console.log("Seeded", data.length, "products");

const trackRows = getCanonicalTrackRows();
const { error: trackError } = await admin
  .from("catalog_tracks")
  .upsert(trackRows, { onConflict: "album_slug,slug" });
if (trackError) {
  console.error("Catalog tracks seed failed:", trackError.message);
  process.exit(1);
}
console.log("Seeded", trackRows.length, "catalog_tracks");

const catalogSlugs = new Set(PRODUCT_CATALOG.map((p) => p.slug));
const { data: activeRows, error: countError } = await admin
  .from("products")
  .select("slug, cover_url, active")
  .eq("active", true);

if (countError) {
  console.error("Verify failed:", countError.message);
  process.exit(1);
}

const activeCount = activeRows?.length ?? 0;
console.log("Active products in DB:", activeCount);

const missingFromDb = [...catalogSlugs].filter((s) => !activeRows.some((r) => r.slug === s));
const extraActive = (activeRows || []).filter((r) => !catalogSlugs.has(r.slug));
const coverMismatches = PRODUCT_CATALOG.filter((p) => {
  const row = activeRows?.find((r) => r.slug === p.slug);
  return row && row.cover_url !== p.cover_url;
}).map((p) => ({
  slug: p.slug,
  expected: p.cover_url,
  actual: activeRows.find((r) => r.slug === p.slug)?.cover_url,
}));

if (activeCount !== 20) {
  console.warn("MISMATCH: expected 20 active rows, got", activeCount);
}
if (missingFromDb.length) {
  console.warn("MISMATCH: catalog slugs missing from active products:", missingFromDb);
}
if (extraActive.length) {
  console.warn("MISMATCH: extra active products not in catalog:", extraActive.map((r) => r.slug));
}
if (coverMismatches.length) {
  console.warn("MISMATCH: cover_url differs from catalog:", coverMismatches);
}

const { data: digitalSlugs, error: digitalError } = await admin
  .from("products")
  .select("slug")
  .like("slug", "%-digital");

if (digitalError) {
  console.error("Digital slug query failed:", digitalError.message);
} else {
  const slugs = (digitalSlugs || []).map((r) => r.slug);
  console.log("Production slugs LIKE %-digital:", slugs.length ? slugs : "(none)");
}
