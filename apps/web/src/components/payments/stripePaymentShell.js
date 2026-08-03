/**
 * Mobile-safe scroll shells for Stripe Elements modals/sheets.
 * Apply overlay + panel styles so payment fields stay reachable on iOS Safari / Android Chrome.
 */

export function stripePaymentOverlayStyle({ isMobile = false, zIndex = 9999, padding = null } = {}) {
  return {
    position: "fixed",
    inset: 0,
    zIndex,
    display: "flex",
    alignItems: isMobile ? "flex-end" : "center",
    justifyContent: "center",
    padding: padding ?? (isMobile ? 0 : 16),
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
  };
}

export function stripePaymentPanelStyle({ isMobile = false, maxWidth = 420 } = {}) {
  return {
    width: "100%",
    maxWidth: isMobile ? "100%" : maxWidth,
    maxHeight:
      "min(92dvh, calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px))",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    overscrollBehavior: "contain",
    boxSizing: "border-box",
    minHeight: 0,
  };
}

/** Prevents Stripe iframe rows from forcing horizontal overflow inside scroll panels. */
export function stripePaymentFormStyle() {
  return {
    width: "100%",
    minWidth: 0,
    minHeight: 0,
  };
}
