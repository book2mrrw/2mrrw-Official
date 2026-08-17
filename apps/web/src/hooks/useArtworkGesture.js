"use client";

/**
 * useArtworkGesture — OWNER of artwork hold/drag/lock gesture recognition.
 *
 * Connects gesture events on an artwork surface to InteractiveMediaState:
 *   Hold 420ms  → SLOW_MOMENTARY (beginSlowMomentary)
 *   Slide-up ≥30% artwork height while slow → SLOW_LOCKED (lockSlow)
 *   Release before lock → releaseMomentarySlow
 *   Tap while SLOW_LOCKED → fireChop(nx, ny)
 *   Drag while SLOW_LOCKED → setFilterXY(nx, ny) → deactivateFilter on release
 *   Hold 1000ms while SLOW_LOCKED → unlockSlow
 *
 * Returns { handlers } — attach to the artwork element via spread.
 * When disabled=true, all handlers are no-ops.
 *
 * Module-level isArtworkGestureActive() — exported for CS audio path to yield
 * to the canonical pointer gesture owner during the 0–420ms hold-wait window.
 */

import { useCallback, useEffect, useRef } from "react";
import { interactiveMediaState, PLAYBACK_MODE } from "@/media/InteractiveMediaState";
import { MOVE_CANCEL_PX, HOLD_THRESHOLD_MS, LOCK_SLIDE_PX_RATIO, UNLOCK_HOLD_MS } from "@/lib/player/constants";

const DRAG_THRESHOLD_PX = MOVE_CANCEL_PX;

// ── Module-level gesture-active flag ─────────────────────────────────────────
// Set true when ANY artwork surface enters holding_wait or later.
// CS audio path (applyHoldAudio) reads this to yield audio ownership.
// On touch devices, pointerdown fires before touchstart, so by the time
// handleCoverTouchStart runs this flag is already set.
let _anyGestureActive = false;

export function isArtworkGestureActive() {
  return _anyGestureActive;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string}  opts.slug        — release/track slug for gestureOwner identity
 * @param {React.RefObject} opts.elementRef — ref to the artwork DOM element
 * @param {boolean} [opts.disabled]
 */
export function useArtworkGesture({ slug, elementRef, disabled = false }) {
  const phase      = useRef("idle");
  const pointerId  = useRef(null);
  const startX     = useRef(0);
  const startY     = useRef(0);
  const slowStartY = useRef(0);

  const slowTimer   = useRef(null);
  const unlockTimer = useRef(null);

  const clearTimers = useCallback(() => {
    clearTimeout(slowTimer.current);
    clearTimeout(unlockTimer.current);
    slowTimer.current   = null;
    unlockTimer.current = null;
  }, []);

  // Returns to idle, releases module flag, clears timers.
  // Does NOT release IMS state — caller is responsible for that.
  const _resetTracking = useCallback(() => {
    clearTimers();
    phase.current     = "idle";
    pointerId.current = null;
    _anyGestureActive = false;
  }, [clearTimers]);

  // Auto-cancel on unmount. Transient states (slow, locked_drag) are released.
  // SLOW_LOCKED is global persistent state and must NOT be cancelled here.
  useEffect(() => () => {
    const p = phase.current;
    clearTimers();
    phase.current     = "idle";
    pointerId.current = null;
    _anyGestureActive = false;
    if (p === "slow") interactiveMediaState.releaseMomentarySlow();
    else if (p === "locked_drag") interactiveMediaState.deactivateFilter();
  }, [clearTimers]);

  const _normalizedXY = useCallback((e) => {
    const el = elementRef.current;
    if (!el) return { nx: 0.5, ny: 0.5 };
    const rect = el.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height));
    return { nx, ny };
  }, [elementRef]);

  const _cancelTransient = useCallback((currentPhase) => {
    // Safely cancel any active transient gesture. SLOW_LOCKED is NOT cancelled —
    // it is global state that persists across surfaces and interactions.
    clearTimers();
    phase.current     = "idle";
    pointerId.current = null;
    _anyGestureActive = false;
    if (currentPhase === "slow") {
      interactiveMediaState.releaseMomentarySlow();
    } else if (currentPhase === "locked_drag") {
      interactiveMediaState.deactivateFilter();
    }
    // locked_press: unlock timer cancelled above; no IMS transient to clean
    // holding_wait: timer cancelled above; IMS never notified
    // slow_locked: global state; caller preserves it intentionally
  }, [clearTimers]);

  const onPointerDown = useCallback((e) => {
    if (disabled || e.button !== 0) return;

    // ── Multi-touch: second finger cancels active transient gesture ───────────
    if (e.pointerType === "touch" && !e.isPrimary) {
      if (pointerId.current !== null && phase.current !== "idle") {
        const p = phase.current;
        _cancelTransient(p);
      }
      return;
    }

    if (pointerId.current !== null) return; // already tracking

    const snap = interactiveMediaState.getSnapshot();
    pointerId.current  = e.pointerId;
    startX.current     = e.clientX;
    startY.current     = e.clientY;
    _anyGestureActive  = true; // signal CS path to yield audio ownership
    clearTimers();

    if (snap.playbackMode === PLAYBACK_MODE.SLOW_LOCKED) {
      // Already locked — capture immediately so drag tracking works reliably.
      try { elementRef.current?.setPointerCapture(e.pointerId); } catch {}
      phase.current = "locked_press";
      unlockTimer.current = setTimeout(() => {
        unlockTimer.current = null;
        interactiveMediaState.unlockSlow();
        phase.current     = "idle";
        pointerId.current = null;
        _anyGestureActive = false;
      }, UNLOCK_HOLD_MS);
    } else {
      // holding_wait: defer capture so scroll/swipe can proceed during wait.
      const pid   = e.pointerId;
      const downY = e.clientY;
      phase.current = "holding_wait";
      slowTimer.current = setTimeout(() => {
        slowTimer.current  = null;
        phase.current      = "slow";
        slowStartY.current = downY;
        try { elementRef.current?.setPointerCapture(pid); } catch {}
        interactiveMediaState.beginSlowMomentary(slug);
      }, HOLD_THRESHOLD_MS);
    }
  }, [disabled, slug, elementRef, clearTimers, _cancelTransient]);

  const onPointerMove = useCallback((e) => {
    if (e.pointerId !== pointerId.current) return;

    const dx   = e.clientX - startX.current;
    const dy   = e.clientY - startY.current;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (phase.current === "holding_wait") {
      // Cancel on scroll or horizontal swipe — neither is Screw intent.
      if (Math.abs(dx) > DRAG_THRESHOLD_PX * 2 || Math.abs(dy) > DRAG_THRESHOLD_PX) {
        clearTimers();
        phase.current     = "idle";
        pointerId.current = null;
        _anyGestureActive = false;
      }
    } else if (phase.current === "slow") {
      // Slide up ≥30% of artwork height to lock.
      const el       = elementRef.current;
      const lockDist = (el ? el.getBoundingClientRect().height : 200) * LOCK_SLIDE_PX_RATIO;
      const slideUp  = slowStartY.current - e.clientY;
      if (slideUp >= lockDist) {
        phase.current = "slow_locked";
        interactiveMediaState.lockSlow();
      }
    } else if (phase.current === "locked_press") {
      if (dist > DRAG_THRESHOLD_PX) {
        clearTimeout(unlockTimer.current);
        unlockTimer.current = null;
        phase.current = "locked_drag";
        const { nx, ny } = _normalizedXY(e);
        interactiveMediaState.setFilterXY(nx, ny);
      }
    } else if (phase.current === "locked_drag") {
      const { nx, ny } = _normalizedXY(e);
      interactiveMediaState.setFilterXY(nx, ny);
    }
  }, [elementRef, clearTimers, _normalizedXY]);

  const onPointerUp = useCallback((e) => {
    if (e.pointerId !== pointerId.current) return;
    clearTimers();
    const p = phase.current;
    phase.current     = "idle";
    pointerId.current = null;
    _anyGestureActive = false;

    if (p === "holding_wait") {
      // Fast tap — no effect
    } else if (p === "slow") {
      interactiveMediaState.releaseMomentarySlow();
    } else if (p === "slow_locked") {
      // Lock persists after release
    } else if (p === "locked_press") {
      const { nx, ny } = _normalizedXY(e);
      interactiveMediaState.fireChop(nx, ny);
    } else if (p === "locked_drag") {
      interactiveMediaState.deactivateFilter();
    }
  }, [clearTimers, _normalizedXY]);

  const onPointerCancel = useCallback((e) => {
    if (e.pointerId !== pointerId.current) return;
    const p = phase.current;
    _cancelTransient(p);
  }, [_cancelTransient]);

  const onLostPointerCapture = useCallback((e) => {
    if (e.pointerId !== pointerId.current) return;
    const p = phase.current;
    _cancelTransient(p);
  }, [_cancelTransient]);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    },
  };
}
