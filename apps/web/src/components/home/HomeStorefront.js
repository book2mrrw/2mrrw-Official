"use client";

import { memo, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import styles from "./HomeStorefront.module.css";
import { COLLECTORS_CARDS_ROUTE } from "@/lib/collectors-cards";
import AudioVisualsSection from "@/components/home/AudioVisualsSection";
import HomeStorefrontCatalogMedia from "@/components/storefront/HomeStorefrontCatalogMedia";
import RadioCarousel from "@/components/home/RadioCarousel";
import FlowState from "@/components/home/FlowState";
import CatalogGrid from "@/components/home/CatalogGrid";
import { LiveCountdownHomeSection } from "@/components/home/LiveCountdownDisplays";
import { LiveCountdownProvider } from "@/components/home/LiveCountdownContext";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";
import AdminIngestButton from "@/components/admin/AdminIngestButton";
import { usePlaybackChromeLayout } from "@/hooks/usePlaybackChromeLayout";

const HomeFlowStateIsland = memo(function HomeFlowStateIsland({
  flowConversionActive,
  currentSlide,
  showOwnTrackConversion,
  onAddToCart,
}) {
  const { nowPlayingKey } = usePlaybackChromeLayout();
  const activeFlowMode = useMemo(
    () => (flowConversionActive ? "conversion" : nowPlayingKey ? "nowplaying" : "idle"),
    [flowConversionActive, nowPlayingKey]
  );
  return (
    <FlowState
      activeFlowMode={activeFlowMode}
      currentSlide={currentSlide}
      showOwnTrackConversion={showOwnTrackConversion}
      onAddToCart={onAddToCart}
    />
  );
});

const HomeStorefront = memo(function HomeStorefront({
  liveCountdownTarget,
  showSubscribeCta,
  onDonateOpen,
  singlesRowRef,
  isAdminStable,
  onGift,
  onCardClick,
  addToCart,
  accountState,
  userId,
  onLibraryChange,
  liveStreamDate,
  liveStreamTime,
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
  currentSlide,
  enrichedRadioSlides,
  radioIndex,
  onGoRadio,
  onFlowConversionActive,
  flowConversionActive,
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
  const router = useRouter();
  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    logUiHydrationTrace("STORE_FRONT_RENDER", {});
    logUiHydrationTrace("HOME_STOREFRONT_RENDER", {});
  });

  const storefront = (
    <>
      <div style={{ padding: "18px 0 8px", display: "flex", justifyContent: "flex-start", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className={styles.donateBtn} onClick={onDonateOpen}>
          ♥ Donate
        </button>
        {showSubscribeCta && (
          <button type="button" className={styles.subscribeBtn} onClick={() => router.push("/subscribe")}>
            Subscribe
          </button>
        )}
      </div>

      <motion.div style={{ marginTop: 20, marginBottom: 4 }}>
        <motion.div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <h2 className="section-heading" style={{ margin: 0 }}>Latest Singles</h2>
          <AdminIngestButton />
        </motion.div>
        <motion.div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <button type="button" className={styles.collBtn} onClick={onOpenCollection} aria-label="Open my music collection">
            MY COLLECTION
          </button>
        </motion.div>

        <HomeStorefrontCatalogMedia
          singlesRowRef={singlesRowRef}
          onGift={onGift}
          onCardClick={onCardClick}
          addToCart={addToCart}
          onLibraryChange={onLibraryChange}
          onOpenFeature={onOpenFeature}
          albums={albums}
          hoverIn={hoverIn}
          hoverOut={hoverOut}
          buttonHoverIn={buttonHoverIn}
          buttonHoverOut={buttonHoverOut}
          onAlbumClick={onAlbumClick}
          onPlayAlbum={onPlayAlbum}
          onOpenAlbumTracklist={onOpenAlbumTracklist}
          mixtapesAndEps={mixtapesAndEps}
          onPlayMixtapeEp={onPlayMixtapeEp}
          onPlaySingle={onPlaySingle}
          onPlayFeature={onPlayFeature}
          liveStreamDate={liveStreamDate}
          liveStreamTime={liveStreamTime}
        />
      </motion.div>

      <div style={{ marginTop: 28, marginBottom: 28 }}>
        <h2 className="section-heading" style={{ marginBottom: 14 }}>2MRRW RADIO</h2>
          <div className="home-radio-composition">
            <div className="home-radio-composition__primary">
              <RadioCarousel
                narrow
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
            <div className="home-radio-composition__flow">
              <HomeFlowStateIsland
                flowConversionActive={flowConversionActive}
                currentSlide={currentSlide}
                showOwnTrackConversion={showOwnTrackConversion}
                onAddToCart={addToCart}
              />
            </div>
          </div>
      </div>

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />
      <AudioVisualsSection
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
            />
          </>
        )}
      </div>

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />

      <div id="home-vault">
        <h2 className="section-heading" style={{ marginBottom: 8 }}>Vault</h2>
        <div className="home-vault-card" style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", textAlign: "center" }}>
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
          onClick={() => router.push(COLLECTORS_CARDS_ROUTE)}
          style={{ padding: "11px 18px", background: "transparent", border: "1px solid rgba(0,255,255,0.35)", borderRadius: 10, color: "#00ffff", fontSize: 12, fontWeight: 700, letterSpacing: 1.5, cursor: "pointer" }}
        >
          View Collector&apos;s Cards →
        </button>
      </div>

      <div style={{ margin: "32px 0 24px", height: 1, background: "#1a1a1a" }} />

      <div id="home-shows">
        <h2 className="section-heading" style={{ marginBottom: 16 }}>Shows & Events</h2>
        {events.length === 0 && (
          <div style={{ color: "#555", fontSize: 13, letterSpacing: 1, padding: "12px 0" }}>No upcoming shows scheduled.</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.map((evt) => (
            <div
              key={evt.id}
              style={{
                background: "#0e0e0e",
                border: "1px solid #1e1e1e",
                borderRadius: 14,
                padding: "clamp(14px, 2.4cqi, 18px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: "clamp(13px, 1.8cqi, 14px)", marginBottom: 3 }}>{evt.name}</div>
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

      <LiveCountdownHomeSection liveStreamDate={liveStreamDate} liveStreamTime={liveStreamTime} />
      <div style={{ height: 40 }} />
    </>
  );

  if (!liveCountdownTarget) return storefront;

  return (
    <LiveCountdownProvider targetDate={liveCountdownTarget}>{storefront}</LiveCountdownProvider>
  );
});

export default HomeStorefront;
