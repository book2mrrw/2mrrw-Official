/**
 * Storefront release helpers (MASTER-PROMPT 2026-05-22).
 * Catalog source remains control-system APIs — these utilities shape display only.
 */

export const LYRICS_LABEL = "GLYPHS";

export function isDeluxe(release) {
  const type = release?.releaseType || release?.release_type || release?.type;
  return type === "deluxe" || type === "Deluxe";
}

export function partitionReleases(releases) {
  const list = Array.isArray(releases) ? releases : [];
  return {
    singles: list.filter((r) => {
      const t = r?.releaseType || r?.release_type || r?.type;
      return t === "single";
    }),
    eps: list.filter((r) => {
      const t = r?.releaseType || r?.release_type || r?.type;
      return t === "ep";
    }),
    albums: list.filter((r) => {
      const t = r?.releaseType || r?.release_type || r?.type;
      return t === "album" || t === "deluxe" || t === "Deluxe";
    }),
  };
}

export function getDisplayDate(release) {
  const raw = release?.releaseDate || release?.release_date || release?.date;
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  const status = release?.status || release?.controlSystemReleaseStatus;
  const isUpcoming = d > new Date() || status === "scheduled" || status === "Scheduled";
  const formatted = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return isUpcoming ? `Upcoming · ${formatted}` : formatted;
}
