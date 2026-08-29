"use client";

import { memo } from "react";
import { usePlaybackChromeLayout } from "@/hooks/usePlaybackChromeLayout";

/** Applies playback-driven bottom inset below hero without re-rendering Hero. */
const ScrollPaddingShell = memo(function ScrollPaddingShell({ isMobile, children }) {
  const { mobileScrollPadding } = usePlaybackChromeLayout();

  return (
    <div style={{ padding: isMobile ? `0 0 ${mobileScrollPadding} 0` : "0 30px 30px" }}>
      <div style={{ padding: isMobile ? "0 14px" : "0" }}>{children}</div>
    </div>
  );
});

export default ScrollPaddingShell;
