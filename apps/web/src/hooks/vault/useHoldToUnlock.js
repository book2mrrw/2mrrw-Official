"use client";

import { useRef, useState, useCallback, useEffect } from "react";

const HOLD_DURATION_MS = 900;

/**
 * Press-and-hold gesture for the Vault's unlock ritual. Uses Pointer Events
 * (not separate touch/mouse handlers) so the exact same code path handles a
 * finger on an iPhone/Android/foldable and a mouse on desktop -- no
 * per-platform branching needed. A deliberate hold, not a tap, is the point:
 * this gates paid content's entrance moment, and a plain tap is too easy to
 * trigger by accident while scrolling a feed.
 *
 * Keyboard users get instant activation on Enter/Space instead of a hold --
 * an explicit key press is already a deliberate action, so there's nothing
 * for a hold to protect against there, and "hold a key down" is an
 * unreliable, inconsistent browser gesture to depend on.
 */
export function useHoldToUnlock({ onUnlock, disabled = false } = {}) {
  const [progress, setProgress] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const rafRef = useRef(null);
  const startRef = useRef(0);
  const completedRef = useRef(false);

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setIsHolding(false);
    setProgress(0);
  }, []);

  const vibrate = useCallback(() => {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try { navigator.vibrate(18); } catch { /* no-op: haptics are a nicety, never required */ }
    }
  }, []);

  // tick calls itself via requestAnimationFrame across many frames, so it's
  // read through a ref rather than closed over directly -- otherwise the
  // very first frame's closure (with whatever onUnlock/stop/vibrate were at
  // that moment) would keep re-scheduling itself for the rest of the hold,
  // silently ignoring any later dependency changes. The ref is written in an
  // effect, not during render -- writing a ref during render is itself a
  // real bug class (the read-back can silently miss the render that set it).
  const tickRef = useRef(null);
  useEffect(() => {
    tickRef.current = () => {
      const elapsed = performance.now() - startRef.current;
      const p = Math.min(1, elapsed / HOLD_DURATION_MS);
      setProgress(p);
      if (p >= 1) {
        if (!completedRef.current) {
          completedRef.current = true;
          vibrate();
          onUnlock?.();
        }
        stop();
        return;
      }
      rafRef.current = requestAnimationFrame(() => tickRef.current());
    };
  }, [onUnlock, stop, vibrate]);

  const start = useCallback(() => {
    if (disabled || completedRef.current) return;
    setIsHolding(true);
    startRef.current = performance.now();
    rafRef.current = requestAnimationFrame(() => tickRef.current());
  }, [disabled]);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const handlers = {
    onPointerDown: (e) => {
      e.preventDefault();
      start();
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onKeyDown: (e) => {
      if (disabled || completedRef.current) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        completedRef.current = true;
        vibrate();
        onUnlock?.();
      }
    },
  };

  return { progress, isHolding, handlers };
}
