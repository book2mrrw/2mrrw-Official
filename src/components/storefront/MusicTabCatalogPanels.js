"use client";

import { memo, useCallback, useMemo } from "react";
import CarouselUI from "@/components/home/CarouselUI";
import FeaturesRail from "@/components/home/FeaturesRail";
import CatalogGrid from "@/components/home/CatalogGrid";
import AudioVisualsSection from "@/components/home/AudioVisualsSection";
import MyMusicTab from "@/components/music/MyMusicTab";
import { useCatalogSurface } from "@/components/storefront/catalog-surface-context";
import { resolveContentAccess, resolveTrackAccess } from "@/lib/music-access";
import { resolveCatalogPlaybackItem, toInstantStartTrack, toPlaybackTrack } from "@/lib/music-playback";
import { withR2CatalogMedia } from "@/components/home/catalogMedia";
import { getPagePlaybackActionsBridge } from "@/lib/playback/page-playback-actions-bridge";

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
  onPlayAlbum,
}) {
  const { displaySingles, displayFeatures, catalogPlaybackLookup } = useCatalogSurface();

  const handleFeaturePlay = useCallback((e, clickedItem) => {
    e.stopPropagation();
    const account = { ...entitlementAccountState, userId };
    const bridge = getPagePlaybackActionsBridge();

    const isSameTrack = bridge?.currentTrack?.slug === clickedItem.slug;
    if (isSameTrack) {
      if (bridge?.playbackState === "idle") {
        const track = toPlaybackTrack(withR2CatalogMedia(clickedItem), account, "feature_card");
        const { startTrack, needsUpgrade } = toInstantStartTrack(track);
        if (track.src) {
          void bridge?.playQueue?.([startTrack], 0, { resumeAt: 0 });
          if (needsUpgrade) {
            const upgradeSlug = startTrack.slug;
            setTimeout(() => {
              const b = getPagePlaybackActionsBridge();
              if (b?.currentTrack?.slug === upgradeSlug) void b.dispatchPlaybackCommand("upgradeStream");
            }, 2000);
          }
        }
      } else {
        void bridge?.toggle?.();
      }
      return;
    }

    const streamable = displayFeatures.filter(
      (item) => resolveTrackAccess(item, account).canStream
    );
    if (!streamable.length) {
      const track = toPlaybackTrack(withR2CatalogMedia(clickedItem), account, "feature_card");
      const { startTrack, needsUpgrade } = toInstantStartTrack(track);
      if (track.src) {
        void bridge?.playQueue?.([startTrack], 0, { resumeAt: 0 });
        if (needsUpgrade) {
          const upgradeSlug = startTrack.slug;
          setTimeout(() => {
            const b = getPagePlaybackActionsBridge();
            if (b?.currentTrack?.slug === upgradeSlug) void b.dispatchPlaybackCommand("upgradeStream");
          }, 2000);
        }
      }
      return;
    }
    const idx = Math.max(0, streamable.findIndex((s) => s.slug === clickedItem.slug));
    const tracks = streamable
      .map((item) => toPlaybackTrack(withR2CatalogMedia(item), account, "feature_card"))
      .filter((t) => t.src);
    if (tracks.length) {
      const { startTrack, needsUpgrade } = toInstantStartTrack(tracks[idx]);
      const instantTracks = needsUpgrade ? tracks.map((t, i) => (i === idx ? startTrack : t)) : tracks;
      void bridge?.playQueue?.(instantTracks, idx, { resumeAt: 0 });
      if (needsUpgrade) {
        const upgradeSlug = startTrack.slug;
        setTimeout(() => {
          const b = getPagePlaybackActionsBridge();
          if (b?.currentTrack?.slug === upgradeSlug) void b.dispatchPlaybackCommand("upgradeStream");
        }, 2000);
      }
    }
  }, [displayFeatures, entitlementAccountState, userId]);

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
            onPlayClick={handleFeaturePlay}
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
          onPlayAlbum={onPlayAlbum}
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
