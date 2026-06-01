"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { usePlaybackChrome } from "@/components/storefront/playback-chrome-context";

/** Applies playback-driven bottom inset below hero without re-rendering Hero. */
const ScrollPaddingShell = memo(function ScrollPaddingShell({ isMobile, children }) {
  const { mobileScrollPadding } = usePlaybackChrome();

  return (
    <motion.div style={{ padding: isMobile ? `0 0 ${mobileScrollPadding} 0` : "0 30px 30px" }}>
      <motion.div style={{ padding: isMobile ? "0 14px" : "0" }}>{children}</motion.div>
    </motion.div>
  );
});

export default ScrollPaddingShell;
