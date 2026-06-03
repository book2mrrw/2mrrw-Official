"use client";

import { memo } from "react";
import EntitlementSurfaceIsland from "@/components/storefront/EntitlementSurfaceIsland";
import AuthSurfaceIsland from "@/components/storefront/AuthSurfaceIsland";
import HomeStorefrontFlowMode from "@/components/storefront/HomeStorefrontFlowMode";

/**
 * Phase P7 — memo bridge isolates home storefront from PageStorefront reconcile
 * (catalog loading, tab state, cart). Auth islands re-render on bootstrap only here.
 */
const HomeStorefrontIsland = memo(function HomeStorefrontIsland({
  onGiftRequest,
  liveCountdownTarget,
  isMobile,
  onDonateOpen,
  singlesRowRef,
  onCardClick,
  addToCart,
  liveStreamDate,
  liveStreamTime,
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
  currentSlide,
  enrichedRadioSlides,
  radioIndex,
  onGoRadio,
  flowConversionActive,
  onFlowConversionActive,
  onAudioVisualsFocused,
  onAudioVisualsExit,
  shopItems,
  printfulLoading,
  shopIsFallback,
  events,
  onSelectEvent,
  onOpenCollection,
}) {
  return (
    <EntitlementSurfaceIsland islandId="home-storefront">
      {(ent) => (
        <AuthSurfaceIsland islandId="home-storefront" onGiftRequest={onGiftRequest}>
          {(auth) => (
            <HomeStorefrontFlowMode
              liveCountdownTarget={liveCountdownTarget}
              isMobile={isMobile}
              showSubscribeCta={ent.showSubscribeCta}
              onDonateOpen={onDonateOpen}
              singlesRowRef={singlesRowRef}
              isAdminStable={auth.isAdminStable}
              onGift={auth.openGiftSheet}
              onCardClick={onCardClick}
              addToCart={addToCart}
              accountState={ent.entitlementAccountState}
              userId={auth.userId}
              onLibraryChange={auth.handleLibraryChange}
              liveStreamDate={liveStreamDate}
              liveStreamTime={liveStreamTime}
              onOpenFeature={onOpenFeature}
              albums={albums}
              hoverIn={hoverIn}
              hoverOut={hoverOut}
              buttonHoverIn={buttonHoverIn}
              buttonHoverOut={buttonHoverOut}
              onAlbumClick={onAlbumClick}
              onOpenAlbumTracklist={onOpenAlbumTracklist}
              mixtapesAndEps={mixtapesAndEps}
              onPlayMixtapeEp={onPlayMixtapeEp}
              currentSlide={currentSlide}
              enrichedRadioSlides={enrichedRadioSlides}
              radioIndex={radioIndex}
              onGoRadio={onGoRadio}
              flowConversionActive={flowConversionActive}
              onFlowConversionActive={onFlowConversionActive}
              showOwnTrackConversion={ent.showOwnTrackConversion}
              onAudioVisualsFocused={onAudioVisualsFocused}
              onAudioVisualsExit={onAudioVisualsExit}
              shopItems={shopItems}
              printfulLoading={printfulLoading}
              shopIsFallback={shopIsFallback}
              events={events}
              onSelectEvent={onSelectEvent}
              onOpenCollection={onOpenCollection}
            />
          )}
        </AuthSurfaceIsland>
      )}
    </EntitlementSurfaceIsland>
  );
});

export default HomeStorefrontIsland;
