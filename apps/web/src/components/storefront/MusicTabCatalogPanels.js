"use client";

import { playSectionQueue } from "@/lib/playback/section-queue";
import { memo, useCallback, useMemo } from "react";
import CarouselUI from "@/components/home/CarouselUI";
import FeaturesRail from "@/components/home/FeaturesRail";
import CatalogGrid from "@/components/home/CatalogGrid";
import AudioVisualsSection from "@/components/home/AudioVisualsSection";
import MyMusicTab from "@/components/music/MyMusicTab";
import { useCatalogSurface } from "@/components/storefront/catalog-surface-context";
import { resolveContentAccess } from "@/lib/music-access";
import { resolveCatalogPlaybackItem, toPlaybackTrack } from "@/lib/music-playback";
import { withR2CatalogMedia } from "@/components/home/catalogMedia";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";

/**
 * Phase P7 — music-tab catalog subscription isolated from PageStorefront reconcile.
 */
const MusicTabCatalogPanels = memo(function MusicTabCatalogPanels({
  activeTab,
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
  onPlayAlbum,
}) {
  const {
    displaySingles,
    displayFeatures,
    displayAlbums: albums,
    displayMixtapesAndEps: mixtapesAndEps,
    catalogPlaybackLookup,
  } = useCatalogSurface();

  const handleFeaturePlay = useCallback((e, clickedItem) => {
    e.stopPropagation();
    const account = { ...entitlementAccountState, userId, isAdmin: isAdminStable || entitlementAccountState?.isAdmin || Boolean(entitlementAccountState?.permissions?.admin) };
    playSectionQueue({
      items: displayFeatures, clickedItem, source: "feature_card",
      bridge: getPagePlaybackActionsBridge(),
      toTrack: (item) => toPlaybackTrack(withR2CatalogMedia(item), account, "feature_card"),
    });
  }, [displayFeatures, entitlementAccountState, userId, isAdminStable]);

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

  return (
    <>
      <section hidden={activeTab !== "singles"} aria-hidden={activeTab !== "singles"}>
        <h2 className="section-heading" style={{ marginBottom: 14 }}>
          Singles
        </h2>
        <CarouselUI
          large
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
            addToCart={addToCart}
            onOpenFeature={openFeatureModal}
            accountState={entitlementAccountState}
            userId={userId}
            isAdmin={isAdminStable}
            onGift={openGiftSheet}
            onLibraryChange={handleLibraryChange}
            onPlayClick={handleFeaturePlay}
          />
        </div>
        <AudioVisualsSection
          onAudioVisualsFocused={handleAudioVisualsFocused}
          onAudioVisualsExit={handleAudioVisualsExit}
        />
      </section>
      <section hidden={activeTab !== "albums"} aria-hidden={activeTab !== "albums"}>
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
          onPlayAlbum={onPlayAlbum}
          onOpenAlbumTracklist={setAlbumTracklistRelease}
          catalogPlaybackLookup={catalogPlaybackLookup}
          accountState={entitlementAccountState}
          userId={userId}
          isAdmin={isAdminStable}
          onGift={openGiftSheet}
          onLibraryChange={handleLibraryChange}
        />
      </section>
      <section hidden={activeTab !== "mixtapes"} aria-hidden={activeTab !== "mixtapes"}>
        <h2 className="section-heading" style={{ marginBottom: 16 }}>
          Mixtapes & EPs
        </h2>
        <CatalogGrid
          items={mixtapesAndEps}
          type="mixtapes"
          addToCart={addToCart}
          hoverIn={hoverIn}
          hoverOut={hoverOut}
          buttonHoverIn={buttonHoverIn}
          buttonHoverOut={buttonHoverOut}
          onCardClick={openAlbumModal}
          onPlayAlbum={onPlayAlbum}
          onOpenAlbumTracklist={setAlbumTracklistRelease}
          catalogPlaybackLookup={catalogPlaybackLookup}
          accountState={entitlementAccountState}
          userId={userId}
          isAdmin={isAdminStable}
          onGift={openGiftSheet}
          onLibraryChange={handleLibraryChange}
        />
      </section>
      <section hidden={activeTab !== "mymusic"} aria-hidden={activeTab !== "mymusic"}>
      <MyMusicTab
        singles={displaySingles}
        albums={albums}
        mixtapesAndEps={mixtapesAndEps}
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
      </section>
    </>
  );
});

export default MusicTabCatalogPanels;
