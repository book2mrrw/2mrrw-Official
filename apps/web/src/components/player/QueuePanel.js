"use client";

import { memo, useCallback, useRef, useState } from "react";
import { useAudioPlayer } from "@/context/AudioContext";

// ─── Drag state — module-level so all rows share a single source-of-truth ────
let _dragFromIndex = null;

// ─── Individual queue row ──────────────────────────────────────────────────────
const QueueRow = memo(function QueueRow({
  track,
  index,
  isCurrent,
  isPast,
  onRemove,
  onMove,
}) {
  const rowRef = useRef(null);
  const [draggingOver, setDraggingOver] = useState(false);

  const handleDragStart = useCallback((e) => {
    _dragFromIndex = index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }, [index]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDraggingOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDraggingOver(false);
    if (_dragFromIndex !== null && _dragFromIndex !== index) {
      onMove(_dragFromIndex, index);
    }
    _dragFromIndex = null;
  }, [index, onMove]);

  const handleDragEnd = useCallback(() => {
    setDraggingOver(false);
    _dragFromIndex = null;
  }, []);

  const coverSrc = track.cover || track.coverArt || track.baseCover || null;
  const title = track.title || "Unknown Track";
  const artist = track.artist || "2MRRW";

  return (
    <div
      ref={rowRef}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        borderRadius: 6,
        cursor: "grab",
        background: isCurrent
          ? "rgba(255,255,255,0.08)"
          : draggingOver
          ? "rgba(255,255,255,0.05)"
          : "transparent",
        borderLeft: isCurrent ? "2px solid rgba(255,255,255,0.6)" : "2px solid transparent",
        opacity: isPast ? 0.4 : 1,
        transition: "background 0.12s, opacity 0.12s",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Drag handle */}
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 2,
          flexShrink: 0,
          opacity: 0.35,
          padding: "2px 4px",
        }}
        aria-hidden
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              display: "block",
              width: 14,
              height: 1.5,
              background: "currentColor",
              borderRadius: 1,
            }}
          />
        ))}
      </span>

      {/* Cover art */}
      {coverSrc ? (
        <img
          src={coverSrc}
          alt=""
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 4,
            objectFit: "cover",
            flexShrink: 0,
            background: "rgba(255,255,255,0.06)",
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 4,
            flexShrink: 0,
            background: "rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            color: "rgba(255,255,255,0.2)",
          }}
        >
          ♫
        </span>
      )}

      {/* Track info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: isCurrent ? 600 : 400,
            color: isCurrent ? "#fff" : "rgba(255,255,255,0.85)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            lineHeight: 1.3,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.4)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginTop: 2,
          }}
        >
          {artist}
        </div>
      </div>

      {/* Playing indicator (current track only) */}
      {isCurrent && (
        <span
          aria-label="Now playing"
          style={{
            flexShrink: 0,
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#fff",
            opacity: 0.9,
          }}
        />
      )}

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Remove ${title} from queue`}
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          borderRadius: 4,
          color: "rgba(255,255,255,0.3)",
          fontSize: 16,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "color 0.1s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
      >
        ×
      </button>
    </div>
  );
});

// ─── QueuePanel ────────────────────────────────────────────────────────────────
/**
 * Drag-and-drop queue management panel.
 *
 * @param {{ show?: boolean, onClose?: () => void, style?: object }} props
 */
export const QueuePanel = memo(function QueuePanel({ show = true, onClose, style }) {
  const { state, moveInQueue, removeFromQueue } = useAudioPlayer();
  const queue = state?.queue ?? [];
  const queueIndex = state?.queueIndex ?? -1;

  const handleMove = useCallback(
    (from, to) => {
      moveInQueue(from, to);
    },
    [moveInQueue]
  );

  const handleRemove = useCallback(
    (index) => {
      removeFromQueue(index);
    },
    [removeFromQueue]
  );

  if (!show) return null;
  if (!queue.length) {
    return (
      <div
        style={{
          padding: "24px 16px",
          textAlign: "center",
          color: "rgba(255,255,255,0.35)",
          fontSize: 13,
          ...style,
        }}
      >
        Queue is empty
      </div>
    );
  }

  const upcomingCount = queue.length - queueIndex - 1;

  return (
    <div
      role="region"
      aria-label="Playback queue"
      style={{
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px 6px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Up Next
          {upcomingCount > 0 && (
            <span style={{ marginLeft: 6, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>
              · {upcomingCount}
            </span>
          )}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close queue"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "rgba(255,255,255,0.4)",
              fontSize: 18,
              lineHeight: 1,
              padding: 2,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Track list */}
      <div
        style={{
          overflowY: "auto",
          flex: 1,
          padding: "4px 0",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {queue.map((track, i) => (
          <QueueRow
            key={`${track.slug ?? track.id ?? i}:${i}`}
            track={track}
            index={i}
            isCurrent={i === queueIndex}
            isPast={i < queueIndex}
            onRemove={handleRemove}
            onMove={handleMove}
          />
        ))}
      </div>
    </div>
  );
});

export default QueuePanel;
