"use client";

import { useCallback, useRef } from "react";

/**
 * Press-and-hold gesture recognizer for Visual Moments.
 *
 * Interaction model:
 *   TAP  (<holdThreshold ms, <moveCancelPx movement)  → onTap fires (normal card behavior)
 *   HOLD (holdThreshold ms, minimal movement)          → onHoldActivate fires; onHoldRelease on pointer-up
 *   HOLD + SWIPE UP (swipeThreshold px upward while held) → onSwipeUp fires
 *
 * Uses pointer events (works on both touch and mouse).
 * Does NOT cancel the underlying tap: callers must check gestureActive to suppress modal open.
 *
 * @param {object} handlers
 * @param {() => void} handlers.onHoldActivate — called after holdThreshold ms of stable hold
 * @param {() => void} [handlers.onHoldRelease] — called when pointer lifts after an active hold
 * @param {() => void} [handlers.onSwipeUp]  — called on upward swipe while holding
 * @param {() => void} [handlers.onTap]      — called on a clean tap (< threshold, minimal movement)
 * @param {number}     [handlers.holdThreshold=500] — ms before hold activates
 * @param {number}     [handlers.moveCancelPx=10]   — px movement that cancels hold detection
 * @param {number}     [handlers.swipeThreshold=40] — px upward movement that triggers expand
 */
export function useVisualMomentGesture({
  onHoldActivate,
  onHoldRelease,
  onSwipeUp,
  onTap,
  holdThreshold  = 500,
  moveCancelPx   = 10,
  swipeThreshold = 40,
} = {}) {
  const timerRef        = useRef(null);
  const holdActiveRef   = useRef(false);   // true after holdThreshold fires
  const cancelledRef    = useRef(false);   // true if movement cancelled the hold
  const pointerDownRef  = useRef(false);   // true between pointerdown and pointerup
  const startYRef       = useRef(0);
  const startXRef       = useRef(0);
  const swipeFiredRef   = useRef(false);   // prevent multiple swipe-up callbacks

  function _cancel() {
    clearTimeout(timerRef.current);
    timerRef.current  = null;
    cancelledRef.current = true;
  }

  const onPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return; // primary pointer only
    pointerDownRef.current  = true;
    holdActiveRef.current   = false;
    cancelledRef.current    = false;
    swipeFiredRef.current   = false;
    startYRef.current       = e.clientY;
    startXRef.current       = e.clientX;

    timerRef.current = setTimeout(() => {
      if (!cancelledRef.current && pointerDownRef.current) {
        holdActiveRef.current = true;
        onHoldActivate?.();
      }
    }, holdThreshold);
  }, [onHoldActivate, holdThreshold]);

  const onPointerMove = useCallback((e) => {
    if (!pointerDownRef.current) return;

    const dx = e.clientX - startXRef.current;
    const dy = e.clientY - startYRef.current;

    // Cancel hold if the pointer wandered before the threshold fired
    if (!holdActiveRef.current) {
      if (Math.abs(dx) > moveCancelPx || Math.abs(dy) > moveCancelPx) {
        _cancel();
      }
      return;
    }

    // During an active hold, detect upward swipe
    if (!swipeFiredRef.current && dy < -swipeThreshold) {
      swipeFiredRef.current = true;
      onSwipeUp?.();
    }
  }, [moveCancelPx, swipeThreshold, onSwipeUp]);

  const onPointerUp = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    pointerDownRef.current = false;

    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      onHoldRelease?.();
    } else if (!cancelledRef.current) {
      // Clean tap: threshold didn't fire AND pointer didn't wander
      onTap?.();
    }

    cancelledRef.current = false;
  }, [onHoldRelease, onTap]);

  const onPointerCancel = useCallback(() => {
    _cancel();
    pointerDownRef.current  = false;
    if (holdActiveRef.current) {
      holdActiveRef.current = false;
      onHoldRelease?.();
    }
  }, [onHoldRelease]);

  /** True between holdActivate and holdRelease — use to suppress onClick/onTap. */
  function isGestureActive() {
    return holdActiveRef.current;
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    isGestureActive,
  };
}
