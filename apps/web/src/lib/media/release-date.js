/** Pure release-date helpers — no media/catalog imports (safe for client + server). */

export function isUpcomingReleaseDate(dateStr) {
  if (!dateStr) return false;
  const parsed = Date.parse(dateStr);
  if (!Number.isNaN(parsed)) return parsed > Date.now();
  const yearMatch = String(dateStr).match(/\b(20\d{2})\b/);
  if (!yearMatch) return false;
  return Number(yearMatch[1]) >= new Date().getFullYear();
}
