"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { VaultUnlockedRoom } from "./VaultUnlockedRoom";
import { useHoldToUnlock } from "@/hooks/vault/useHoldToUnlock";
import { useReducedMotion } from "@/components/environment/use-reduced-motion";
import { VRM } from "@/lib/media/video-resource-manager";

const SESSION_KEY = "2mrrw:vault-unlocked-this-session";

function alreadyUnlockedThisSession() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    // Private-mode/storage-disabled browsers throw on access, not just on
    // being empty -- treat as "not unlocked yet" rather than crash.
    return false;
  }
}

/**
 * Gates VaultUnlockedRoom behind a one-time-per-session unlock ritual: a
 * sealed vault door, opened by a deliberate press-and-hold (mouse/touch
 * unified via useHoldToUnlock's Pointer Events, keyboard-accessible via
 * Enter/Space), which plays the real rendered door-opening animation
 * (Blender, see apps/web/public/vault/) before revealing the actual shelf
 * content underneath. This is an entrance ceremony for already-entitled
 * users -- VaultUnlockedRoom only ever renders for someone who has already
 * passed the real (server-side) entitlement check; this component adds
 * nothing to that gate, it just makes walking through it feel like a vault.
 *
 * Runs once per browser session (sessionStorage) -- switching to another
 * tab and back to Vault within the same session shows the shelves directly,
 * never replaying the door. Skips straight to unlocked under
 * prefers-reduced-motion, the same rule GalaxyEnvironment already enforces
 * for its own video layers.
 */
export function VaultDoorGate(props) {
  const reducedMotion = useReducedMotion();
  const videoRef = useRef(null);
  const [phase, setPhase] = useState(() => (alreadyUnlockedThisSession() ? "unlocked" : "sealed"));

  const markUnlockedForSession = useCallback(() => {
    try {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* best-effort only -- worst case the ritual replays next time */
    }
  }, []);

  const handleUnlock = useCallback(() => {
    if (reducedMotion) {
      markUnlockedForSession();
      setPhase("unlocked");
      return;
    }
    setPhase("opening");
  }, [reducedMotion, markUnlockedForSession]);

  const { progress, isHolding, handlers } = useHoldToUnlock({
    onUnlock: handleUnlock,
    disabled: phase !== "sealed",
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

  const handleVideoEnded = useCallback(() => {
    markUnlockedForSession();
    setPhase("unlocked");
  }, [markUnlockedForSession]);

  if (phase === "unlocked") {
    return <VaultUnlockedRoom {...props} />;
  }

  return (
    <div className="vault-door-gate" data-phase={phase}>
      {phase === "opening" ? (
        <video
          ref={videoRef}
          className="vault-door-gate__video"
          src="/vault/vault-door-unlock.mp4"
          muted
          playsInline
          onEnded={handleVideoEnded}
        />
      ) : (
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
      )}
    </div>
  );
}
