/**
 * Reconcile an authoritative catalog page.
 *
 * Page one is a replacement boundary, not a merge boundary. That invariant is
 * what allows a mounted storefront to observe archives and an authoritative
 * empty catalog. Later pages append only identities not already present.
 */
export function reconcileCanonicalCatalogPage(current, incoming, page) {
  const nextPage = Array.isArray(incoming) ? incoming : [];
  if (page === 1) return [...nextPage];

  const currentItems = Array.isArray(current) ? current : [];
  const merged = [...currentItems];
  const seen = new Set(currentItems.map((item) => item?.slug).filter(Boolean));
  let appended = false;

  for (const item of nextPage) {
    if (!item?.slug || seen.has(item.slug)) continue;
    seen.add(item.slug);
    merged.push(item);
    appended = true;
  }

  return appended ? merged : currentItems;
}
