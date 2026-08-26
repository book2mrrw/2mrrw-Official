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
import {
  assertSsrClientParity,
  commitCatalogSinglesDeterministic,
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

function commitBrowseSinglesIfChanged(setBrowseSingles, nextSingles, inlineSeed = []) {
  setBrowseSingles((prev) => {
    const committed = commitCatalogSinglesDeterministic(prev, nextSingles);
    if (!committed?.length && inlineSeed.length > 0) {
      return commitCatalogSinglesDeterministic(prev, inlineSeed);
    }
    return committed;
  });
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
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const catalogFetchAbort = useAbortController(catalogPage);
  const inlineSeedRef = useRef(stabilizedInlineSingles);
  const prevBrowseSinglesLenRef = useRef(0);
  const prevBrowseSinglesRef = useRef(browseSingles);
  const browseSinglesRef = useRef(browseSingles);

  useEffect(() => {
    inlineSeedRef.current = stabilizedInlineSingles;
    browseSinglesRef.current = browseSingles;
  }, [browseSingles, stabilizedInlineSingles]);

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
        logUiHydrationTrace("CATALOG_SURFACE_REFRESH", { catalogPage });
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

        if (!res.ok) {
          if (catalogPage === 1) {
            commitBrowseSinglesIfChanged(
              setBrowseSingles,
              stabilizedInlineSingles,
              inlineSeedRef.current
            );
          }
          setCatalogHasMore(false);
          setCatalogHasMoreFlag(false);
          return;
        }

        const tracks = Array.isArray(data.tracks) ? data.tracks : [];
        const useInline = data?.fallback === true || (catalogPage === 1 && tracks.length === 0);

        if (useInline) {
          if (catalogPage === 1) {
            commitBrowseSinglesIfChanged(
              setBrowseSingles,
              stabilizedInlineSingles,
              inlineSeedRef.current
            );
          }
          setCatalogHasMore(false);
          setCatalogHasMoreFlag(false);
          return;
        }

        const staticBySlug = new Map(inlineSingles.map((s) => [s.slug, s]));
        const prevBySlug = new Map(
          (browseSinglesRef.current || []).map((s) => [s.slug, s])
        );
        const incoming = tracks.map((t) => {
          const fb = staticBySlug.get(t?.slug);
          const prev = prevBySlug.get(t?.slug);
          return mergeCatalogTrackDeterministic(prev, t, fb);
        });
        setBrowseSingles((prev) => {
          const merged =
            catalogPage === 1
              ? [...stabilizedInlineSingles]
              : [...prev];
          const seen = new Set(merged.map((s) => s.slug));
          incoming.forEach((t) => {
            if (t?.slug && !seen.has(t.slug)) {
              seen.add(t.slug);
              merged.push(t);
            }
          });
          const committed = commitCatalogSinglesDeterministic(prev, merged);
          if (!committed?.length && inlineSeedRef.current.length > 0) {
            return commitCatalogSinglesDeterministic(prev, inlineSeedRef.current);
          }
          return committed;
        });
        const nextHasMore = Boolean(data.hasMore);
        setCatalogHasMore(nextHasMore);
        setCatalogHasMoreFlag(nextHasMore);
      } catch {
        if (!cancelled && catalogPage === 1) {
          commitBrowseSinglesIfChanged(
            setBrowseSingles,
            stabilizedInlineSingles,
            inlineSeedRef.current
          );
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
  }, [catalogPage, catalogFetchAbort.signal, inlineSingles, stabilizedInlineSingles]);

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
    if (!catalogHasMore || getCatalogLoading()) return;
    setCatalogPage((p) => p + 1);
  }, [catalogHasMore]);

  const displaySingles = browseSingles.length ? browseSingles : stabilizedInlineSingles;

  const displayFeatures = useMemo(
    () => stabilizeCatalogMediaDeterministic(inlineFeatures),
    [inlineFeatures]
  );

  const catalogPlaybackLookup = useMemo(
    () =>
      buildCatalogPlaybackLookup([
        ...inlineSingles,
        ...displaySingles,
        ...displayFeatures,
        ...inlineAlbums,
        ...inlineMixtapesAndEps,
      ]),
    [displaySingles, displayFeatures, inlineSingles, inlineAlbums, inlineMixtapesAndEps]
  );

  const value = useMemo(
    () => ({
      browseSingles,
      displaySingles,
      displayFeatures,
      catalogHasMore,
      catalogPage,
      loadMoreCatalog,
      catalogPlaybackLookup,
    }),
    [
      browseSingles,
      displaySingles,
      displayFeatures,
      catalogHasMore,
      catalogPage,
      loadMoreCatalog,
      catalogPlaybackLookup,
    ]
  );

  useLayoutEffect(() => {
    setCatalogSurfaceRef(value);
    if (displaySingles?.length) {
      commitStorefrontDisplaySingles(displaySingles);
    }
    setCatalogHasMoreFlag(catalogHasMore);
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
