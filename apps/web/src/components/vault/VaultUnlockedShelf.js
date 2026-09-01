"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAudioPlayer } from "@/context/AudioContext";

const VaultVideoPlayer = dynamic(
  () => import("@/components/vault/VaultVideoPlayer").then((m) => m.VaultVideoPlayer ?? m.default),
  { ssr: false }
);

const ITEM_HEIGHT = 220;
const OVERSCAN = 3;

const PLAY_BTN_STYLE = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0,0,0,0.35)",
  cursor: "pointer",
  border: "none",
  zIndex: 2,
};

const PLAY_ICON_STYLE = {
  width: 44,
  height: 44,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.92)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

/**
 * Virtualized vault shelf — preserves item markup; container only windowed.
 */
export function VaultUnlockedShelf({ sections = [] }) {
  const parentRef = useRef(null);
  const [activeItem, setActiveItem] = useState(null);
  const { pause } = useAudioPlayer();

  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: OVERSCAN,
  });

  if (!sections.length) return null;

  return (
    <>
    <div
      ref={parentRef}
      className="vault-unlocked-shelf vault-unlocked-shelf--virtual"
      aria-label="Vault shelves"
      style={{ maxHeight: "min(70vh, 720px)", overflowY: "auto" }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = sections[virtualRow.index];
          return (
            <article
              key={item.slug || item.id || virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className={`vault-unlocked-object${item.metadata?.glowEffect || item.feature ? " vault-unlocked-object--glow" : ""}`}
              data-media={item.mediaType || item.behavior || "mixed"}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="vault-unlocked-object__spine" aria-hidden />
              {item.cover ? (
                <img src={item.cover} alt="" className="vault-unlocked-object__cover" loading="lazy" />
              ) : (
                <div className="vault-unlocked-object__cover vault-unlocked-object__cover--placeholder" />
              )}
              <div className="vault-unlocked-object__meta">
                <span className="vault-unlocked-object__category">{item.category}</span>
                <strong>{item.title}</strong>
                {item.metadata?.audioQualityBadge ? (
                  <span className="vault-unlocked-object__badge">{item.metadata.audioQualityBadge}</span>
                ) : null}
              </div>
              {item.mediaType === "audio" && item.contentUrl ? (
                <div className="vault-unlocked-object__overlay vault-unlocked-object__overlay--audio">
                  <span>Audio diary</span>
                </div>
              ) : null}
              {item.mediaType === "video" && (item.contentUrl || item.hasMedia) ? (
                <button
                  aria-label={`Play ${item.title}`}
                  style={PLAY_BTN_STYLE}
                  onClick={() => {
                    pause();
                    setActiveItem(item);
                  }}
                >
                  <span style={PLAY_ICON_STYLE}>
                    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                      <path d="M5 3.5L14.5 9 5 14.5V3.5Z" fill="#111" />
                    </svg>
                  </span>
                </button>
              ) : null}
              {item.metadata?.isDropItem ? (
                <div className="vault-unlocked-object__overlay vault-unlocked-object__overlay--promo">
                  <span>Surprise drop</span>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>

    {activeItem ? (
      <VaultVideoPlayer
        contentSlug={activeItem.slug}
        contentId={activeItem.id}
        title={activeItem.title}
        coverUrl={activeItem.cover}
        fallbackUrl={activeItem.contentUrl}
        savedPositionSeconds={0}
        onClose={() => setActiveItem(null)}
        onPauseAudio={pause}
      />
    ) : null}
    </>
  );
}
