"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import CoverArt from "@/components/ui/CoverArt";
import { usePagePlaybackActions } from "@/hooks/usePagePlaybackActions";

const VaultVideoPlayer = dynamic(
  () => import("@/components/vault/VaultVideoPlayer").then((m) => m.VaultVideoPlayer ?? m.default),
  { ssr: false }
);

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
 * Persistent vault shelf. CSS containment bounds layout and paint work while
 * every row keeps its DOM and media identity throughout scrolling.
 */
export function VaultUnlockedShelf({ sections = [] }) {
  const [activeItem, setActiveItem] = useState(null);
  const { pause } = usePagePlaybackActions();

  if (!sections.length) return null;

  return (
    <>
    <div
      className="vault-unlocked-shelf"
      aria-label="Vault shelves"
      style={{ maxHeight: "min(70vh, 720px)", overflowY: "auto" }}
    >
        {sections.map((item, index) => {
          return (
            <article
              key={item.slug || item.id}
              data-index={index}
              className={`vault-unlocked-object${item.metadata?.glowEffect || item.feature ? " vault-unlocked-object--glow" : ""}`}
              data-media={item.mediaType || item.behavior || "mixed"}
              style={{
                width: "100%",
                contain: "layout style paint",
              }}
            >
              <div className="vault-unlocked-object__spine" aria-hidden />
              {item.cover ? (
                <CoverArt
                  src={item.cover}
                  baseCover={item.baseCover || undefined}
                  type={item.coverArtType || "image"}
                  alt=""
                  className="vault-unlocked-object__cover"
                  loadPriority="high"
                />
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
