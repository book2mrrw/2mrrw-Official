"use client";

export function PlusIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none" aria-hidden>
      <line x1="13" y1="4" x2="13" y2="22" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <line x1="4" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function BookmarkIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 4h8a2 2 0 012 2v16l-8-4-8 4V6a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlaylistIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 6h14M5 12h10M5 18h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18" cy="17" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M18 14v-2.5a2.5 2.5 0 015 0V17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
