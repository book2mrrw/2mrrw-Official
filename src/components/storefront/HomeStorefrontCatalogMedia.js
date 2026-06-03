"use client";

import { memo, useEffect, useRef } from "react";
import LatestSinglesStyleRow from "@/components/home/LatestSinglesStyleRow";
import FeaturesRail from "@/components/home/FeaturesRail";
import CatalogGrid from "@/components/home/CatalogGrid";
import {
  LiveCountdownDesktopPanel,
  LiveCountdownMobileHomeStrip,
} from "@/components/home/LiveCountdownDisplays";
import { TrackCardSkeleton } from "@/ui/skeletons";
import {
  useCatalogLoading,
  useCatalogSurface,
} from "@/components/storefront/catalog-surface-context";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";

const CatalogLatestSinglesLoadingExtras = memo(function CatalogLatestSinglesLoadingExtras({
  catalogHasMore,
  onLoadMoreCatalog,
}) {
  const catalogLoading = useCatalogLoading();
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

/**
 * Phase P7 — catalog-subscribed media sections isolated from PageStorefront reconcile.
 * Auth props may update chrome; MP4/cover rows stay mounted via stable catalog refs.
 */
const HomeStorefrontCatalogMedia = memo(function HomeStorefrontCatalogMedia({
  isMobile,
  singlesRowRef,
  isAdminStable,
  onGift,
  onCardClick,
  addToCart,
  accountState,
  userId,
  onLibraryChange,
  onOpenFeature,
  albums,
  hoverIn,
  hoverOut,
  buttonHoverIn,
  buttonHoverOut,
  onAlbumClick,
  onOpenAlbumTracklist,
  mixtapesAndEps,
  onPlayMixtapeEp,
  liveStreamDate,
  liveStreamTime,
}) {
  const {
    displaySingles,
    displayFeatures,
    catalogHasMore,
    loadMoreCatalog,
    catalogPlaybackLookup,
  } = useCatalogSurface();
  const prevDisplaySinglesRef = useRef(displaySingles);

  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    const prev = prevDisplaySinglesRef.current;
    if (prev !== displaySingles) {
      logUiHydrationTrace("STORE_FRONT_REBUILD", {
        prevCount: prev?.length ?? 0,
        nextCount: displaySingles?.length ?? 0,
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
            isAdmin={isAdminStable}
            onGift={onGift}
            onCardClick={onCardClick}
            addToCart={addToCart}
            accountState={accountState}
            userId={userId}
            onLibraryChange={onLibraryChange}
            source="home_single_card"
            cardMedia="video"
          />
          <CatalogLatestSinglesLoadingExtras
            catalogHasMore={catalogHasMore}
            onLoadMoreCatalog={loadMoreCatalog}
          />
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
          accountState={accountState}
          userId={userId}
          isAdmin={isAdminStable}
          onGift={onGift}
          onLibraryChange={onLibraryChange}
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
          onOpenAlbumTracklist={onOpenAlbumTracklist}
          catalogPlaybackLookup={catalogPlaybackLookup}
          isMobile={isMobile}
          accountState={accountState}
          userId={userId}
          isAdmin={isAdminStable}
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
            isAdmin={isAdminStable}
            onGift={onGift}
            onCardClick={onAlbumClick}
            onPlayClick={onPlayMixtapeEp}
            addToCart={addToCart}
            accountState={accountState}
            userId={userId}
            onLibraryChange={onLibraryChange}
            source="home_mixtape_ep_card"
            cardMedia="cover"
            catalogPlaybackLookup={catalogPlaybackLookup}
          />
        </div>
      </div>
    </>
  );
});

export default HomeStorefrontCatalogMedia;
