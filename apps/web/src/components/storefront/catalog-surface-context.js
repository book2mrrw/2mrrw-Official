"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useLayoutEffect,
} from "react";
import {
  getCatalogLoading,
  setCatalogLoading,
  subscribeCatalogLoading,
} from "@/lib/storefront/catalog-loading-store";
import { setCatalogSurfaceRef } from "@/lib/storefront/catalog-surface-ref";
import { setCatalogHasMoreFlag } from "@/lib/storefront/catalog-has-more-store";
import { commitStorefrontDisplaySingles } from "@/lib/storefront/storefront-display-singles-store";
import { reconcileCanonicalCatalogPage } from "@/lib/storefront/catalog-page-reconcile";
import {
  getCatalogRefreshRevision,
  getCatalogRefreshServerRevision,
  subscribeCatalogRefresh,
} from "@/lib/storefront/catalog-refresh-store";
import {
  assertSsrClientParity,
  mergeCatalogTrackDeterministic,
  resolveMedia,
  stabilizeCatalogMediaDeterministic,
} from "@/lib/media/media-determinism";
import { buildCatalogPlaybackLookup } from "@/lib/music-playback";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
  recordPlaybackTraceContext,
} from "@/lib/diagnostics/playback-trace";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";
import { useAbortController } from "@/system/guards/useAbortController";

const CatalogSurfaceContext = createContext(null);

const RESOLVED_MEDIA_FIELDS = [
  "cover",
  "video",
  "visual",
  "preview",
  "baseCover",
  "coverArtType",
  "csAudio",
  "csCover",
];

function mergeCanonicalTrackWithFreshMetadata(prev, incoming, inlineFallback) {
  const deterministic = mergeCatalogTrackDeterministic(prev, incoming, inlineFallback);
  const merged = { ...deterministic, ...incoming };

  // The media resolver deliberately freezes stable URLs, but its cache is keyed
  // only by the media signature. Restore just those resolved media fields after
  // applying the fresh canonical row so title, price, dates, lyrics, and other
  // non-media mutations cannot be suppressed by that cache.
  for (const field of RESOLVED_MEDIA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(deterministic || {}, field)) {
      merged[field] = deterministic[field];
    }
  }
  return merged;
}

function reconcileFreshCatalogGroup(previous, incoming, inlineFallback) {
  const prevBySlug = new Map((previous || []).map((item) => [item.slug, item]));
  const fallbackBySlug = new Map((inlineFallback || []).map((item) => [item.slug, item]));
  return (Array.isArray(incoming) ? incoming : []).map((item) =>
    mergeCanonicalTrackWithFreshMetadata(
      prevBySlug.get(item?.slug),
      item,
      fallbackBySlug.get(item?.slug)
    )
  );
}

/**
 * Phase 17C — catalog fetch + derived playback lookup isolated from Page shell.
 * Phase 20G — stable media URLs on first paint; skip redundant page-1 rewrites.
 * Phase 20H — media determinism lock; freeze resolved URLs when identity unchanged.
 */
export function CatalogSurfaceProvider({
  initialSingles,
  inlineSingles,
  inlineFeatures,
  inlineAlbums = [],
  inlineMixtapesAndEps = [],
  children,
}) {
  const [stabilizedInlineSingles] = useState(() =>
    stabilizeCatalogMediaDeterministic(inlineSingles));

  const [browseSingles, setBrowseSingles] = useState(() => {
    const seed = initialSingles?.length ? initialSingles : inlineSingles;
    return stabilizeCatalogMediaDeterministic(seed);
  });
  const [browseFeatures, setBrowseFeatures] = useState(() =>
    stabilizeCatalogMediaDeterministic(inlineFeatures));
  const [browseAlbums, setBrowseAlbums] = useState(() =>
    stabilizeCatalogMediaDeterministic(inlineAlbums));
  const [browseMixtapesAndEps, setBrowseMixtapesAndEps] = useState(() =>
    stabilizeCatalogMediaDeterministic(inlineMixtapesAndEps));
  const catalogMutationRevision = useSyncExternalStore(
    subscribeCatalogRefresh,
    getCatalogRefreshRevision,
    getCatalogRefreshServerRevision
  );
  const [catalogRequest, setCatalogRequest] = useState(() => ({
    page: 1,
    revision: catalogMutationRevision,
  }));
  const catalogPage = catalogRequest.revision === catalogMutationRevision
    ? catalogRequest.page
    : 1;
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const catalogHasMoreForCurrentRevision =
    catalogRequest.revision === catalogMutationRevision && catalogHasMore;
  const catalogFetchAbort = useAbortController(
    `${catalogMutationRevision}:${catalogPage}`
  );
  const lastSnapshotRevisionRef = useRef(catalogMutationRevision);
  const prevBrowseSinglesLenRef = useRef(0);
  const prevBrowseSinglesRef = useRef(browseSingles);
  const browseSinglesRef = useRef(browseSingles);

  useEffect(() => {
    browseSinglesRef.current = browseSingles;
  }, [browseSingles]);

  useEffect(() => {
    if (lastSnapshotRevisionRef.current === catalogMutationRevision) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/catalog/releases?view=snapshot", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (cancelled || !response.ok || data?.fallback || !data?.catalog) return;
        const snapshot = data.catalog;
        setBrowseFeatures((previous) =>
          reconcileFreshCatalogGroup(previous, snapshot.features, inlineFeatures));
        setBrowseAlbums((previous) =>
          reconcileFreshCatalogGroup(previous, snapshot.albums, inlineAlbums));
        setBrowseMixtapesAndEps((previous) =>
          reconcileFreshCatalogGroup(previous, snapshot.mixtapes, inlineMixtapesAndEps));
        lastSnapshotRevisionRef.current = catalogMutationRevision;
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("[catalog-surface] targeted snapshot refresh failed", error?.message);
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [catalogMutationRevision, inlineFeatures, inlineAlbums, inlineMixtapesAndEps]);

  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    logUiHydrationTrace("PROVIDER_RECONSTRUCTED", { provider: "CatalogSurfaceProvider" });
  }, []);

  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    if (prevBrowseSinglesRef.current !== browseSingles) {
      logUiHydrationTrace("CATALOG_DATA_REPLACED", {
        count: browseSingles?.length ?? 0,
        catalogPage,
        catalogLoading: getCatalogLoading(),
      });
      prevBrowseSinglesRef.current = browseSingles;
    }
  }, [browseSingles, catalogPage]);

  useEffect(() => {
    if (!initialSingles?.length || !inlineSingles?.length) return;
    initialSingles.forEach((init) => {
      const inline = inlineSingles.find((s) => s.slug === init.slug);
      if (inline) {
        assertSsrClientParity(resolveMedia(init), resolveMedia(inline), {
          phase: "provider-init",
        });
      }
    });
  }, [initialSingles, inlineSingles]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isUiHydrationTraceEnabled()) {
        logUiHydrationTrace("CATALOG_SURFACE_REFRESH", {
          catalogPage,
          revision: catalogMutationRevision,
        });
      }
      setCatalogLoading(true);
      try {
        const res = await fetch(`/api/catalog/releases?page=${catalogPage}&limit=20`, {
          cache: "no-store",
          signal: catalogFetchAbort.signal,
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        if (cancelled) return;

        if (!res.ok || data?.fallback === true) {
          // The mounted SSR/static seed is the initial degraded fallback. Once
          // a canonical snapshot has loaded, retain that last-known-good state
          // rather than resurrecting an older seed during a transient outage.
          setCatalogHasMore(false);
          setCatalogHasMoreFlag(false);
          return;
        }

        const tracks = Array.isArray(data.tracks) ? data.tracks : [];
        const staticBySlug = new Map(inlineSingles.map((s) => [s.slug, s]));
        const prevBySlug = new Map(
          (browseSinglesRef.current || []).map((s) => [s.slug, s])
        );
        const incoming = tracks.map((t) => {
          const fb = staticBySlug.get(t?.slug);
          const prev = prevBySlug.get(t?.slug);
          return mergeCanonicalTrackWithFreshMetadata(prev, t, fb);
        });
        // A successful page-one response is authoritative even when empty.
        // Replacement (rather than SSR-seed merging) makes archive/removal
        // visible immediately in an already-mounted provider.
        setBrowseSingles((prev) =>
          reconcileCanonicalCatalogPage(prev, incoming, catalogPage)
        );
        setCatalogRequest((current) => (
          current.revision === catalogMutationRevision && current.page === catalogPage
            ? current
            : { page: catalogPage, revision: catalogMutationRevision }
        ));
        const nextHasMore = Boolean(data.hasMore);
        setCatalogHasMore(nextHasMore);
        setCatalogHasMoreFlag(nextHasMore);
      } catch {
        if (!cancelled && catalogPage === 1) {
          setCatalogHasMore(false);
          setCatalogHasMoreFlag(false);
        }
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
          if (isUiHydrationTraceEnabled() && catalogPage === 1) {
            logUiHydrationTrace("CATALOG_LOADING_COMPLETE", { catalogPage });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    catalogPage,
    catalogFetchAbort.signal,
    catalogMutationRevision,
    inlineSingles,
  ]);

  useEffect(() => {
    if (!isPlaybackTraceEnabled()) return;
    const len = browseSingles?.length ?? 0;
    const loading = getCatalogLoading();
    if (len !== prevBrowseSinglesLenRef.current || loading) {
      prevBrowseSinglesLenRef.current = len;
      recordPlaybackTraceContext({ lastCatalogRenderAt: Date.now() });
      logUiChurn("catalog-rerender", {
        catalogPage,
        singlesCount: len,
        catalogLoading: loading,
      });
    }
  }, [browseSingles, catalogPage]);

  const loadMoreCatalog = useCallback(() => {
    if (!catalogHasMoreForCurrentRevision || getCatalogLoading()) return;
    setCatalogRequest({ page: catalogPage + 1, revision: catalogMutationRevision });
  }, [catalogHasMoreForCurrentRevision, catalogMutationRevision, catalogPage]);

  // `browseSingles` starts with the SSR/static fallback. After a successful
  // canonical read it may legitimately be empty; never reinterpret empty as a
  // reason to resurrect the stale seed.
  const displaySingles = browseSingles;

  const displayFeatures = browseFeatures;
  const displayAlbums = browseAlbums;
  const displayMixtapesAndEps = browseMixtapesAndEps;

  const catalogPlaybackLookup = useMemo(
    () =>
      buildCatalogPlaybackLookup([
        ...displaySingles,
        ...displayFeatures,
        ...displayAlbums,
        ...displayMixtapesAndEps,
      ]),
    [displaySingles, displayFeatures, displayAlbums, displayMixtapesAndEps]
  );

  const value = useMemo(
    () => ({
      browseSingles,
      displaySingles,
      displayFeatures,
      displayAlbums,
      displayMixtapesAndEps,
      catalogHasMore: catalogHasMoreForCurrentRevision,
      catalogPage,
      loadMoreCatalog,
      catalogPlaybackLookup,
    }),
    [
      browseSingles,
      displaySingles,
      displayFeatures,
      displayAlbums,
      displayMixtapesAndEps,
      catalogHasMoreForCurrentRevision,
      catalogPage,
      loadMoreCatalog,
      catalogPlaybackLookup,
    ]
  );

  useLayoutEffect(() => {
    setCatalogSurfaceRef(value);
    commitStorefrontDisplaySingles(displaySingles);
    setCatalogHasMoreFlag(catalogHasMoreForCurrentRevision);
  });

  return (
    <CatalogSurfaceContext.Provider value={value}>
      {children}
    </CatalogSurfaceContext.Provider>
  );
}

export function useCatalogSurface() {
  const ctx = useContext(CatalogSurfaceContext);
  if (!ctx) {
    throw new Error("useCatalogSurface must be used within CatalogSurfaceProvider");
  }
  return ctx;
}

/** Phase R1/P7 — skeleton/load-more only; cards must not subscribe to this. */
export function useCatalogLoading() {
  return useSyncExternalStore(subscribeCatalogLoading, getCatalogLoading, getCatalogLoading);
}
