"use client";

import { memo } from "react";
import { motion } from "framer-motion";
import { PLAYER_SPRING, PLAYER_SPRING_EXIT } from "@/lib/player/constants";

const OVERLAY_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.28 },
};

const SHEET_UP = {
  initial: { y: "100%", scale: 0.96, opacity: 0.55 },
  animate: { y: 0, scale: 1, opacity: 1 },
  exit: { y: "100%", scale: 0.97, opacity: 0.45 },
  transition: PLAYER_SPRING,
};

const MODAL_CENTER = {
  initial: { opacity: 0, scale: 0.88, y: 24 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.94, y: 12 },
  transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
};

/**
 * Shared shell for preview / release modals — palette vars + drag dismiss on mobile.
 */
function ModalPlayerShell({
  isMobile,
  paletteVars = {},
  onOverlayClick,
  onDragEnd,
  children,
  className = "",
  desktopStyle,
}) {
  const shellVariant = isMobile ? SHEET_UP : MODAL_CENTER;

  if (isMobile) {
    return (
      <motion.div key="player-modal-overlay" {...OVERLAY_FADE} onClick={onOverlayClick} className="modal-immersive-overlay">
        <motion.div
          key="player-modal-shell-mobile"
          {...shellVariant}
          exit={{ ...shellVariant.exit, transition: PLAYER_SPRING_EXIT }}
          onClick={(e) => e.stopPropagation()}
          className={["modal-immersive-shell", "player-immersive-shell", className].filter(Boolean).join(" ")}
          style={paletteVars}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.38 }}
          onDragEnd={onDragEnd}
        >
          {children}
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="player-modal-overlay-desktop"
      {...OVERLAY_FADE}
      onClick={onOverlayClick}
      className="modal-immersive-overlay modal-immersive-overlay--desktop"
    >
      <motion.div
        key="player-modal-shell-desktop"
        {...shellVariant}
        exit={{ ...shellVariant.exit, transition: PLAYER_SPRING_EXIT }}
        onClick={(e) => e.stopPropagation()}
        className={[
          "modal-immersive-shell",
          "modal-immersive-shell--desktop",
          "player-immersive-shell",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ ...paletteVars, ...desktopStyle }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export default memo(ModalPlayerShell);
