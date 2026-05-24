import { PRODUCT_CATALOG } from "@/lib/commerce/catalog";

/** Ordered slug candidates: canonical catalog slug first, then legacy `-digital` suffix. */
export function storefrontProductSlugCandidates(releaseSlug) {
  const raw = String(releaseSlug || "").trim();
  if (!raw) return [];

  const candidates = [];
  const add = (s) => {
    if (s && !candidates.includes(s)) candidates.push(s);
  };

  add(raw);
  if (raw.endsWith("-digital")) {
    add(raw.slice(0, -"-digital".length));
  } else {
    add(`${raw}-digital`);
  }
  if (raw.endsWith("-vinyl")) {
    add(raw.slice(0, -"-vinyl".length));
  }

  return candidates;
}

/** Map UI release type → `products.product_type`. */
export function releaseTypeToProductType(releaseType) {
  const t = String(releaseType || "").toLowerCase();
  if (t === "album" || t === "ep") return t === "ep" ? "ep" : "album";
  if (t === "deluxe") return "deluxe";
  if (t === "feature") return "feature";
  if (t === "vinyl") return "vinyl";
  if (t === "bundle" || t === "merch" || t === "vault") return t;
  return "single";
}

/** Map release / product type → `gifts.item_type` constraint. */
export function releaseTypeToGiftItemType(releaseType, productType) {
  const pt = String(productType || releaseTypeToProductType(releaseType)).toLowerCase();
  if (pt === "album") return "album";
  if (pt === "ep") return "ep";
  if (pt === "deluxe") return "deluxe";
  if (pt === "collector_card" || pt === "vault") return "collector_card";
  return "single";
}

function catalogEntryForSlug(slug) {
  return PRODUCT_CATALOG.find((p) => p.slug === slug) || null;
}

/**
 * Resolve a storefront `products` row from release slug, optional product id, and type.
 * @returns {{ product: object|null, steps: object[] }}
 */
export async function resolveStorefrontProduct(
  admin,
  { slug, productId, releaseType } = {}
) {
  const steps = [];

  if (productId) {
    steps.push({ step: "lookup_by_id", productId });
    const { data, error } = await admin
      .from("products")
      .select("id, slug, title, cover_url, product_type, active")
      .eq("id", productId)
      .maybeSingle();
    if (error) throw error;
    if (data && data.active !== false) {
      steps.push({ step: "lookup_by_id", hit: true, slug: data.slug });
      return { product: data, steps };
    }
    steps.push({ step: "lookup_by_id", hit: false });
  }

  const candidates = storefrontProductSlugCandidates(slug);
  if (!candidates.length) {
    steps.push({ step: "slug_candidates", error: "empty_slug" });
    return { product: null, steps };
  }

  steps.push({ step: "slug_candidates", candidates });

  const { data: rows, error } = await admin
    .from("products")
    .select("id, slug, title, cover_url, product_type, active")
    .in("slug", candidates);

  if (error) throw error;

  const activeRows = (rows || []).filter((p) => p.active !== false);
  const bySlug = new Map(activeRows.map((p) => [p.slug, p]));
  const expectedType = releaseType ? releaseTypeToProductType(releaseType) : null;

  for (const candidate of candidates) {
    const hit = bySlug.get(candidate);
    if (!hit) continue;
    if (expectedType && hit.product_type !== expectedType) {
      steps.push({
        step: "slug_type_mismatch",
        slug: candidate,
        expectedType,
        productType: hit.product_type,
      });
      continue;
    }
    steps.push({ step: "slug_match", slug: candidate, productType: hit.product_type });
    return { product: hit, steps };
  }

  for (const candidate of candidates) {
    const hit = bySlug.get(candidate);
    if (hit) {
      steps.push({ step: "slug_fallback", slug: candidate, productType: hit.product_type });
      return { product: hit, steps };
    }
  }

  const catalogHints = candidates.map((c) => catalogEntryForSlug(c)).filter(Boolean);
  steps.push({
    step: "not_found",
    tried: candidates,
    catalogKnown: catalogHints.map((c) => c.slug),
  });

  return { product: null, steps };
}

/** Gift send / claim — same resolver, clearer export name. */
export async function resolveGiftProduct(admin, release = {}) {
  return resolveStorefrontProduct(admin, {
    slug: release.slug || release.releaseSlug,
    productId: release.productId || release.product_id,
    releaseType: release.type || release.releaseType,
  });
}
