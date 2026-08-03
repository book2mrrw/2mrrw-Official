"use client";

/**
 * Phase P7 — imperative catalog snapshot for Page shell callbacks without
 * useCatalogSurface() subscription on PageStorefront.
 */

const EMPTY_CATALOG_SURFACE_REF = {
  browseSingles: [],
  displaySingles: [],
  displayFeatures: [],
  catalogHasMore: false,
  catalogPage: 1,
  loadMoreCatalog: () => {},
  catalogPlaybackLookup: { bySlug: new Map() },
};

/** @type {{ current: typeof EMPTY_CATALOG_SURFACE_REF }} */
export const catalogSurfaceRef = { current: EMPTY_CATALOG_SURFACE_REF };

export function getCatalogSurfaceRef() {
  return catalogSurfaceRef.current;
}

/**
 * @param {Partial<typeof EMPTY_CATALOG_SURFACE_REF>} snapshot
 */
export function setCatalogSurfaceRef(snapshot) {
  catalogSurfaceRef.current = { ...EMPTY_CATALOG_SURFACE_REF, ...snapshot };
}
