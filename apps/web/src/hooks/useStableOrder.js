"use client";

import { useMemo, useState } from "react";

/**
 * `items` in the order they were first shown, for as long as the caller stays
 * mounted: entries already on screen keep their place, new entries join at
 * the end (in their live order), and removed entries drop out. The live order
 * applies the next time the caller mounts.
 *
 * Re-ordering a rendered list makes React move its DOM nodes, which visibly
 * shifts the content and interrupts any media inside it (a moved <video> is
 * paused and has to resume). Content stands still once it has loaded.
 */
export function stableOrder(items, keyOf, firstOrder) {
  const byKey = new Map(items.map((item) => [keyOf(item), item]));
  const placed = firstOrder.filter((key) => byKey.has(key)).map((key) => byKey.get(key));
  const shown = new Set(firstOrder);
  return [...placed, ...items.filter((item) => !shown.has(keyOf(item)))];
}

export function useStableOrder(items, keyOf) {
  const [firstOrder] = useState(() => items.map(keyOf));
  return useMemo(() => stableOrder(items, keyOf, firstOrder), [items, keyOf, firstOrder]);
}
