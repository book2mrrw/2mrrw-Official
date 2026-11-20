/**
 * Release-card play counts: "842", "1.2K", "12K", "123K", "1.2M".
 * Client-safe (no server imports). Rounds down so a card never claims more
 * plays than happened (1,999 shows "1.9K", not "2K").
 */
/** n / unit floored to one decimal, in integer math (no 2.3 * 10 = 22.999… surprises). */
function oneDecimal(n, unit) {
  const tenths = Math.floor(n / (unit / 10));
  return tenths % 10 === 0 ? String(tenths / 10) : `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function formatPlayCount(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1_000) return String(n);
  if (n < 10_000) return `${oneDecimal(n, 1_000)}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1_000)}K`;
  if (n < 10_000_000) return `${oneDecimal(n, 1_000_000)}M`;
  return `${Math.floor(n / 1_000_000)}M`;
}

/** Full number for screen readers and tooltips: "12,345 plays". */
export function playCountLabel(count) {
  const n = Math.floor(Number(count));
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toLocaleString("en-US")} ${n === 1 ? "play" : "plays"}`;
}
