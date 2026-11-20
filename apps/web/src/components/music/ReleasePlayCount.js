import { formatPlayCount, playCountLabel } from "@/lib/analytics/play-count-format";

/**
 * "▶ 12.3K" at the bottom of a release card. Pure: no state, no effects —
 * the count arrives with the card's catalog data, so it adds no render.
 * Nothing is shown until a release has its first play.
 */
export default function ReleasePlayCount({ count }) {
  const text = formatPlayCount(count);
  if (!text) return null;
  const label = playCountLabel(count);
  return (
    <div
      className="release-card-play-count"
      title={label}
      aria-label={label}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, color: "rgba(255,255,255,.55)", fontSize: 11, fontWeight: 600, letterSpacing: 0.4, fontVariantNumeric: "tabular-nums" }}
    >
      <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true" focusable="false">
        <path d="M0 0.8v8.4c0 .62.68 1 1.21.68l7.02-4.2a.8.8 0 0 0 0-1.36L1.21.12C.68-.2 0 .18 0 .8z" fill="currentColor" />
      </svg>
      <span aria-hidden="true">{text}</span>
    </div>
  );
}
