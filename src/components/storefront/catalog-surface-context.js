"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  catalogSinglesMediaEqual,
  mergeCatalogTrackWithInline,
  stabilizeCatalogMediaList,
  withR2CatalogMedia,
} from "@/lib/media/r2-catalog-media";
import { buildCatalogPlaybackLookup } from "@/lib/music-playback";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
  recordPlaybackTraceContext,
} from "@/lib/diagnostics/playback-trace";
import { useAbortController } from "@/system/guards/useAbortController";

const CatalogSurfaceContext = createContext(null);

function commitBrowseSinglesIfChanged(setBrowseSingles, nextSingles) {
  setBrowseSingles((prev) =>
    catalogSinglesMediaEqual(prev, nextSingles) ? prev : nextSingles
  );
}

/**
 * Phase 17C — catalog fetch + derived playback lookup isolated from Page shell.
 * Phase 20G — stable media URLs on first paint; skip redundant page-1 rewrites.
 */
export function CatalogSurfaceProvider({
  initialSingles,
  inlineSingles,
  inlineFeatures,
  inlineAlbums = [],
  inlineMixtapesAndEps = [],
  children,
}) {
  const inlineSinglesStableRef = useRef(null);
  if (!inlineSinglesStableRef.current) {
    inlineSinglesStableRef.current = stabilizeCatalogMediaList(inlineSingles);
  }
  const stabilizedInlineSingles = inlineSinglesStableRef.current;

  const [browseSingles, setBrowseSingles] = useState(() => {
    const seed = initialSingles?.length ? initialSingles : inlineSingles;
    return stabilizeCatalogMediaList(seed);
  });
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogHasMore, setCatalogHasMore] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const catalogFetchAbort = useAbortController([catalogPage]);
  const prevBrowseSinglesLenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
            commitBrowseSinglesIfChanged(setBrowseSingles, stabilizedInlineSingles);
          }
          setCatalogHasMore(false);
          return;
        }

        const tracks = Array.isArray(data.tracks) ? data.tracks : [];
        const useInline = data?.fallback === true || (catalogPage === 1 && tracks.length === 0);

        if (useInline) {
          if (catalogPage === 1) {
            commitBrowseSinglesIfChanged(setBrowseSingles, stabilizedInlineSingles);
          }
          setCatalogHasMore(false);
          return;
        }

        const staticBySlug = new Map(inlineSingles.map((s) => [s.slug, s]));
        const incoming = tracks.map((t) => {
          const fb = staticBySlug.get(t?.slug);
          const merged = fb ? mergeCatalogTrackWithInline(fb, t) : t;
          return withR2CatalogMedia(merged);
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
          return catalogSinglesMediaEqual(prev, merged) ? prev : merged;
        });
        setCatalogHasMore(Boolean(data.hasMore));
      } catch {
        if (!cancelled && catalogPage === 1) {
          commitBrowseSinglesIfChanged(setBrowseSingles, stabilizedInlineSingles);
          setCatalogHasMore(false);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogPage, catalogFetchAbort.signal, inlineSingles, stabilizedInlineSingles]);

  useEffect(() => {
    if (!isPlaybackTraceEnabled()) return;
    const len = browseSingles?.length ?? 0;
    if (len !== prevBrowseSinglesLenRef.current || catalogLoading) {
      prevBrowseSinglesLenRef.current = len;
      recordPlaybackTraceContext({ lastCatalogRenderAt: Date.now() });
      logUiChurn("catalog-rerender", {
        catalogPage,
        singlesCount: len,
        catalogLoading,
      });
    }
  }, [browseSingles, catalogPage, catalogLoading]);

  const loadMoreCatalog = useCallback(() => {
    if (!catalogHasMore || catalogLoading) return;
    setCatalogPage((p) => p + 1);
  }, [catalogHasMore, catalogLoading]);

  const displaySingles = browseSingles.length ? browseSingles : stabilizedInlineSingles;

  const displayFeatures = useMemo(
    () => stabilizeCatalogMediaList(inlineFeatures),
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
      catalogLoading,
      catalogHasMore,
      catalogPage,
      loadMoreCatalog,
      catalogPlaybackLookup,
    }),
    [
      browseSingles,
      displaySingles,
      displayFeatures,
      catalogLoading,
      catalogHasMore,
      catalogPage,
      loadMoreCatalog,
      catalogPlaybackLookup,
    ]
  );

  return (
    <CatalogSurfaceContext.Provider value={value}>{children}</CatalogSurfaceContext.Provider>
  );
}

export function useCatalogSurface() {
  const ctx = useContext(CatalogSurfaceContext);
  if (!ctx) {
    throw new Error("useCatalogSurface must be used within CatalogSurfaceProvider");
  }
  return ctx;
}
