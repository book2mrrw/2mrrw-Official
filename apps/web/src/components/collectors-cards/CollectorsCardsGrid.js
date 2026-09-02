"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAuth } from "@/context/AuthContext";
import { COLLECTORS_CARDS_LABEL } from "@/lib/collectors-cards";
import { COLLECTOR_CARDS_CATALOG } from "./collectorCardCatalog";
import { CollectorCardItem } from "./CollectorCardItem";
import { CollectorCardModal } from "./CollectorCardModal";
import { useCollectorInventory } from "./useCollectorInventory";

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
};

export function CollectorsCardsGrid() {
  const [selected, setSelected] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const { getLeft, decrement } = useCollectorInventory();
  const { refreshAccountState } = useAuth();

  const handlePurchaseComplete = (slug) => {
    decrement(slug);
    void refreshAccountState({ reason: "collector:updated", source: "CollectorsCardsGrid" });
  };

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    setIsMobile(mql.matches);
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return (
    <motion.main
      {...fadeUp}
      style={{
        minHeight: "100vh",
        background: "#050505",
        color: "white",
        fontFamily: "'Helvetica Now','Helvetica Neue',Helvetica,Arial,sans-serif",
        padding: isMobile ? "32px 16px 120px" : "48px 24px 120px",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: isMobile ? 28 : 40 }}>
          <div
            style={{
              fontSize: isMobile ? 22 : 28,
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
              marginBottom: 12,
            }}
          >
            {COLLECTORS_CARDS_LABEL}
          </div>
          <p
            style={{
              fontSize: 13,
              color: "#555",
              lineHeight: 1.8,
              maxWidth: 480,
              margin: "0 auto",
            }}
          >
            Album artwork as the card face — numbered physical ownership tokens with Vault and streaming access.
          </p>
        </div>

        <section aria-labelledby="collectors-cards-heading">
          <h1
            id="collectors-cards-heading"
            className="section-heading"
            style={{
              fontSize: isMobile ? 18 : 22,
              fontWeight: 800,
              letterSpacing: 3,
              textTransform: "uppercase",
              marginBottom: isMobile ? 20 : 28,
              textAlign: "center",
            }}
          >
            Collector&apos;s Cards
          </h1>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(3, minmax(0, 1fr))",
              gap: isMobile ? 14 : 24,
            }}
          >
            {COLLECTOR_CARDS_CATALOG.map((card) => (
              <CollectorCardItem
                key={card.id}
                card={card}
                remaining={getLeft(card.slug)}
                onSelect={setSelected}
                isMobile={isMobile}
              />
            ))}
          </div>
        </section>

        <div style={{ textAlign: "center", marginTop: 36 }}>
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
        </div>
      </div>

      {selected && (
        <CollectorCardModal
          card={selected}
          remaining={getLeft(selected.slug)}
          onClose={() => setSelected(null)}
          isMobile={isMobile}
          onPurchaseComplete={handlePurchaseComplete}
        />
      )}
    </motion.main>
  );
}
