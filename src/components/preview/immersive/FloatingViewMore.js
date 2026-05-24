"use client";

import { memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { paletteToCssVars } from "@/hooks/useCoverPalette";

const DRAWER_SPRING = { type: "spring", stiffness: 340, damping: 36 };

function FloatingViewMore({
  open,
  onToggle,
  onCollapse,
  isMobile,
  creditRows,
  handleDrawerDragEnd,
  palette,
}) {
  return (
    <>
      <button
        type="button"
        className="modal-immersive-view-more"
        style={paletteToCssVars(palette)}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        View More
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="view-more-drawer"
            drag={isMobile ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.35 }}
            onDragEnd={isMobile ? handleDrawerDragEnd : undefined}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={DRAWER_SPRING}
            className="modal-immersive-drawer"
            style={paletteToCssVars(palette)}
            onClick={(e) => e.stopPropagation()}
          >
            {isMobile ? (
              <button
                type="button"
                className="modal-immersive-drawer__handle"
                aria-label="Collapse credits"
                onClick={onCollapse}
              />
            ) : null}
            <div className="preview-credits-heading">CREDITS</div>
            {creditRows.length ? (
              creditRows.map(({ key, label, value }) => (
                <div key={key} className="modal-immersive-drawer__row">
                  <span className="modal-immersive-drawer__label">{label}</span>
                  <span className="modal-immersive-drawer__value">{value}</span>
                </div>
              ))
            ) : (
              <p className="modal-immersive-drawer__empty">Credits available soon.</p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

export default memo(FloatingViewMore);
