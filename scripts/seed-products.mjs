import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const CATALOG = [
  { slug: "hour-glass", title: "Hour Glass", product_type: "single", price_cents: 299, cover_url: "/images/singles/hourglass.jpg", storage_path: "singles/hour-glass/audio.mp3" },
  { slug: "w2d", title: "W.2.D", product_type: "single", price_cents: 299, cover_url: "/images/singles/w2d.jpg", storage_path: "singles/w2d/audio.mp3" },
  { slug: "artificial", title: "Artificial", product_type: "single", price_cents: 299, cover_url: "/images/singles/artificial.jpg", storage_path: "singles/artificial/audio.mp3" },
  { slug: "turnt-me-2-dis", title: "Turnt Me 2 Dis", product_type: "single", price_cents: 299, cover_url: "/images/singles/turnt.jpg", storage_path: "singles/turnt-me-2-dis/audio.mp3" },
  { slug: "i-dont-believe-you", title: "I Don't Believe You", product_type: "feature", price_cents: 299, cover_url: "/images/features/idbu.jpg", preview_path: "/audio/previews/i-dont-believe-you-preview.wav" },
  { slug: "2-heavy", title: "2 Heavy", product_type: "feature", price_cents: 299, cover_url: "/images/features/2heavy.jpg", preview_path: "/audio/previews/2-heavy-preview.wav" },
  { slug: "tbh", title: "T.B.H.", product_type: "album", price_cents: 999, cover_url: "/images/albums/tbh.jpg" },
  { slug: "ad", title: "(A.D)", product_type: "album", price_cents: 999, cover_url: "/images/albums/ad.jpg" },
  { slug: "love-hz", title: "Love Hz Vol.1", product_type: "album", price_cents: 1299, cover_url: "/images/albums/lovehz.jpg" },
  { slug: "tbh-vinyl", title: "T.B.H. – Vinyl", product_type: "vinyl", price_cents: 4799, cover_url: "/images/albums/tbh.jpg" },
  { slug: "ad-vinyl", title: "(A.D) – Vinyl", product_type: "vinyl", price_cents: 4799, cover_url: "/images/albums/ad.jpg" },
  { slug: "love-hz-vinyl", title: "Love Hz Vol.1 – Vinyl", product_type: "vinyl", price_cents: 4799, cover_url: "/images/albums/lovehz.jpg" },
  { slug: "exc-card-tbh", title: "T.B.H. Collector Art Card", product_type: "vault", price_cents: 8999, cover_url: "/images/albums/tbh.jpg" },
  { slug: "exc-card-ad", title: "2MRRW: (A.D) Collector Card", product_type: "vault", price_cents: 9999, cover_url: "/images/albums/ad.jpg" },
  { slug: "exc-bundle-lovehz", title: "Love Hz Vol.1 Launch Bundle", product_type: "bundle", price_cents: 14999, cover_url: "/images/albums/lovehz.jpg" },
  { slug: "exc-signed-vinyl", title: "Signed Vinyl — T.B.H.", product_type: "vault", price_cents: 7499, cover_url: "/images/albums/tbh.jpg" },
  { slug: "hoodie", title: "2MRRW HOODIE", product_type: "merch", price_cents: 5999, cover_url: "/images/merch/hoodie.jpg" },
  { slug: "shirt", title: "2MRRW T-SHIRT", product_type: "merch", price_cents: 2999, cover_url: "/images/merch/shirt.jpg" },
  { slug: "hat", title: "2MRRW HAT", product_type: "merch", price_cents: 2499, cover_url: "/images/merch/hat.jpg" },
];

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const rows = CATALOG.map((p) => ({ ...p, active: true }));

const { data, error } = await admin.from("products").upsert(rows, { onConflict: "slug" }).select("slug");
if (error) {
  console.error("Seed failed:", error.message);
  process.exit(1);
}
console.log("Seeded", data.length, "products");
