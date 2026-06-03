"use client";

import { memo, useEffect } from "react";
import { motion } from "framer-motion";
import { COLLECTORS_CARDS_ROUTE } from "@/lib/collectors-cards";
import AudioVisualsSection from "@/components/home/AudioVisualsSection";
import LatestSinglesStyleRow from "@/components/home/LatestSinglesStyleRow";
import FeaturesRail from "@/components/home/FeaturesRail";
import CatalogGrid from "@/components/home/CatalogGrid";
import RadioCarousel from "@/components/home/RadioCarousel";
import FlowState from "@/components/home/FlowState";
import {
  LiveCountdownDesktopPanel,
  LiveCountdownHomeSection,
  LiveCountdownMobileHomeStrip,
} from "@/components/home/LiveCountdownDisplays";
import { LiveCountdownProvider } from "@/components/home/LiveCountdownContext";
import { TrackCardSkeleton } from "@/ui/skeletons";
import { useCatalogLoading } from "@/components/storefront/catalog-surface-context";
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

const HomeStorefront = memo(function HomeStorefront({
  liveCountdownTarget,
  isMobile,
  showSubscribeCta,
  onDonateOpen,
  singlesRowRef,
  displaySingles,
  isAdminStable,
  onGift,
  onCardClick,
  addToCart,
  accountState,
  userId,
  onLibraryChange,
  catalogHasMore,
  onLoadMoreCatalog,
  liveStreamDate,
  liveStreamTime,
  displayFeatures,
  onOpenFeature,
  albums,
  hoverIn,
  hoverOut,
  buttonHoverIn,
  buttonHoverOut,
  onAlbumClick,
  onOpenAlbumTracklist,
  catalogPlaybackLookup,
  mixtapesAndEps,
  onPlayMixtapeEp,
  currentSlide,
  enrichedRadioSlides,
  radioIndex,
  onGoRadio,
  onFlowConversionActive,
  activeFlowMode,
  showOwnTrackConversion,
  onAudioVisualsFocused,
  onAudioVisualsExit,
  shopItems,
  printfulLoading,
  shopIsFallback,
  events,
  onSelectEvent,
  onOpenCollection,
}) {
  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    logUiHydrationTrace("HOME_STOREFRONT_RENDER", {});
  });

  const storefront = (
    <>
      <div style={{ padding: "18px 0 8px", display: "flex", justifyContent: "flex-start", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="donate-glow-button" onClick={onDonateOpen}>
          ♥ Donate
        </button>
        {showSubscribeCta && (
          <button type="button" className="subscribe-shimmer-button" onClick={() => { window.location.href = "/subscribe"; }}>
            Subscribe
          </button>
        )}
      </div>

      <motion.div style={{ marginTop: 20, marginBottom: 4 }}>
        <motion.div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <h2 className="section-heading" style={{ margin: 0 }}>Latest Singles</h2>
          <button type="button" className="my-coll-btn" onClick={onOpenCollection} aria-label="Open my music collection">
            MY COLLECTION
          </button>
        </motion.div>

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
              onLoadMoreCatalog={onLoadMoreCatalog}
            />
          </div>

          {!isMobile && (
            <LiveCountdownDesktopPanel liveStreamDate={liveStreamDate} liveStreamTime={liveStreamTime} />
          )}
        </div>

        {isMobile ? <LiveCountdownMobileHomeStrip /> : null}
      </motion.div>

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

      <div style={{ marginTop: 28, marginBottom: 28 }}>
        <h2 className="section-heading" style={{ marginBottom: 14 }}>2MRRW RADIO</h2>
        {isMobile ? (
          <RadioCarousel
            isMobile={isMobile}
            currentSlide={currentSlide}
            radioSlides={enrichedRadioSlides}
            radioIndex={radioIndex}
            goRadio={onGoRadio}
            isAdmin={isAdminStable}
            onGift={onGift}
            onAddToCart={addToCart}
            onFlowConversionActive={onFlowConversionActive}
            accountState={accountState}
            currentUserId={userId}
            onLibraryChange={onLibraryChange}
          />
        ) : (
          <div style={{ display: "flex", gap: 16, alignItems: "stretch", minHeight: 320 }}>
            <div style={{ flex: "0 0 55%", minWidth: 0 }}>
              <RadioCarousel
                narrow
                isMobile={isMobile}
                currentSlide={currentSlide}
                radioSlides={enrichedRadioSlides}
                radioIndex={radioIndex}
                goRadio={onGoRadio}
                isAdmin={isAdminStable}
                onGift={onGift}
                onAddToCart={addToCart}
                onFlowConversionActive={onFlowConversionActive}
                accountState={accountState}
                currentUserId={userId}
                onLibraryChange={onLibraryChange}
              />
            </div>
            <FlowState
              activeFlowMode={activeFlowMode}
              currentSlide={currentSlide}
              showOwnTrackConversion={showOwnTrackConversion}
              onAddToCart={addToCart}
            />
          </div>
        )}
      </div>

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />
      <AudioVisualsSection
        isMobile={isMobile}
        onAudioVisualsFocused={onAudioVisualsFocused}
        onAudioVisualsExit={onAudioVisualsExit}
      />

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />

      <div id="home-shop">
        <h2 className="section-heading" style={{ marginBottom: 16 }}>Shop</h2>
        {printfulLoading ? (
          <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#333", letterSpacing: 2 }}>Loading products…</div>
        ) : (
          <>
            {shopIsFallback && (
              <div style={{ fontSize: 11, color: "#333", letterSpacing: 1, marginBottom: 16 }}>Store coming soon — preview below</div>
            )}
            <CatalogGrid
              items={shopItems}
              type="products"
              addToCart={addToCart}
              hoverIn={hoverIn}
              hoverOut={hoverOut}
              buttonHoverIn={buttonHoverIn}
              buttonHoverOut={buttonHoverOut}
              isMobile={isMobile}
            />
          </>
        )}
      </div>

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />

      <div id="home-vault">
        <h2 className="section-heading" style={{ marginBottom: 8 }}>Vault</h2>
        <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: isMobile ? 14 : 18, padding: isMobile ? "28px 20px" : "40px 32px", textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#555", letterSpacing: 1, lineHeight: 1.8, margin: 0 }}>
            The Vault remains completely empty for now. Exclusive drops will be listed here when they launch.
          </p>
        </div>
      </div>

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />

      <div id="home-cards">
        <h2 className="section-heading" style={{ marginBottom: 8 }}>Collector&apos;s Cards</h2>
        <p style={{ fontSize: 13, color: "#444", marginBottom: 18, letterSpacing: 1, lineHeight: 1.8 }}>
          Physical ownership tokens — numbered editions on a dedicated page.
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.href = COLLECTORS_CARDS_ROUTE;
          }}
          style={{ padding: "11px 18px", background: "transparent", border: "1px solid rgba(0,255,255,0.35)", borderRadius: 10, color: "#00ffff", fontSize: 12, fontWeight: 700, letterSpacing: 1.5, cursor: "pointer" }}
        >
          View Collector&apos;s Cards →
        </button>
      </div>

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />

      <div id="home-shows">
        <h2 className="section-heading" style={{ marginBottom: 16 }}>Shows & Events</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.map((evt) => (
            <div
              key={evt.id}
              style={{
                background: "#0e0e0e",
                border: "1px solid #1e1e1e",
                borderRadius: 14,
                padding: isMobile ? "14px" : "16px 18px",
                display: "flex",
                alignItems: isMobile ? "flex-start" : "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: isMobile ? 13 : 14, marginBottom: 3 }}>{evt.name}</div>
                <div style={{ fontSize: 12, color: "#aaa" }}>{evt.location}</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                  {new Date(evt.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })} · {evt.time}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 15, fontWeight: 900, color: "#00ffff" }}>${evt.price.toFixed(2)}</div>
                <button
                  onClick={() => onSelectEvent(evt)}
                  style={{ padding: "8px 14px", background: "#111", color: "white", border: "1px solid #333", borderRadius: 8, cursor: "pointer", fontWeight: "bold", fontSize: 12, transition: "0.2s" }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#00ffff";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#333";
                  }}
                >
                  Tickets
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />

      <LiveCountdownHomeSection isMobile={isMobile} liveStreamDate={liveStreamDate} liveStreamTime={liveStreamTime} />
      <div style={{ height: 40 }} />
    </>
  );

  if (!liveCountdownTarget) return storefront;

  return (
    <LiveCountdownProvider targetDate={liveCountdownTarget}>{storefront}</LiveCountdownProvider>
  );
});

export default HomeStorefront;
