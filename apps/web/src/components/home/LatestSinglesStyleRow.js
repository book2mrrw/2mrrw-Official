"use client";

import { forwardRef, memo, useMemo, useEffect, useRef, useState } from "react";
import { useMountEnterAnimation } from "@/hooks/useMountEnterAnimation";
import {
  isUiHydrationTraceEnabled,
  logUiHydrationTrace,
} from "@/lib/diagnostics/ui-hydration-trace";
import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import PlaybackPrewarmCardShell from "@/components/music/PlaybackPrewarmCardShell";
import { itemHasPlayableAudio, resolveContentAccess } from "@/lib/music-access";
import { albumCardPlaybackItem } from "@/lib/music-playback";
import { withR2CatalogMedia, catalogCoverDisplay } from "@/components/home/catalogMedia";
import { useStorefrontCardChrome } from "@/hooks/useStorefrontCardChrome";
import { getCatalogSurfaceRef } from "@/lib/storefront/catalog-surface-ref";
import { getMediaSignature } from "@/lib/media/media-determinism";
import { useArtworkGesture } from "@/hooks/useArtworkGesture";

/** Phase P9 — MP4/cover surface; skips reconcile when only entitlement chrome changes. */
const SinglesStyleCardMediaSurface = memo(function SinglesStyleCardMediaSurface({
  mediaItem,
  cardMedia,
  coverDisplay,
}) {
  const videoRef = useRef(null);
  const assignedSrc = cardMedia === "video" ? mediaItem?.video || null : null;
  const [coverVideoFailed, setCoverVideoFailed] = useState(false);

  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    logUiHydrationTrace("MEDIA_CARD_REINITIALIZED", {
      slug: mediaItem?.slug ?? null,
      cardMedia,
      phase: "media-surface-mount",
    });
  }, [mediaItem?.slug, cardMedia]);

  useEffect(() => {
    if (!isUiHydrationTraceEnabled() || cardMedia !== "video") return;
    logUiHydrationTrace("MEDIA_SRC_ASSIGNED", {
      slug: mediaItem?.slug ?? null,
      url: assignedSrc,
    });
  }, [mediaItem?.slug, assignedSrc, cardMedia]);

  useEffect(() => {
    if (!isUiHydrationTraceEnabled() || cardMedia !== "video") return;
    const el = videoRef.current;
    if (!el) return;
    const onError = () => {
      logUiHydrationTrace("MEDIA_ELEMENT_ERROR", {
        slug: mediaItem?.slug ?? null,
        src: el.getAttribute("src"),
        currentSrc: el.currentSrc || null,
        error: el.error ? { code: el.error.code, message: el.error.message } : null,
      });
    };
    el.addEventListener("error", onError);
    return () => el.removeEventListener("error", onError);
  }, [mediaItem?.slug, assignedSrc, cardMedia]);

  if (cardMedia === "video") {
    return (
      <video
        ref={videoRef}
        data-single-carousel
        src={assignedSrc || undefined}
        poster={mediaItem.cover || undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        webkit-playsinline="true"
        style={{
          backgroundColor: "#0a0a0a",
          width: "100%",
          aspectRatio: "1/1",
          objectFit: "cover",
          display: "block",
          borderRadius: "13px 13px 0 0",
          transition: "transform 0.3s, filter 0.3s",
          pointerEvents: "none",
        }}
      />
    );
  }

  if (!coverVideoFailed && (mediaItem?.video || mediaItem?.visual) && coverDisplay?.type === "video") {
    const coverVideoSrc = mediaItem?.video || mediaItem?.visual || null;
    return (
      <video
        ref={videoRef}
        src={coverVideoSrc || undefined}
        poster={mediaItem.cover || undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        webkit-playsinline="true"
        onError={() => setCoverVideoFailed(true)}
        style={{
          backgroundColor: "#0a0a0a",
          width: "100%",
          aspectRatio: "1/1",
          objectFit: "cover",
          display: "block",
          borderRadius: "13px 13px 0 0",
          transition: "transform 0.3s, filter 0.3s",
          pointerEvents: "none",
        }}
      />
    );
  }

  return (
    <CoverArt
      src={coverDisplay.src}
      type={coverDisplay.type || "image"}
      alt=""
      width="100%"
      height="auto"
      borderRadius="13px 13px 0 0"
      style={{
        aspectRatio: "1/1",
        display: "block",
        pointerEvents: "none",
      }}
    />
  );
}, (prev, next) => getMediaSignature(prev.mediaItem) === getMediaSignature(next.mediaItem));

const SinglesStyleCard = memo(function SinglesStyleCard({
  item,
  index,
  isMobile,
  onGift,
  onCardClick,
  onPlayClick,
  addToCart,
  onLibraryChange,
  source,
  cardMedia,
  titleClassName,
  isFirstCard,
}) {
  const { entitlementAccountState, userId, isAdminStable } = useStorefrontCardChrome();
  const catalogPlaybackLookup = getCatalogSurfaceRef().catalogPlaybackLookup;
  const mediaItem = useMemo(() => withR2CatalogMedia(item), [item]);
  const singleCoverRef = useRef(null);
  const { handlers: singleGesture } = useArtworkGesture({
    slug: item?.slug || "",
    elementRef: singleCoverRef,
  });
  const access = useMemo(
    () => resolveContentAccess(mediaItem, entitlementAccountState),
    [mediaItem, entitlementAccountState]
  );
  const showPlayActions = itemHasPlayableAudio(mediaItem, access);
  const playItem = useMemo(() => {
    if (cardMedia === "cover" && catalogPlaybackLookup) {
      return albumCardPlaybackItem(mediaItem, catalogPlaybackLookup);
    }
    return mediaItem;
  }, [cardMedia, catalogPlaybackLookup, mediaItem]);
  const coverDisplay = useMemo(() => catalogCoverDisplay(mediaItem), [mediaItem]);
  const playItemResolved = useMemo(() => withR2CatalogMedia(playItem), [playItem]);
  const { shouldAnimate } = useMountEnterAnimation();

  return (
    <PlaybackPrewarmCardShell
      releaseItem={mediaItem}
      playItem={playItem}
      catalogPlaybackLookup={catalogPlaybackLookup}
      accountState={entitlementAccountState}
      userId={userId}
      source={source}
      isAlbumCard={cardMedia === "cover"}
      isFirstCard={isFirstCard}
      enabled={showPlayActions}
      data-single-card={cardMedia === "video" ? true : undefined}
      onClick={() => onCardClick?.(mediaItem)}
      className={shouldAnimate ? "catalog-card-enter" : undefined}
      style={{
        flex: "0 0 auto",
        width: isMobile ? 160 : 200,
        cursor: "pointer",
        scrollSnapAlign: "start",
        animationDelay: `${index * 0.09}s`,
        background: "#0a0a0a",
        borderRadius: 14,
        border: "1px solid #1a1a1a",
        transition: "border-color 0.25s, box-shadow 0.25s",
        position: "relative",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = "#00ffff33";
        e.currentTarget.style.boxShadow = "0 0 18px rgba(0,255,255,0.35)";
        const vid = e.currentTarget.querySelector("video");
        if (vid) {
          vid.style.transform = "scale(1.05)";
          vid.style.filter = "brightness(1.12)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "#1a1a1a";
        e.currentTarget.style.boxShadow = "none";
        const vid = e.currentTarget.querySelector("video");
        if (vid) {
          vid.style.transform = "scale(1)";
          vid.style.filter = "brightness(1)";
        }
      }}
    >
      {isAdminStable ? <GiftOverlayButton onClick={() => onGift?.(mediaItem)} /> : null}
      <div
        ref={singleCoverRef}
        onPointerDown={singleGesture.onPointerDown}
        onPointerMove={singleGesture.onPointerMove}
        onPointerUp={singleGesture.onPointerUp}
        onPointerCancel={singleGesture.onPointerCancel}
        onLostPointerCapture={singleGesture.onLostPointerCapture}
        style={{ position: "relative" }}
      >
        <SinglesStyleCardMediaSurface
          mediaItem={mediaItem}
          cardMedia={cardMedia}
          coverDisplay={coverDisplay}
        />
      </div>
      <div style={{ padding: isMobile ? "10px 12px 14px" : "12px 14px 16px" }}>
        <div
          className={titleClassName}
          style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, marginBottom: 4 }}
        >
          {mediaItem.title}
        </div>
        {access?.showPrice && mediaItem.price != null && Number.isFinite(Number(mediaItem.price)) ? (
          <div
            style={{
              fontSize: 12,
              color: "#00ffff",
              fontWeight: 700,
              marginBottom: isMobile ? 8 : 10,
            }}
          >
            ${Number(mediaItem.price).toFixed(2)}
          </div>
        ) : null}
        {showPlayActions ? (
          <div onClick={(e) => e.stopPropagation()}>
            <ReleaseCardActions
              item={playItemResolved}
              accountState={entitlementAccountState}
              userId={userId}
              isAdmin={isAdminStable}
              source={source}
              onPlayClick={onPlayClick}
              showCart={Boolean(access?.showCart)}
              onLibraryChange={onLibraryChange}
              onAddToCart={(e) => {
                e.stopPropagation();
                addToCart?.(mediaItem);
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
    </PlaybackPrewarmCardShell>
  );
});

/**
 * Shared horizontal scroll row — cloned from Home "Latest Singles" card chrome.
 * Supports video cards (singles) and cover cards (mixtapes/EPs, features-style media).
 */
const LatestSinglesStyleRow = forwardRef(function LatestSinglesStyleRow(
  {
    items = [],
    isMobile,
    onGift,
    onCardClick,
    onPlayClick,
    addToCart,
    onLibraryChange,
    source = "home_card",
    cardMedia = "video",
    titleClassName = "song-title-turquoise-glow",
    rowClassName = "singles-row",
  },
  ref
) {
  const prevItemsLenRef = useRef(items?.length ?? 0);
  const stickyItemsRef = useRef(items);

  if (items?.length) {
    stickyItemsRef.current = items;
  }

  const renderItems = items?.length ? items : stickyItemsRef.current;

  useEffect(() => {
    if (!isUiHydrationTraceEnabled()) return;
    const count = items?.length ?? 0;
    logUiHydrationTrace("LATEST_SINGLES_RENDER", { count });
    const prev = prevItemsLenRef.current;
    if (count === 0 && prev > 0) {
      logUiHydrationTrace("LATEST_SINGLES_REMOVED", { prevCount: prev });
      if (stickyItemsRef.current?.length) {
        logUiHydrationTrace("LATEST_SINGLES_STICKY_RENDER", {
          stickyCount: stickyItemsRef.current.length,
        });
      }
    }
    if (count > 0 && prev === 0) {
      logUiHydrationTrace("LATEST_SINGLES_RESTORED", { count });
    }
    prevItemsLenRef.current = count;
  }, [items?.length]);

  if (!renderItems?.length) return null;

  return (
    <div
      ref={ref}
      className={rowClassName}
      style={{
        flex: 1,
        display: "flex",
        gap: isMobile ? 12 : 18,
        overflowX: "auto",
        paddingBottom: 14,
        scrollSnapType: "x mandatory",
        WebkitOverflowScrolling: "touch",
        overflowY: "hidden",
        overscrollBehaviorX: "contain",
        touchAction: "pan-x pan-y",
        flexWrap: "nowrap",
        width: "100%",
        minWidth: 0,
      }}
    >
      {renderItems.map((rawItem, i) => {
        const stableKey = rawItem.slug || rawItem.id;
        if (!stableKey) return null;
        return (
          <SinglesStyleCard
            key={stableKey}
            item={rawItem}
            index={i}
            isMobile={isMobile}
            onGift={onGift}
            onCardClick={onCardClick}
            onPlayClick={onPlayClick}
            addToCart={addToCart}
            onLibraryChange={onLibraryChange}
            source={source}
            cardMedia={cardMedia}
            titleClassName={titleClassName}
            isFirstCard={i === 0}
          />
        );
      })}
    </div>
  );
});

export default memo(LatestSinglesStyleRow);
