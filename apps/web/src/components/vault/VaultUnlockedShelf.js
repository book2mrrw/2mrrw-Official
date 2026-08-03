"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const ITEM_HEIGHT = 220;
const OVERSCAN = 3;

/**
 * Virtualized vault shelf — preserves item markup; container only windowed.
 */
export function VaultUnlockedShelf({ sections = [] }) {
  const parentRef = useRef(null);
  const virtualizer = useVirtualizer({
    count: sections.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: OVERSCAN,
  });

  if (!sections.length) return null;

  return (
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
  );
}
