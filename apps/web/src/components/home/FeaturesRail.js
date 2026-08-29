"use client";

import { memo, useMemo, useEffect, useRef } from "react";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";
import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import PlaybackPrewarmCardShell from "@/components/music/PlaybackPrewarmCardShell";
import { itemHasPlayableAudio, resolveContentAccess } from "@/lib/music-access";
import { catalogCoverDisplay, withR2CatalogMedia } from "@/components/home/catalogMedia";
import { useStorefrontCardChrome } from "@/hooks/useStorefrontCardChrome";
import { useArtworkGesture } from "@/hooks/useArtworkGesture";

const FeatureCard = memo(function FeatureCard({
  item,
  isMobile,
  onGift,
  onOpenFeature,
  addToCart,
  onLibraryChange,
  onPlayClick,
}) {
  const { entitlementAccountState, userId, isAdminStable } = useStorefrontCardChrome();
  const mediaItem = useMemo(() => withR2CatalogMedia(item), [item]);
  const access = useMemo(
    () => resolveContentAccess(mediaItem, entitlementAccountState),
    [mediaItem, entitlementAccountState]
  );
  const showPlayActions = itemHasPlayableAudio(mediaItem, access);
  const coverDisplay = useMemo(() => catalogCoverDisplay(mediaItem), [mediaItem]);
  const featureCoverRef = useRef(null);
  const { handlers: featureGesture } = useArtworkGesture({
    slug: item?.slug || "",
    elementRef: featureCoverRef,
  });

  return (
    <PlaybackPrewarmCardShell
      releaseItem={mediaItem}
      playItem={mediaItem}
      accountState={entitlementAccountState}
      userId={userId}
      source="home_feature_card"
      enabled={showPlayActions}
      style={{
        flex: "0 0 auto",
        width: isMobile ? 160 : 220,
        scrollSnapAlign: "start",
        background: "#0a0a0a",
        borderRadius: 14,
        border: "1px solid #1a1a1a",
        transition: "border-color 0.25s",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#a259ff55";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#1a1a1a";
      }}
    >
      {isAdminStable ? <GiftOverlayButton onClick={() => onGift?.(mediaItem)} /> : null}
      <div
        ref={featureCoverRef}
        role="button"
        tabIndex={0}
        onClick={() => onOpenFeature?.(mediaItem)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenFeature?.(mediaItem);
          }
        }}
        onPointerDown={featureGesture.onPointerDown}
        onPointerMove={featureGesture.onPointerMove}
        onPointerUp={featureGesture.onPointerUp}
        onPointerCancel={featureGesture.onPointerCancel}
        onLostPointerCapture={featureGesture.onLostPointerCapture}
        style={{
          cursor: "pointer",
          position: "relative",
          filter: access?.lifecycle && !access.lifecycle.live && !access.lifecycle.earlyEligible
            ? "grayscale(.78) brightness(.62)"
            : undefined,
          transition: "filter .25s ease",
        }}
      >
        <CoverArt
          src={coverDisplay.src}
          baseCover={mediaItem.baseCover || mediaItem.cover || undefined}
          type={coverDisplay.type || "image"}
          alt=""
          width="100%"
          height="auto"
          borderRadius="13px 13px 0 0"
          style={{ aspectRatio: "1/1", display: "block" }}
        />
        {access?.lifecycle && access.lifecycle.phase !== "live" ? (
          <div style={{ position: "absolute", left: 10, bottom: 10, fontSize: 9, fontWeight: 900, letterSpacing: 1.2, color: access.lifecycle.earlyEligible ? "#00ffff" : "#fff", background: "rgba(0,0,0,.78)", border: "1px solid rgba(162,89,255,.55)", borderRadius: 20, padding: "5px 8px", pointerEvents: "none" }}>
            {access.lifecycle.earlyEligible ? "EARLY ACCESS" : access.lifecycle.preorderOpen ? "PRE-ORDER" : "UPCOMING"}
          </div>
        ) : null}
      </div>
      <div style={{ padding: isMobile ? "10px 12px 14px" : "12px 14px 16px" }}>
        <div className="hero-title-glow" style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, marginBottom: 4 }}>
          {mediaItem.title}
        </div>
        <div style={{ fontSize: 10, color: "#a259ff", fontWeight: 700, letterSpacing: 1.5, marginBottom: 6 }}>
          {mediaItem.featuring}
        </div>
        {access?.lifecycleMessage ? <div style={{ fontSize: 10, color: "rgba(255,255,255,.58)", lineHeight: 1.35, marginBottom: 7 }}>{access.lifecycleMessage}</div> : null}
        {access?.showPrice && mediaItem.price != null && Number.isFinite(Number(mediaItem.price)) ? (
          <div style={{ fontSize: 12, color: "#00ffff", fontWeight: 700, marginBottom: isMobile ? 8 : 10 }}>
            ${Number(mediaItem.price).toFixed(2)}
          </div>
        ) : null}
        <div
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div data-persistent-card-actions="true" style={{ flex: 1, minWidth: 0 }}>
            <ReleaseCardActions
                item={mediaItem}
                accountState={entitlementAccountState}
                userId={userId}
                isAdmin={isAdminStable}
                source="home_feature_card"
                showPlay={showPlayActions}
                showCart={Boolean(access?.showCart)}
                onLibraryChange={onLibraryChange}
                onPlayClick={onPlayClick}
                onAddToCart={(e) => {
                  e.stopPropagation();
                  addToCart(mediaItem);
                }}
                cartButtonStyle={{
                  background: "#1a1a1a",
                  color: "white",
                  border: "1px solid #2a2a2a",
                }}
                cartLabel={access?.lifecycle?.preorderOpen
                  ? access.lifecycle.earlyAccessEnabled ? "Preorder Early Access" : "Preorder"
                  : "+ Cart"}
            />
          </div>
        </div>
      </div>
    </PlaybackPrewarmCardShell>
  );
});

function FeaturesRail({
  features,
  isMobile,
  addToCart,
  onOpenFeature,
  onGift,
  onLibraryChange,
  onPlayClick,
}) {
  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    logUiHydrationTrace("FEATURES_RAIL_RENDER", { count: features?.length ?? 0 });
  });

  return (
    <div
      className="features-row"
      style={{
        display: "flex",
        flexWrap: "nowrap",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollSnapType: "x mandatory",
        overflowY: "hidden",
        overscrollBehaviorX: "contain",
        touchAction: "pan-x pan-y",
        gap: isMobile ? 12 : 18,
        paddingBottom: 14,
      }}
    >
      {features.map((feat, i) => {
        const stableKey = feat.slug || feat.id;
        if (!stableKey) return null;
        return (
          <FeatureCard
            key={stableKey}
            item={feat}
            index={i}
            isMobile={isMobile}
            onGift={onGift}
            onOpenFeature={onOpenFeature}
            addToCart={addToCart}
            onLibraryChange={onLibraryChange}
            onPlayClick={onPlayClick}
          />
        );
      })}
    </div>
  );
}

export default memo(FeaturesRail);
