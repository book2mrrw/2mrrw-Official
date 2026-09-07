"use client";

const CYAN = "#00ffff";
const CYAN_SOFT = "rgba(0, 255, 255, 0.55)";

/** Minimal play-in-frame mark — monochrome cyan, matching GiftIcon's structure. */
export default function VideoIcon({ size = 16, style = {}, title = "Watch video" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      style={{ display: "block", flexShrink: 0, ...style }}
    >
      <rect x="3.25" y="5.5" width="17.5" height="13" rx="3" stroke={CYAN} strokeWidth="1.35" fill="rgba(0,255,255,0.10)" />
      <path d="M10.5 9.3v5.4l4.6-2.7-4.6-2.7z" fill={CYAN} />
      <circle cx="12" cy="12" r="10.2" fill="none" stroke={CYAN_SOFT} strokeWidth="0.5" opacity="0.3" />
    </svg>
  );
}

export const videoIconColor = CYAN;
