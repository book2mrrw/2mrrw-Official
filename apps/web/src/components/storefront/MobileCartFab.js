"use client";

import { memo } from "react";
import { motion } from "framer-motion";

const MobileCartFab = memo(function MobileCartFab({ cartCount, onOpen }) {
  return (
    <motion.button
      className="storefront-cart-fab"
      onClick={onOpen}
      style={{
        position: "fixed",
        right: 16,
        zIndex: 6800,
        width: 50,
        height: 50,
        borderRadius: "50%",
        background: "#00ffff",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 24px rgba(0,255,255,0.4)",
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2" width="20" height="20">
        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 01-8 0" />
      </svg>
      {cartCount > 0 ? (
        <motion.div
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            padding: "0 5px",
            background: "#ff4d4d",
            color: "white",
            fontSize: 10,
            fontWeight: 900,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {cartCount}
        </motion.div>
      ) : null}
    </motion.button>
  );
});

export default MobileCartFab;
