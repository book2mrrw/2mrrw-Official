"use client";

import { memo, useMemo, useEffect, useRef, useState } from "react";
import { useMountEnterAnimation } from "@/hooks/useMountEnterAnimation";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";
import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import { itemHasPlayableAudio, resolveContentAccess } from "@/lib/music-access";
import { catalogCoverDisplay, withR2CatalogMedia } from "@/components/home/catalogMedia";
import { useStorefrontCardChrome } from "@/hooks/useStorefrontCardChrome";

const FeatureCard = memo(function FeatureCard({
  item,
  index,
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
  const videoRef = useRef(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const { shouldAnimate } = useMountEnterAnimation();

  return (
    <div
      style={{
        flex: "0 0 auto",
        width: isMobile ? 160 : 220,
        scrollSnapAlign: "start",
        background: "#0a0a0a",
        borderRadius: 14,
        border: "1px solid #1a1a1a",
        opacity: shouldAnimate ? 0 : 1,
        animation: shouldAnimate ? `fadeInUp 0.5s ease ${index * 0.09}s forwards` : undefined,
        transition: "border-color 0.25s",
        position: "relative",
        touchAction: "manipulation",
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
        role="button"
        tabIndex={0}
        onClick={() => onOpenFeature?.(mediaItem)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenFeature?.(mediaItem);
          }
        }}
        style={{ cursor: "pointer" }}
      >
        {!videoFailed && (mediaItem?.video || mediaItem?.visual) && coverDisplay?.type === "video" ? (
          <video
            ref={videoRef}
            src={mediaItem?.video || mediaItem?.visual || undefined}
            poster={mediaItem.cover || undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            webkit-playsinline="true"
            onError={() => setVideoFailed(true)}
            style={{
              backgroundColor: "#0a0a0a",
              width: "100%",
              aspectRatio: "1/1",
              objectFit: "cover",
              display: "block",
              borderRadius: "13px 13px 0 0",
              pointerEvents: "none",
            }}
          />
        ) : (
          <CoverArt
            src={coverDisplay.src}
            type={coverDisplay.type || "image"}
            alt=""
            width="100%"
            height="auto"
            borderRadius="13px 13px 0 0"
            style={{ aspectRatio: "1/1", display: "block" }}
          />
        )}
      </div>
      <div style={{ padding: isMobile ? "10px 12px 14px" : "12px 14px 16px" }}>
        <div className="hero-title-glow" style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, marginBottom: 4 }}>
          {mediaItem.title}
        </div>
        <div style={{ fontSize: 10, color: "#a259ff", fontWeight: 700, letterSpacing: 1.5, marginBottom: 6 }}>
          {mediaItem.featuring}
        </div>
        {access?.showPrice && mediaItem.price != null && Number.isFinite(Number(mediaItem.price)) ? (
          <div style={{ fontSize: 12, color: "#00ffff", fontWeight: 700, marginBottom: isMobile ? 8 : 10 }}>
            ${Number(mediaItem.price).toFixed(2)}
          </div>
        ) : null}
        <div
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          onClick={(e) => e.stopPropagation()}
        >
          {showPlayActions ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <ReleaseCardActions
                item={mediaItem}
                accountState={entitlementAccountState}
                userId={userId}
                source="home_feature_card"
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
                cartLabel="+ Cart"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
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
