"use client";

import { forwardRef } from "react";
import CoverArt from "@/components/ui/CoverArt";
import GiftOverlayButton from "@/components/gifts/GiftOverlayButton";
import { ReleaseCardActions } from "@/components/music/ReleaseCardPlayButton";
import PlaybackPrewarmCardShell from "@/components/music/PlaybackPrewarmCardShell";
import { itemHasPlayableAudio, resolveContentAccess } from "@/lib/music-access";
import { albumCardPlaybackItem } from "@/lib/music-playback";
import { withR2CatalogMedia, catalogCoverDisplay } from "@/components/home/catalogMedia";

/**
 * Shared horizontal scroll row — cloned from Home "Latest Singles" card chrome.
 * Supports video cards (singles) and cover cards (mixtapes/EPs, features-style media).
 */
export default forwardRef(function LatestSinglesStyleRow(
  {
    items = [],
    isMobile,
    isAdmin = false,
    onGift,
    onCardClick,
    onPlayClick,
    addToCart,
    accountState,
    userId,
    onLibraryChange,
    source = "home_card",
    cardMedia = "video",
    catalogPlaybackLookup = null,
    titleClassName = "song-title-turquoise-glow",
    rowClassName = "singles-row",
  },
  ref
) {
  if (!items?.length) return null;

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
        overscrollBehaviorX: "contain",
        flexWrap: "nowrap",
        width: "100%",
        minWidth: 0,
      }}
    >
      {items.map((rawItem, i) => {
        const item = withR2CatalogMedia(rawItem);
        const access = resolveContentAccess(item, accountState);
        const showPlayActions = itemHasPlayableAudio(item, access);
        const playItem =
          cardMedia === "cover" && catalogPlaybackLookup
            ? albumCardPlaybackItem(item, catalogPlaybackLookup)
            : item;
        const coverDisplay = catalogCoverDisplay(item);

        return (
          <PlaybackPrewarmCardShell
            key={item.slug || item.id || `row-card-${i}`}
            releaseItem={item}
            playItem={playItem}
            catalogPlaybackLookup={catalogPlaybackLookup}
            accountState={accountState}
            userId={userId}
            source={source}
            isAlbumCard={cardMedia === "cover"}
            enabled={showPlayActions}
            data-single-card={cardMedia === "video" ? true : undefined}
            onClick={() => onCardClick?.(item)}
            style={{
              flex: "0 0 auto",
              width: isMobile ? 160 : 200,
              cursor: "pointer",
              scrollSnapAlign: "start",
              opacity: 0,
              animation: `fadeInUp 0.5s ease ${i * 0.09}s forwards`,
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
            {isAdmin ? <GiftOverlayButton onClick={() => onGift?.(item)} /> : null}
            {cardMedia === "video" ? (
              <video
                data-single-carousel
                src={item.video || undefined}
                poster={item.cover || undefined}
                muted
                loop
                playsInline
                preload="metadata"
                webkit-playsinline="true"
                style={{
                  width: "100%",
                  aspectRatio: "1/1",
                  objectFit: "cover",
                  display: "block",
                  borderRadius: "13px 13px 0 0",
                  transition: "transform 0.3s, filter 0.3s",
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
                style={{
                  aspectRatio: "1/1",
                  display: "block",
                  pointerEvents: "none",
                }}
              />
            )}
            <div style={{ padding: isMobile ? "10px 12px 14px" : "12px 14px 16px" }}>
              <div
                className={titleClassName}
                style={{ fontSize: isMobile ? 12 : 13, fontWeight: 700, marginBottom: 4 }}
              >
                {item.title}
              </div>
              {access?.showPrice && item.price != null && Number.isFinite(Number(item.price)) ? (
                <div
                  style={{
                    fontSize: 12,
                    color: "#00ffff",
                    fontWeight: 700,
                    marginBottom: isMobile ? 8 : 10,
                  }}
                >
                  ${Number(item.price).toFixed(2)}
                </div>
              ) : null}
              {showPlayActions ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <ReleaseCardActions
                    item={withR2CatalogMedia(playItem)}
                    accountState={accountState}
                    userId={userId}
                    source={source}
                    onPlayClick={onPlayClick}
                    showCart={Boolean(access?.showCart)}
                    onLibraryChange={onLibraryChange}
                    onAddToCart={(e) => {
                      e.stopPropagation();
                      addToCart?.(item);
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
      })}
    </div>
  );
});
