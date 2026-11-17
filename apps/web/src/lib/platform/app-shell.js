/**
 * True inside the 2MRRW mobile app, whose platform layer sets this flag before
 * any website module runs. It marks the few places where the app deliberately
 * differs from the website (owner decision: Collector's Cards render inline in
 * the app's Home shell instead of on their own page) so they can branch without
 * any other platform sniffing. Always false on the website.
 */
export function isAppShell() {
  return typeof globalThis !== "undefined" && globalThis.__2MRRW_APP_SHELL__ === true;
}
