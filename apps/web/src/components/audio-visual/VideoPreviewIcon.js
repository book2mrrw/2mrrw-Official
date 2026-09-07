"use client";

import VideoIcon from "@/components/audio-visual/VideoIcon";

const ICON_BTN_STYLE = {
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(0, 255, 255, 0.35)",
  borderRadius: 10,
  padding: 6,
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  boxShadow: "0 0 12px rgba(0, 255, 255, 0.15)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

/**
 * Top-right, clickable "this release has a music video" trigger — shown to
 * every viewer (including admins, who are also front-end viewers) only
 * when the item carries an audio_visual_id (see catalog-db.js's
 * mapProductRow). `offsetTop` lets a caller shift it down when the admin
 * GiftOverlayButton already occupies the same top-right corner, rather than
 * changing that unrelated shared component.
 */
export function VideoPreviewIcon({ onClick, offsetTop = 8, style = {} }) {
  return (
    <button
      type="button"
      aria-label="Watch music video"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      style={{
        position: "absolute",
        top: offsetTop,
        right: 8,
        zIndex: 10,
        cursor: "pointer",
        ...ICON_BTN_STYLE,
        ...style,
      }}
    >
      <VideoIcon size={16} />
    </button>
  );
}

/**
 * Passive, non-interactive top-left marker shown only to admins — an
 * internal "this card has a video linked" indicator, distinct from the
 * front-facing preview trigger above. Never a separate control.
 */
export function AdminVideoLinkedMarker({ style = {} }) {
  return (
    <div
      aria-hidden
      title="Video linked to this release"
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        zIndex: 10,
        pointerEvents: "none",
        opacity: 0.85,
        ...ICON_BTN_STYLE,
        ...style,
      }}
    >
      <VideoIcon size={14} />
    </div>
  );
}
