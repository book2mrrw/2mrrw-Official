"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useHoldToUnlock } from "@/hooks/vault/useHoldToUnlock";
import { useReducedMotion } from "@/components/environment/use-reduced-motion";
import { VRM } from "@/lib/media/video-resource-manager";

/**
 * The vault door: sealed by default, opened by a deliberate press-and-hold
 * (mouse/touch unified via useHoldToUnlock's Pointer Events, keyboard-
 * accessible via Enter/Space), which plays the real rendered door-opening
 * animation (Blender, see apps/web/public/vault/) and settles on its open
 * final frame. "Exit Vault" reseals it back to the starting sealed state.
 *
 * Always opens the same way -- no session/local persistence of "already
 * unlocked." Every fresh visit to the tab starts sealed again; there is no
 * shelf/content reveal behind the door yet (that lands with the real
 * upload pipeline), so for now walking through the door is the whole
 * moment.
 *
 * Skips straight to the open end-frame (no animated playback) under
 * prefers-reduced-motion, the same rule GalaxyEnvironment already enforces
 * for its own video layers -- but still shows the correct open-door image
 * rather than the closed one.
 *
 * `canUnlock=false` renders the same sealed door as a static, non-interactive
 * preview instead -- for whenever the Vault genuinely has nothing to unlock
 * yet (no real inventory, entitlement flow not live for this visitor). The
 * door itself should still read as "a real vault exists here," never a
 * blank placeholder, even while there's nothing behind it to open.
 */
export function VaultDoorGate({ canUnlock = true, lockedMessage }) {
  const reducedMotion = useReducedMotion();
  const videoRef = useRef(null);
  const [phase, setPhase] = useState("sealed");

  const handleUnlock = useCallback(() => {
    setPhase(reducedMotion ? "open" : "opening");
  }, [reducedMotion]);

  const { progress, isHolding, handlers, reset: resetHold } = useHoldToUnlock({
    onUnlock: handleUnlock,
    disabled: !canUnlock || phase !== "sealed",
  });

  useEffect(() => {
    if (phase !== "opening") return undefined;
    const el = videoRef.current;
    if (!el) return undefined;
    VRM.register(el, VRM.PRIORITY_HERO);
    VRM.requestPlay(
      el,
      () => { el.play().catch(() => {}); },
      () => el.pause()
    );
    return () => {
      VRM.requestPause(el);
      VRM.unregister(el);
    };
  }, [phase]);

  // Reduced-motion skips playback entirely, but the door should still read
  // as open rather than sealed -- jump the (paused, unplayed) video straight
  // to its final frame instead of showing the closed-door poster.
  useEffect(() => {
    if (phase !== "open" || !reducedMotion) return undefined;
    const el = videoRef.current;
    if (!el) return undefined;
    const freeze = () => {
      el.pause();
      try { el.currentTime = el.duration || 0; } catch { /* not seekable yet */ }
    };
    if (el.readyState >= 1) freeze();
    else el.addEventListener("loadedmetadata", freeze, { once: true });
    return () => el.removeEventListener("loadedmetadata", freeze);
  }, [phase, reducedMotion]);

  const handleVideoEnded = useCallback(() => {
    setPhase("open");
  }, []);

  const handleExit = useCallback(() => {
    const el = videoRef.current;
    if (el) {
      try { el.pause(); el.currentTime = 0; } catch { /* ignore */ }
    }
    resetHold();
    setPhase("sealed");
  }, [resetHold]);

  return (
    <div className="vault-door-gate" data-phase={phase}>
      {phase === "opening" || phase === "open" ? (
        <video
          ref={videoRef}
          className="vault-door-gate__video"
          src="/vault/vault-door-unlock.mp4"
          muted
          playsInline
          onEnded={handleVideoEnded}
        />
      ) : canUnlock ? (
        <button
          type="button"
          className="vault-door-gate__trigger"
          aria-label="Hold to unlock the Vault"
          data-holding={isHolding || undefined}
          style={{ "--hold-progress": progress }}
          {...handlers}
        >
          <img
            className="vault-door-gate__poster"
            src="/vault/vault-door-sealed-poster.png"
            alt=""
            aria-hidden="true"
          />
          <svg className="vault-door-gate__ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle className="vault-door-gate__ring-track" cx="50" cy="50" r="46" />
            <circle className="vault-door-gate__ring-fill" cx="50" cy="50" r="46" />
          </svg>
          <span className="vault-door-gate__label">
            {isHolding ? "Keep holding…" : "Hold to unlock"}
          </span>
        </button>
      ) : (
        <div className="vault-door-gate__locked" aria-label="The Vault is sealed">
          <img
            className="vault-door-gate__poster"
            src="/vault/vault-door-sealed-poster.png"
            alt=""
            aria-hidden="true"
          />
          <div className="vault-door-gate__locked-caption">
            {lockedMessage || "The Vault is sealed for now. Exclusive drops will unlock here when they launch."}
          </div>
        </div>
      )}

      {phase === "open" ? (
        <button type="button" className="vault-door-gate__exit" onClick={handleExit}>
          ← Exit Vault
        </button>
      ) : null}
    </div>
  );
}
