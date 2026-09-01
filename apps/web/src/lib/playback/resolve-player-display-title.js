/** Recovery hydration placeholder — not shown in player title slots (Phase 18A). */
export const RECOVERY_PLACEHOLDER_TITLE = "Restored";

export function isRecoveryPlaceholderTitle(title) {
  return title === RECOVERY_PLACEHOLDER_TITLE;
}

/**
 * Prefer real track titles from playback state; never surface "Restored" in title UI.
 * @param {{ title?: string; slug?: string; id?: string } | null | undefined} track
 * @returns {string}
 */
export function resolvePlayerDisplayTitle(track) {
  if (!track) return "";
  const title = typeof track.title === "string" ? track.title.trim() : "";
  if (title && !isRecoveryPlaceholderTitle(title)) return title;
  const slug = track.slug || track.id;
  if (typeof slug === "string" && slug.trim()) return slug.trim();
  return "";
}
