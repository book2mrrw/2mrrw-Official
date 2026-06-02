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
import { withR2CatalogMedia } from "@/components/home/catalogMedia";
import { buildCatalogPlaybackLookup } from "@/lib/music-playback";
import {
  isPlaybackTraceEnabled,
  logUiChurn,
  recordPlaybackTraceContext,
} from "@/lib/diagnostics/playback-trace";
import { useAbortController } from "@/system/guards/useAbortController";

const CatalogSurfaceContext = createContext(null);

/**
 * Phase 17C — catalog fetch + derived playback lookup isolated from Page shell.
 * Updates here do not require Page to own catalogLoading/browseSingles useState.
 */
export function CatalogSurfaceProvider({
  initialSingles,
  inlineSingles,
  inlineFeatures,
  inlineAlbums = [],
  inlineMixtapesAndEps = [],
  children,
}) {
  const [browseSingles, setBrowseSingles] = useState(initialSingles);
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
            setBrowseSingles(inlineSingles.map((s) => withR2CatalogMedia(s)));
          }
          setCatalogHasMore(false);
          return;
        }

        const tracks = Array.isArray(data.tracks) ? data.tracks : [];
        const useInline = data?.fallback === true || (catalogPage === 1 && tracks.length === 0);

        if (useInline) {
          if (catalogPage === 1) {
            setBrowseSingles(inlineSingles.map((s) => withR2CatalogMedia(s)));
          }
          setCatalogHasMore(false);
          return;
        }

        const staticBySlug = new Map(inlineSingles.map((s) => [s.slug, s]));
        const incoming = tracks.map((t) => {
          const fb = staticBySlug.get(t?.slug);
          const merged = fb
            ? {
                ...fb,
                ...t,
                preview: t.preview || fb.preview,
                video: t.video || fb.video,
                cover: t.cover || fb.cover,
              }
            : t;
          return withR2CatalogMedia(merged);
        });
        setBrowseSingles((prev) => {
          const merged =
            catalogPage === 1 ? [...inlineSingles.map((s) => withR2CatalogMedia(s))] : [...prev];
          const seen = new Set(merged.map((s) => s.slug));
          incoming.forEach((t) => {
            if (t?.slug && !seen.has(t.slug)) {
              seen.add(t.slug);
              merged.push(t);
            }
          });
          return merged;
        });
        setCatalogHasMore(Boolean(data.hasMore));
      } catch {
        if (!cancelled && catalogPage === 1) {
          setBrowseSingles(inlineSingles.map((s) => withR2CatalogMedia(s)));
          setCatalogHasMore(false);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogPage, catalogFetchAbort.signal, inlineSingles]);

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

  const displaySingles = browseSingles.length ? browseSingles : inlineSingles;

  const displayFeatures = useMemo(
    () => inlineFeatures.map((feat) => withR2CatalogMedia(feat)),
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
