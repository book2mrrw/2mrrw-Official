/** Canonical product catalog — sync to `products` + `catalog_tracks` via seed script or migration. */
import { getCanonicalProductRows } from "@/lib/media/canonical-catalog";

/** Non-digital commerce rows (vinyl, vault, merch) — unchanged from storefront baseline. */
const COMMERCE_EXTRAS = [
  { slug: "tbh-vinyl", title: "T.B.H. – Vinyl", product_type: "vinyl", price_cents: 4799, cover_url: "/images/albums/tbh.jpg" },
  { slug: "ad-vinyl", title: "(A.D) – Vinyl", product_type: "vinyl", price_cents: 4799, cover_url: "/images/albums/ad.jpg" },
  { slug: "love-hz-vinyl", title: "Love Hz Vol.1 – Vinyl", product_type: "vinyl", price_cents: 4799, cover_url: "/images/albums/lovehz.jpg" },
  { slug: "exc-card-tbh", title: "T.B.H. Collector Art Card", product_type: "vault", price_cents: 8999, cover_url: "/images/albums/tbh.jpg" },
  { slug: "exc-card-ad", title: "2MRRW: (A.D) Collector Card", product_type: "vault", price_cents: 9999, cover_url: "/images/albums/ad.jpg" },
  { slug: "exc-card-lovehz", title: "Love Hz Vol.1 Collector Card", product_type: "vault", price_cents: 12999, cover_url: "/images/albums/lovehz.jpg" },
  { slug: "exc-bundle-lovehz", title: "Love Hz Vol.1 Launch Bundle", product_type: "bundle", price_cents: 14999, cover_url: "/images/albums/lovehz.jpg" },
  { slug: "exc-signed-vinyl", title: "Signed Vinyl — T.B.H.", product_type: "vault", price_cents: 7499, cover_url: "/images/albums/tbh.jpg" },
  { slug: "hoodie", title: "2MRRW HOODIE", product_type: "merch", price_cents: 5999, cover_url: "/images/merch/hoodie.jpg" },
  { slug: "shirt", title: "2MRRW T-SHIRT", product_type: "merch", price_cents: 2999, cover_url: "/images/merch/shirt.jpg" },
  { slug: "hat", title: "2MRRW HAT", product_type: "merch", price_cents: 2499, cover_url: "/images/merch/hat.jpg" },
];

let productCatalogCache = null;

/** Lazy product catalog — use getProductCatalog() to avoid TDZ during module init. */
export function getProductCatalog() {
  if (!productCatalogCache) {
    productCatalogCache = Object.freeze([...getCanonicalProductRows(), ...COMMERCE_EXTRAS]);
  }
  return productCatalogCache;
}

export function slugFromCartItem(item) {
  return item?.slug || null;
}
