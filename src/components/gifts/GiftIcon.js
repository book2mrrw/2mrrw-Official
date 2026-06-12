"use client";

const AMBER = "#d4a853";
const AMBER_SOFT = "rgba(212, 168, 83, 0.55)";

/**
 * Minimal cinematic gift mark — monochrome amber-gold with subtle glow.
 */
export default function GiftIcon({ size = 20, style = {}, title = "Gift" }) {
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
      <defs>
        <filter id="giftIconGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g filter="url(#giftIconGlow)" stroke={AMBER} strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 11v10" opacity="0.9" />
        <path d="M5 11h14v10H5z" fill="rgba(212,168,83,0.12)" />
        <path d="M5 11h14" />
        <path d="M12 11V7.5" />
        <path
          d="M8.2 7.5c0-1.4 1.1-2.2 2.3-1.2.6.5 1.2 1.2 1.5 1.2.3 0 .9-.7 1.5-1.2 1.2-1 2.3-.2 2.3 1.2 0 .9-.8 1.5-1.8 1.5H10c-1 0-1.8-.6-1.8-1.5z"
          fill="rgba(212,168,83,0.18)"
        />
        <path d="M12 7.5V11" />
      </g>
      <circle cx="12" cy="6" r="5.5" fill="none" stroke={AMBER_SOFT} strokeWidth="0.5" opacity="0.35" />
    </svg>
  );
}

export const giftIconColor = AMBER;
