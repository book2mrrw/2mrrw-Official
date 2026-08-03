/**
 * Safe portal mount target for client-only overlays (SSR returns null).
 * @returns {HTMLElement | null}
 */
export function getClientPortalRoot() {
  if (typeof document === "undefined") return null;
  return document.body ?? null;
}
