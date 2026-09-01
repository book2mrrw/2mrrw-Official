"use client";

import { useEffect, useMemo, useState } from "react";
import { COLLECTOR_CARDS_CATALOG } from "./collectorCardCatalog";

function defaultRemaining() {
  return Object.fromEntries(COLLECTOR_CARDS_CATALOG.map((c) => [c.slug, c.editionSize]));
}

export function useCollectorInventory() {
  const [remaining, setRemaining] = useState(defaultRemaining);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/catalog/exclusive-drops", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const items = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) return;

        const next = { ...defaultRemaining() };
        for (const card of COLLECTOR_CARDS_CATALOG) {
          const row = items.find((item) => item.slug === card.slug);
          if (row?.stock != null && Number.isFinite(Number(row.stock))) {
            next[card.slug] = Math.max(0, Number(row.stock));
          }
        }
        if (!cancelled) setRemaining(next);
      } catch {
        /* keep defaults */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const getLeft = useMemo(
    () => (slug) => {
      const n = remaining[slug];
      return typeof n === "number" ? n : COLLECTOR_CARDS_CATALOG.find((c) => c.slug === slug)?.editionSize ?? 0;
    },
    [remaining]
  );

  const decrement = (slug) => {
    setRemaining((prev) => ({
      ...prev,
      [slug]: Math.max(0, (prev[slug] ?? 0) - 1),
    }));
  };

  return { remaining, getLeft, decrement, loading };
}
