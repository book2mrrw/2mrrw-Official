"use client";

import { memo } from "react";

/** Opens the broadcast in place (the Live tab), in the app and on the website: never a page load. */
function openLiveBroadcast() {
  window.dispatchEvent(new CustomEvent("2mrrw:open-tab", { detail: { tabId: "live" } }));
}

/** Shown while a 2MRRW Live is on air or coming up. */
export const JoinLiveButton = memo(function JoinLiveButton() {
  return (
    <button
      type="button"
      onClick={openLiveBroadcast}
      style={{ width: "100%", boxSizing: "border-box", marginTop: 14, padding: "12px 0", background: "#00ffff", color: "#000", fontSize: 13, fontWeight: 900, letterSpacing: 2, border: "none", borderRadius: 10, cursor: "pointer" }}
    >
      JOIN 2MRRW LIVE
    </button>
  );
});

/** In place of the countdown while no 2MRRW Live is scheduled. */
export function LiveTba({ fontSize, style }) {
  return (
    <div style={{ fontSize, fontWeight: 900, color: "#00ffff", letterSpacing: 4, lineHeight: 1, textAlign: "center", ...style }}>
      T.B.A.
    </div>
  );
}
