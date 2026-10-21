import { creditRows, normalizeCredits } from "@/lib/credits/contract";

export function getReleaseEditorial(release) {
  const rows = creditRows(release);
  const byRole = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    writtenBy: byRole.songwriter || null,
    producedBy: byRole.producer || null,
    featuredArtists: byRole.featured_artist || null,
    mixingEngineer: byRole.mixing_engineer || null,
    masteringEngineer: byRole.mastering_engineer || null,
    recordLabel: byRole.label || null,
    releaseDate: release?.releaseDate || release?.release_date || release?.date || null,
    genre: release?.genre || release?.metadata?.genre || null,
    creditRows: rows,
    credits: normalizeCredits(release),
  };
}
export function getCreditsDisplayRows(editorial) { return editorial?.creditRows || []; }
export const EDITORIAL_ROWS = [];
