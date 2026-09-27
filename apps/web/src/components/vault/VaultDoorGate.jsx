"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useHoldToUnlock } from "@/hooks/vault/useHoldToUnlock";
import { useReducedMotion } from "@/components/environment/use-reduced-motion";

const DOORS_OPEN_MS = 1500;
const WALK_IN_MS = 1500;

/**
 * Positions are percentages of the chamber frame itself, which is why the
 * stage below is pinned to the frame's own 3/2 ratio -- letterboxing inside
 * a differently-shaped panel would slide every slot off its pod.
 */
const SLOTS = [
  { id: "music", label: "Music", x: 22.3, y: 32.4 },
  { id: "videos", label: "Videos", x: 37.8, y: 30.0 },
  { id: "exclusive", label: "Exclusive", x: 62.2, y: 29.5 },
  { id: "projects", label: "Projects", x: 77.9, y: 32.4 },
  { id: "photos", label: "Photos", x: 21.3, y: 58.6 },
  { id: "archive", label: "Archive", x: 33.3, y: 53.2 },
  { id: "studio", label: "Studio", x: 66.5, y: 52.9 },
  { id: "downloads", label: "Downloads", x: 78.4, y: 58.3 },
];

const CORE = { id: "core", label: "Centerpiece", x: 50, y: 44.4 };

/**
 * The Vault: a real double-door bank vault set into its own wall, sealed by
 * default, opened by a deliberate press-and-hold (mouse/touch unified via
 * useHoldToUnlock's Pointer Events, keyboard-accessible via Enter/Space).
 * Holding swings the doors, then walks the viewer into the chamber behind
 * them. "Exit Vault" backs all the way out to sealed again.
 *
 * The three states are three matched frames of the same vault, so the
 * transitions are cross-fades rather than rendered animation. Every frame
 * keeps the wall, floor and doorway around the vault in view: it reads as a
 * vault built into a room, not a hatch squeezed into a box.
 *
 * The chamber's pods are the vault's real shelves -- the places actual
 * media lands once there is any, with the core at the center reserved for
 * whatever is being featured. They are live targets here (focusable,
 * selectable, labelled) and honest about being empty; nothing is invented
 * to fill them.
 *
 * Always opens the same way -- no session/local persistence of "already
 * unlocked." Every fresh visit to the tab starts sealed again.
 *
 * `canUnlock=false` renders the same sealed door as a static, non-interactive
 * preview instead -- for whenever the Vault genuinely has nothing to unlock
 * yet. The door itself should still read as "a real vault exists here,"
 * never a blank placeholder.
 */
export function VaultDoorGate({ canUnlock = true, lockedMessage }) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState("sealed");
  const [selected, setSelected] = useState(null);
  const timerRef = useRef(null);

  const handleUnlock = useCallback(() => {
    setPhase(reducedMotion ? "chamber" : "opening");
  }, [reducedMotion]);

  const { progress, isHolding, handlers, reset: resetHold } = useHoldToUnlock({
    onUnlock: handleUnlock,
    disabled: !canUnlock || phase !== "sealed",
  });

  // Doors swing, then the view walks through them. Cross-fades have no
  // "ended" event of their own, so each leg hands off on a timer.
  useEffect(() => {
    if (phase !== "opening" && phase !== "entering") return undefined;
    const next = phase === "opening" ? "entering" : "chamber";
    const wait = phase === "opening" ? DOORS_OPEN_MS : WALK_IN_MS;
    timerRef.current = setTimeout(() => setPhase(next), wait);
    return () => clearTimeout(timerRef.current);
  }, [phase]);

  const handleExit = useCallback(() => {
    clearTimeout(timerRef.current);
    resetHold();
    setSelected(null);
    setPhase("sealed");
  }, [resetHold]);

  // A long press on an <img> is a "save/copy image" gesture to mobile
  // browsers, which fired their own context menu straight through the
  // unlock hold. Suppressing it here (with the callout/drag/select rules in
  // CSS) leaves the press belonging to the gesture, not the browser.
  const swallowContextMenu = useCallback((e) => e.preventDefault(), []);

  const doorsOpen = phase === "opening" || phase === "entering" || phase === "chamber";
  const inChamber = phase === "entering" || phase === "chamber";
  const selectedSlot = selected
    ? [CORE, ...SLOTS].find((slot) => slot.id === selected)
    : null;

  const plates = (
    <>
      <img className="vault-door-gate__plate" src="/vault/vault-closed.webp" alt="" aria-hidden="true" draggable={false} />
      <img
        className="vault-door-gate__plate vault-door-gate__plate--fade"
        src="/vault/vault-open.webp"
        alt=""
        aria-hidden="true"
        draggable={false}
        data-visible={doorsOpen || undefined}
      />
      <img
        className="vault-door-gate__plate vault-door-gate__plate--fade"
        src="/vault/vault-chamber.webp"
        alt=""
        aria-hidden="true"
        draggable={false}
        data-visible={inChamber || undefined}
      />
    </>
  );

  return (
    <div className="vault-door-gate" onContextMenu={swallowContextMenu}>
      <div className="vault-door-gate__stage" data-phase={phase}>
        {plates}

        {!canUnlock ? (
          <div className="vault-door-gate__locked" aria-label="The Vault is sealed">
            <div className="vault-door-gate__locked-caption">
              {lockedMessage || "The Vault is sealed for now. Exclusive drops will unlock here when they launch."}
            </div>
          </div>
        ) : phase === "sealed" ? (
          <button
            type="button"
            className="vault-door-gate__trigger"
            aria-label="Hold to unlock the Vault"
            data-holding={isHolding || undefined}
            style={{ "--hold-progress": progress }}
            {...handlers}
          >
            <svg className="vault-door-gate__ring" viewBox="0 0 100 100" aria-hidden="true">
              <circle className="vault-door-gate__ring-track" cx="50" cy="50" r="46" />
              <circle className="vault-door-gate__ring-fill" cx="50" cy="50" r="46" />
            </svg>
            <span className="vault-door-gate__label">
              {isHolding ? "Keep holding…" : "Hold to unlock"}
            </span>
          </button>
        ) : null}

        {phase === "chamber" ? (
          <>
            {[CORE, ...SLOTS].map((slot) => (
              <button
                key={slot.id}
                type="button"
                className={`vault-door-gate__slot${slot.id === "core" ? " vault-door-gate__slot--core" : ""}`}
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                data-selected={selected === slot.id || undefined}
                aria-pressed={selected === slot.id}
                onClick={() => setSelected(selected === slot.id ? null : slot.id)}
              >
                <span className="vault-door-gate__slot-name">{slot.label}</span>
              </button>
            ))}

            <div className="vault-door-gate__readout" role="status">
              {selectedSlot
                ? `${selectedSlot.label} — empty`
                : "The vault is open. Nothing stored yet."}
            </div>

            <button type="button" className="vault-door-gate__exit" onClick={handleExit}>
              ← Exit Vault
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
