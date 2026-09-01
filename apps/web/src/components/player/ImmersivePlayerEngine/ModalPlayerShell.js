"use client";

import { memo, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { PLAYER_SPRING, PLAYER_SPRING_EXIT } from "@/lib/player/constants";
import { registerModal, unregisterModal } from "@/state/ui/modalStackStore";
import { ModalErrorBoundary } from "@/system/errors";
import { useModalTiming } from "@/system/performance";

const OVERLAY_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.34, ease: [0.33, 0, 0.2, 1] },
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

/** @deprecated Legacy immersive shell — retained for engine exports only. */
function ModalPlayerShell({
  isMobile,
  paletteVars = {},
  onOverlayClick,
  onDragEnd,
  children,
  className = "",
  desktopStyle,
  stackId = "modal-shell",
  onClose,
}) {
  const { onModalOpenStart, onModalOpenEnd } = useModalTiming();

  useEffect(() => {
    registerModal(stackId);
    onModalOpenStart();
    onModalOpenEnd();
    return () => unregisterModal(stackId);
  }, [stackId, onModalOpenStart, onModalOpenEnd]);

  const shellVariant = isMobile ? SHEET_UP : MODAL_CENTER;
  const shellClassName = useMemo(
    () =>
      [
        "modal-immersive-shell",
        "player-immersive-shell",
        !isMobile ? "modal-immersive-shell--desktop" : "",
        className,
      ]
        .filter(Boolean)
        .join(" "),
    [isMobile, className]
  );
  const shellStyle = useMemo(
    () => (isMobile ? paletteVars : { ...paletteVars, ...desktopStyle }),
    [isMobile, paletteVars, desktopStyle]
  );

  return (
    <motion.div
      key="modal-shell-overlay"
      {...OVERLAY_FADE}
      onClick={onOverlayClick}
      className={["modal-immersive-overlay", !isMobile ? "modal-immersive-overlay--desktop" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <motion.div
        key="modal-shell-body"
        {...shellVariant}
        exit={{ ...shellVariant.exit, transition: isMobile ? PLAYER_SPRING_EXIT : { duration: 0.32 } }}
        onClick={(e) => e.stopPropagation()}
        className={shellClassName}
        style={{ position: "relative", ...shellStyle }}
        drag={isMobile ? "y" : false}
        dragConstraints={isMobile ? { top: 0, bottom: 0 } : undefined}
        dragElastic={isMobile ? { top: 0, bottom: 0.38 } : undefined}
        onDragEnd={isMobile ? onDragEnd : undefined}
      >
        <ModalErrorBoundary stackId={stackId} onClose={onClose}>
          {children}
        </ModalErrorBoundary>
      </motion.div>
    </motion.div>
  );
}

export default memo(ModalPlayerShell);
