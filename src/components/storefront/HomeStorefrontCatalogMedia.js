"use client";

import { memo, useEffect, useRef, useSyncExternalStore } from "react";
import LatestSinglesStyleRow from "@/components/home/LatestSinglesStyleRow";
import FeaturesRail from "@/components/home/FeaturesRail";
import CatalogGrid from "@/components/home/CatalogGrid";
import {
  LiveCountdownDesktopPanel,
  LiveCountdownMobileHomeStrip,
} from "@/components/home/LiveCountdownDisplays";
import { TrackCardSkeleton } from "@/ui/skeletons";
import { useCatalogLoading } from "@/components/storefront/catalog-surface-context";
import { getCatalogSurfaceRef } from "@/lib/storefront/catalog-surface-ref";
import {
  getStorefrontDisplaySingles,
  subscribeStorefrontDisplaySingles,
} from "@/lib/storefront/storefront-display-singles-store";
import {
  getCatalogHasMore,
  subscribeCatalogHasMore,
} from "@/lib/storefront/catalog-has-more-store";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";

const CatalogLatestSinglesLoadingExtras = memo(function CatalogLatestSinglesLoadingExtras({
  onLoadMoreCatalog,
}) {
  const catalogLoading = useCatalogLoading();
  const catalogHasMore = useSyncExternalStore(
    subscribeCatalogHasMore,
    getCatalogHasMore,
    getCatalogHasMore
  );
  return (
    <>
      {catalogLoading ? (
        <>
          <TrackCardSkeleton />
          <TrackCardSkeleton />
        </>
      ) : null}
      {catalogHasMore ? (
        <button
          type="button"
          onClick={onLoadMoreCatalog}
          disabled={catalogLoading}
          style={{
            marginTop: 12,
            padding: "10px 18px",
            background: "transparent",
            border: "1px solid #333",
            color: "#888",
            borderRadius: 8,
            cursor: catalogLoading ? "default" : "pointer",
            fontSize: 12,
            letterSpacing: 1.5,
          }}
        >
          {catalogLoading ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </>
  );
});

function useStorefrontDisplaySingles() {
  return useSyncExternalStore(
    subscribeStorefrontDisplaySingles,
    getStorefrontDisplaySingles,
    getStorefrontDisplaySingles
  );
}

function homeCatalogMediaPropsEqual(prev, next) {
  const keys = [
    "isMobile",
    "singlesRowRef",
    "onGift",
    "onCardClick",
    "addToCart",
    "onLibraryChange",
    "onOpenFeature",
    "albums",
    "hoverIn",
    "hoverOut",
    "buttonHoverIn",
    "buttonHoverOut",
    "onAlbumClick",
    "onPlayAlbum",
    "onOpenAlbumTracklist",
    "mixtapesAndEps",
    "onPlayMixtapeEp",
    "onPlaySingle",
    "onPlayFeature",
    "liveStreamDate",
    "liveStreamTime",
  ];
  for (const key of keys) {
    if (prev[key] !== next[key]) return false;
  }
  return true;
}

/**
 * Phase P7/P9 — catalog media isolated from Page shell and post-load auth/catalog waves.
 * Singles pinned by media signature; entitlement chrome via storefront-card-chrome-store.
 */
const HomeStorefrontCatalogMedia = memo(function HomeStorefrontCatalogMedia({
  isMobile,
  singlesRowRef,
  onGift,
  onCardClick,
  addToCart,
  onLibraryChange,
  onOpenFeature,
  albums,
  hoverIn,
  hoverOut,
  buttonHoverIn,
  buttonHoverOut,
  onAlbumClick,
  onPlayAlbum,
  onOpenAlbumTracklist,
  mixtapesAndEps,
  onPlayMixtapeEp,
  onPlaySingle,
  onPlayFeature,
  liveStreamDate,
  liveStreamTime,
}) {
  const pinnedSingles = useStorefrontDisplaySingles();
  const surface = getCatalogSurfaceRef();
  const displaySingles = pinnedSingles.length
    ? pinnedSingles
    : surface.displaySingles;
  const prevDisplaySinglesRef = useRef(displaySingles);
  const displayFeatures = surface.displayFeatures;
  const loadMoreCatalog = surface.loadMoreCatalog;
  const catalogPlaybackLookup = surface.catalogPlaybackLookup;

  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    const prev = prevDisplaySinglesRef.current;
    if (prev !== displaySingles) {
      logUiHydrationTrace("STORE_FRONT_REBUILD", {
        prevCount: prev?.length ?? 0,
        nextCount: displaySingles?.length ?? 0,
        phase: "p9-pinned-singles",
      });
      prevDisplaySinglesRef.current = displaySingles;
    }
  }, [displaySingles]);

  return (
    <>
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 18, alignItems: "flex-start" }}>
        <div style={{ flex: 1, width: "100%", minWidth: 0 }}>
          <LatestSinglesStyleRow
            ref={singlesRowRef}
            items={displaySingles}
            isMobile={isMobile}
            onGift={onGift}
            onCardClick={onCardClick}
            onPlayClick={onPlaySingle}
            addToCart={addToCart}
            onLibraryChange={onLibraryChange}
            source="home_single_card"
            cardMedia="video"
          />
          <CatalogLatestSinglesLoadingExtras onLoadMoreCatalog={loadMoreCatalog} />
        </div>

        {!isMobile ? (
          <LiveCountdownDesktopPanel liveStreamDate={liveStreamDate} liveStreamTime={liveStreamTime} />
        ) : null}
      </div>

      {isMobile ? <LiveCountdownMobileHomeStrip /> : null}

      <div style={{ marginTop: 28, marginBottom: 4 }}>
        <h2 className="section-heading" style={{ marginBottom: 14 }}>Features</h2>
        <FeaturesRail
          features={displayFeatures}
          isMobile={isMobile}
          addToCart={addToCart}
          onOpenFeature={onOpenFeature}
          onGift={onGift}
          onLibraryChange={onLibraryChange}
          onPlayClick={onPlayFeature}
        />
      </div>

      <div style={{ margin: "0 0 24px", height: 1, background: "#1a1a1a" }} />

      <div id="home-albums">
        <h2 className="section-heading" style={{ marginBottom: 16 }}>Albums</h2>
        <CatalogGrid
          items={albums}
          type="albums"
          addToCart={addToCart}
          hoverIn={hoverIn}
          hoverOut={hoverOut}
          buttonHoverIn={buttonHoverIn}
          buttonHoverOut={buttonHoverOut}
          onCardClick={onAlbumClick}
          onPlayAlbum={onPlayAlbum}
          onOpenAlbumTracklist={onOpenAlbumTracklist}
          catalogPlaybackLookup={catalogPlaybackLookup}
          isMobile={isMobile}
          onGift={onGift}
          onLibraryChange={onLibraryChange}
        />
      </div>

      <div id="home-mixtapes-eps" style={{ marginTop: 28 }}>
        <h2 className="section-heading" style={{ marginBottom: 14 }}>Mixtapes &amp; EPs</h2>
        <div style={{ flex: 1, width: "100%", minWidth: 0 }}>
          <LatestSinglesStyleRow
            items={mixtapesAndEps}
            isMobile={isMobile}
            onGift={onGift}
            onCardClick={onAlbumClick}
            onPlayClick={onPlayMixtapeEp}
            addToCart={addToCart}
            onLibraryChange={onLibraryChange}
            source="home_mixtape_ep_card"
            cardMedia="cover"
          />
        </div>
      </div>
    </>
  );
}, homeCatalogMediaPropsEqual);

export default HomeStorefrontCatalogMedia;
