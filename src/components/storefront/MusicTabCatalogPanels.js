"use client";

import { memo, useCallback, useMemo } from "react";
import CarouselUI from "@/components/home/CarouselUI";
import FeaturesRail from "@/components/home/FeaturesRail";
import CatalogGrid from "@/components/home/CatalogGrid";
import AudioVisualsSection from "@/components/home/AudioVisualsSection";
import MyMusicTab from "@/components/music/MyMusicTab";
import { useCatalogSurface } from "@/components/storefront/catalog-surface-context";
import { resolveContentAccess } from "@/lib/music-access";
import { resolveCatalogPlaybackItem } from "@/lib/music-playback";
import { withR2CatalogMedia } from "@/components/home/catalogMedia";

/**
 * Phase P7 — music-tab catalog subscription isolated from PageStorefront reconcile.
 */
const MusicTabCatalogPanels = memo(function MusicTabCatalogPanels({
  activeTab,
  isMobile,
  singleIndex,
  goToSingle,
  handleSingleClick,
  addToCart,
  addVinylToCart,
  buttonHoverIn,
  buttonHoverOut,
  openFeatureModal,
  openAlbumModal,
  setAlbumTracklistRelease,
  albums,
  mixtapesAndEps,
  hoverIn,
  hoverOut,
  giftHighlightSlug,
  switchTab,
  openSingleModal,
  handleAudioVisualsFocused,
  handleAudioVisualsExit,
  entitlementAccountState,
  userId,
  isAdminStable,
  openGiftSheet,
  handleLibraryChange,
}) {
  const { displaySingles, displayFeatures, catalogPlaybackLookup } = useCatalogSurface();

  const prevSingle = useCallback(
    () => goToSingle(singleIndex === 0 ? displaySingles.length - 1 : singleIndex - 1, "left"),
    [goToSingle, singleIndex, displaySingles.length]
  );
  const nextSingle = useCallback(
    () => goToSingle(singleIndex === displaySingles.length - 1 ? 0 : singleIndex + 1, "right"),
    [goToSingle, singleIndex, displaySingles.length]
  );
  const currentSingle = useMemo(
    () => withR2CatalogMedia(displaySingles[singleIndex]),
    [singleIndex, displaySingles]
  );

  if (activeTab === "singles") {
    return (
      <>
        <div style={{ marginBottom: 20 }}>
          <div style={{ position: "relative" }}>
            <input
              placeholder="Search singles…"
              style={{
                width: "100%",
                padding: "11px 14px 11px 38px",
                background: "#0d0d0d",
                border: "1px solid #1e1e1e",
                borderRadius: 10,
                color: "white",
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#00ffff33";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "#1e1e1e";
              }}
            />
            <svg
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: 0.3 }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              width="16"
              height="16"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </div>
        </div>
        <h2 className="section-heading" style={{ marginBottom: 14 }}>
          Singles
        </h2>
        <CarouselUI
          large={!isMobile}
          isMobile={isMobile}
          currentSingle={currentSingle}
          currentSingleAccess={
            currentSingle ? resolveContentAccess(currentSingle, entitlementAccountState) : null
          }
          singleIndex={singleIndex}
          singles={displaySingles}
          prevSingle={prevSingle}
          nextSingle={nextSingle}
          goToSingle={goToSingle}
          onSingleClick={handleSingleClick}
          addToCart={addToCart}
          addVinylToCart={addVinylToCart}
          buttonHoverIn={buttonHoverIn}
          buttonHoverOut={buttonHoverOut}
          accountState={entitlementAccountState}
          userId={userId}
          isAdmin={isAdminStable}
          onGift={openGiftSheet}
          onLibraryChange={handleLibraryChange}
        />
        <div style={{ marginTop: 32, marginBottom: 4 }}>
          <h2 className="section-heading" style={{ marginBottom: 14 }}>
            Features
          </h2>
          <FeaturesRail
            features={displayFeatures}
            isMobile={isMobile}
            addToCart={addToCart}
            onOpenFeature={openFeatureModal}
            accountState={entitlementAccountState}
            userId={userId}
            isAdmin={isAdminStable}
            onGift={openGiftSheet}
            onLibraryChange={handleLibraryChange}
          />
        </div>
        <AudioVisualsSection
          isMobile={isMobile}
          onAudioVisualsFocused={handleAudioVisualsFocused}
          onAudioVisualsExit={handleAudioVisualsExit}
        />
      </>
    );
  }

  if (activeTab === "albums") {
    return (
      <>
        <h2 className="section-heading" style={{ marginBottom: 16 }}>
          Albums
        </h2>
        <CatalogGrid
          items={albums}
          type="albums"
          addToCart={addToCart}
          hoverIn={hoverIn}
          hoverOut={hoverOut}
          buttonHoverIn={buttonHoverIn}
          buttonHoverOut={buttonHoverOut}
          onCardClick={openAlbumModal}
          onOpenAlbumTracklist={setAlbumTracklistRelease}
          catalogPlaybackLookup={catalogPlaybackLookup}
          isMobile={isMobile}
          accountState={entitlementAccountState}
          userId={userId}
          isAdmin={isAdminStable}
          onGift={openGiftSheet}
          onLibraryChange={handleLibraryChange}
        />
      </>
    );
  }

  if (activeTab === "mymusic") {
    return (
      <MyMusicTab
        singles={displaySingles}
        albums={albums}
        mixtapesAndEps={mixtapesAndEps}
        isMobile={isMobile}
        isAdmin={isAdminStable}
        highlightSlug={giftHighlightSlug}
        onSwitchTab={switchTab}
        onOpenSingle={openSingleModal}
        onOpenAlbum={openAlbumModal}
        onOpenAlbumTracklist={(album) => {
          const resolved = resolveCatalogPlaybackItem(album, catalogPlaybackLookup);
          setAlbumTracklistRelease(resolved || album);
        }}
      />
    );
  }

  return null;
});

export default MusicTabCatalogPanels;
