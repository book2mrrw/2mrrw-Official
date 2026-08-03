"use client";

import { motion } from "framer-motion";

const ICON_DIM = 22;

const WRAPPER = {
  position: "relative",
  width: ICON_DIM,
  height: ICON_DIM,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const DEEP_GOLD = "#C9A84C";
const GLOW_GOLD = "#FFD700";
const GLISTEN = "#FFF4A3";

const BREATHING_GLOW = [
  `0 0 3px 1px ${DEEP_GOLD}44, 0 0 6px 2px ${GLOW_GOLD}22`,
  `0 0 10px 4px ${DEEP_GOLD}66, 0 0 18px 7px ${GLOW_GOLD}55`,
  `0 0 3px 1px ${DEEP_GOLD}44, 0 0 6px 2px ${GLOW_GOLD}22`,
];

/** Mobile bottom nav vault lock — breathing glow + glisten sweep only. */
export function VaultNavLockIcon() {
  return (
    <div style={WRAPPER}>
      <motion.div
        animate={{ boxShadow: BREATHING_GLOW }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
        }}
      >
        <div
          style={{
            position: "relative",
            width: ICON_DIM,
            height: ICON_DIM,
            overflow: "hidden",
            borderRadius: 4,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width={ICON_DIM}
            height={ICON_DIM}
            style={{ position: "relative", zIndex: 1 }}
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <motion.div
            aria-hidden
            animate={{ x: ["-140%", "140%"] }}
            transition={{
              duration: 5,
              repeat: Infinity,
              ease: "easeInOut",
              repeatDelay: 0.4,
            }}
            style={{
              position: "absolute",
              top: -2,
              bottom: -2,
              left: 0,
              width: "58%",
              background: `linear-gradient(105deg, transparent 26%, ${GLISTEN}cc 48%, transparent 70%)`,
              transform: "skewX(-16deg)",
              pointerEvents: "none",
              zIndex: 2,
            }}
          />
        </div>
      </motion.div>
    </div>
  );
}
