/**
 * Canonical platform detection. Plain functions, no React dependency, so
 * both non-component code (VideoResourceManager) and components (via
 * hooks/usePlatform.js) can use the same implementation instead of each
 * keeping their own copy of the same UA sniff.
 */

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = String(navigator.userAgent || "");
  const hasTouchDocument = typeof document !== "undefined" && "ontouchend" in document;
  return /iP(hone|ad|od)/i.test(ua) || (/Macintosh/i.test(ua) && hasTouchDocument);
}
