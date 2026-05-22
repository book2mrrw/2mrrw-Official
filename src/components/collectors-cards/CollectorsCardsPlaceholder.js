"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { COLLECTORS_CARDS_LABEL } from "@/lib/collectors-cards";

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
};

export function CollectorsCardsPlaceholder() {
  return (
    <motion.main
      {...fadeUp}
      style={{
        minHeight: "100vh",
        background: "#050505",
        color: "white",
        fontFamily: "'Helvetica Now','Helvetica Neue',Helvetica,Arial,sans-serif",
        padding: "48px 20px 120px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 28,
          fontWeight: 900,
          letterSpacing: 6,
          textShadow: "0 0 24px rgba(0,255,255,0.45)",
          marginBottom: 8,
        }}
      >
        2MRRW
      </div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: 4,
          color: "#00ffff",
          textTransform: "uppercase",
          marginBottom: 32,
        }}
      >
        {COLLECTORS_CARDS_LABEL}
      </div>
      <motion.div
        animate={{
          boxShadow: [
            "0 0 20px rgba(0,255,255,0.15)",
            "0 0 40px rgba(64,224,208,0.35)",
            "0 0 20px rgba(0,255,255,0.15)",
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        style={{
          width: "min(320px, 88vw)",
          aspectRatio: "3 / 4",
          borderRadius: 18,
          border: "1px solid rgba(0,255,255,0.2)",
          background:
            "linear-gradient(145deg, rgba(0,255,255,0.06) 0%, rgba(10,10,10,0.95) 45%, rgba(162,89,255,0.08) 100%)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          marginBottom: 28,
          overflow: "visible",
        }}
      >
        <div style={{ fontSize: 36, lineHeight: 1 }}>🃏</div>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>Physical ownership tokens</div>
        <div style={{ fontSize: 12, color: "#666", lineHeight: 1.7, maxWidth: 260 }}>
          Numbered drops, hand-signed stock, QR and NFC access. The full collector experience is opening here.
        </div>
      </motion.div>
      <p style={{ fontSize: 13, color: "#555", lineHeight: 1.8, maxWidth: 360, marginBottom: 24 }}>
        Not merch. Proof you were here when the signal was still forming.
      </p>
      <Link
        href="/"
        style={{
          padding: "12px 22px",
          borderRadius: 10,
          border: "1px solid rgba(0,255,255,0.35)",
          color: "#00ffff",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 2,
          textDecoration: "none",
        }}
      >
        ← Back to 2MRRW
      </Link>
    </motion.main>
  );
}
