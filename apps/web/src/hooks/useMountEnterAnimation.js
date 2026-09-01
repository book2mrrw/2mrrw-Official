"use client";

import { useEffect, useRef, useState } from "react";
import { isReleasePresentationReady } from "@/lib/storefront/release-presentation-registry";

/**
 * Phase R1 — run enter animation/CSS class only once per component mount,
 * not on auth/catalog/entitlement parent re-renders.
 */
export function useMountEnterAnimation(active = true, presentationIdentity = null) {
  const [shouldAnimate, setShouldAnimate] = useState(
    () => active && !isReleasePresentationReady(presentationIdentity)
  );

  useEffect(() => {
    if (!active) return undefined;
    const t = setTimeout(() => setShouldAnimate(false), 520);
    return () => clearTimeout(t);
  }, [active]);

  return { shouldAnimate };
}

/**
 * Phase R1 — animate only when slug changes (carousel title), not on unrelated re-renders.
 * @param {string | undefined | null} slug
 */
export function useSlugEnterAnimation(slug) {
  const prevSlugRef = useRef(slug);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (!slug) return;
    if (prevSlugRef.current !== slug) {
      prevSlugRef.current = slug;
      setAnimate(true);
      const t = setTimeout(() => setAnimate(false), 400);
      return () => clearTimeout(t);
    }
  }, [slug]);

  return animate;
}
