"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useHoldToUnlock } from "@/hooks/vault/useHoldToUnlock";
import { useReducedMotion } from "@/components/environment/use-reduced-motion";
import { playVaultDoorOpen } from "@/lib/audio/vault-door-sfx";

const SLIDE_MS = 2400;
const STEP_IN_MS = 1100;

/**
 * Two chambers, two shapes. The wide one (3/2) suits tablets, foldables and
 * desktop; the tall one (2/3) suits a phone held upright, where the wide art
 * could only ever be a letterboxed strip. Both are rendered and CSS picks by
 * viewport orientation, so the choice survives a rotation mid-session with
 * no JS and no layout probe.
 *
 * Each has its own pod coordinates because the pods sit in different places
 * in each piece of art. Positions are percentages of that art's own frame,
 * which is why each chamber frame is pinned to its own aspect ratio.
 */
const CHAMBERS = {
  wide: {
    src: "/vault/vault-chamber.webp",
    className: "vault-door-gate__chamber-frame--wide",
    core: null,
    slots: [
      { id: "audio-diariez", label: "Audio Diariez", x: 20.7, y: 19.5 },
      { id: "live-replayz", label: "Live Replayz", x: 79.6, y: 19.5 },
      { id: "behind-the-scenez", label: "Behind the Scenez", x: 30.6, y: 34.5 },
      { id: "exclusive-interviewz", label: "Exclusive Interviewz", x: 69.7, y: 36.0 },
      { id: "archive-sessionz", label: "Archive Sessionz", x: 18.9, y: 50.0 },
      { id: "true-storiez", label: "True Storiez", x: 80.5, y: 49.5 },
      { id: "private-releasez", label: "Private Releasez", x: 28.6, y: 67.0 },
      { id: "unmxd-unmstrd", label: "UNMXD UNMSTRD", x: 71.6, y: 67.0 },
    ],
  },
  /* The centre is deliberately empty here: it is the stage a section gets
     summoned onto, not a slot of its own, so this chamber has no core.
     Labels are the exact `vault_content.category` strings that are already
     live in the database -- renaming one side without the other breaks the
     mapping to R2. */
  tall: {
    src: "/vault/vault-chamber-tall.webp",
    className: "vault-door-gate__chamber-frame--tall",
    core: null,
    slots: [
      { id: "audio-diariez", label: "Audio Diariez", x: 24.9, y: 20.8 },
      { id: "live-replayz", label: "Live Replayz", x: 75.4, y: 23.2 },
      { id: "behind-the-scenez", label: "Behind the Scenez", x: 29.0, y: 35.5 },
      { id: "exclusive-interviewz", label: "Exclusive Interviewz", x: 72.8, y: 40.5 },
      { id: "archive-sessionz", label: "Archive Sessionz", x: 22.7, y: 51.4 },
      { id: "true-storiez", label: "True Storiez", x: 79.6, y: 57.6 },
      { id: "private-releasez", label: "Private Releasez", x: 28.8, y: 69.2 },
      { id: "unmxd-unmstrd", label: "UNMXD UNMSTRD", x: 79.8, y: 72.3 },
    ],
  },
};

/**
 * The Vault: a real double-door bank vault built into its own wall. Sealed
 * by default, opened by a deliberate press-and-hold (mouse/touch unified via
 * useHoldToUnlock's Pointer Events, keyboard-accessible via Enter/Space).
 *
 * The doors genuinely move rather than cross-fading. The door art is cut in
 * half down its seam and each half slides away from the centre, clipped to
 * the doorway so the halves retract into the frame the way an elevator's do,
 * uncovering the chamber behind them. A synthesized servo / hydraulic cue
 * runs alongside the travel; the view then steps through into the chamber.
 *
 * "Exit Vault" seals it all the way back up.
 *
 * The chamber's eight pods and its centre core are live targets --
 * focusable, selectable, labelled -- and honest about being empty; nothing
 * is invented to fill them.
 *
 * Always opens the same way: no session persistence of "already unlocked."
 *
 * `canUnlock=false` renders the same sealed door as a static, non-interactive
 * preview instead -- for whenever the Vault genuinely has nothing to unlock
 * yet. The door itself should still read as "a real vault exists here."
 */
export function VaultDoorGate({ canUnlock = true, lockedMessage }) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState("sealed");
  const [selected, setSelected] = useState(null);
  const timerRef = useRef(null);

  const handleUnlock = useCallback(() => {
    if (reducedMotion) {
      setPhase("chamber");
      return;
    }
    playVaultDoorOpen();
    setPhase("opening");
  }, [reducedMotion]);

  const { progress, isHolding, handlers, reset: resetHold } = useHoldToUnlock({
    onUnlock: handleUnlock,
    disabled: !canUnlock || phase !== "sealed",
  });

  // The doors travel, then the view steps through them. CSS transitions have
  // no event we can trust across interruption, so each leg is timed.
  useEffect(() => {
    if (phase !== "opening" && phase !== "stepping") return undefined;
    const next = phase === "opening" ? "stepping" : "chamber";
    const wait = phase === "opening" ? SLIDE_MS : STEP_IN_MS;
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
  // browsers, which fired their own context menu straight through the unlock
  // hold. Suppressing it here (with the callout/drag/select rules in CSS)
  // leaves the press belonging to the gesture, not the browser.
  const swallowContextMenu = useCallback((e) => e.preventDefault(), []);

  const doorsMoving = phase === "opening" || phase === "stepping" || phase === "chamber";
  const inChamber = phase === "stepping" || phase === "chamber";

  const renderChamber = (key) => {
    const chamber = CHAMBERS[key];
    const all = chamber.core ? [chamber.core, ...chamber.slots] : chamber.slots;
    const active = selected ? all.find((s) => s.id === selected) : null;
    return (
      <div
        className={`vault-door-gate__chamber-frame ${chamber.className}`}
        data-stepped={inChamber || undefined}
      >
        <img src={chamber.src} alt="" aria-hidden="true" draggable={false} />
        {phase === "chamber" ? (
          <>
            {all.map((slot) => (
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
              {active ? `${active.label} — empty` : "The vault is open. Nothing stored yet."}
            </div>
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="vault-door-gate" data-phase={phase} onContextMenu={swallowContextMenu}>
      <div className="vault-door-gate__stage">
        {renderChamber("wide")}
        {renderChamber("tall")}

        {/* Every layer here paints from CSS custom properties rather than a
            fixed src, because the door comes in two shapes: a round door in
            a wide wall for landscape, an arched one in a tall wall for a
            phone. Swapping art, doorway outline, seam and travel is then a
            media query rather than a second copy of this markup. */}
        <div className="vault-door-gate__door-frame" data-hidden={inChamber || undefined}>
          {/* the wall the vault is set into */}
          <span className="vault-door-gate__wall" aria-hidden="true" />

          {/* What is behind the doorway, cut to the doorway's own outline --
              so the wall needs no hole punched in it, which matters because
              a hole has to be a mask and a mask cannot describe the arch.
              The outline and the room it frames are separate elements on
              purpose: stepping through grows the opening while the room
              itself holds still, which is what walking through a door
              actually looks like. */}
          <span className="vault-door-gate__peek" aria-hidden="true">
            <span className="vault-door-gate__peek-art" />
          </span>

          {/* light spilling out of the doorway as it parts */}
          <div className="vault-door-gate__spill" data-open={doorsMoving || undefined} aria-hidden="true" />

          {/* the doorway clips its contents, so a leaf that travels past the
              jamb is simply gone -- that is what makes it retract into the
              frame rather than glide across the wall */}
          <div className="vault-door-gate__doorway" aria-hidden="true">
            <span className="vault-door-gate__leaf vault-door-gate__leaf--l" data-open={doorsMoving || undefined} />
            <span className="vault-door-gate__leaf vault-door-gate__leaf--r" data-open={doorsMoving || undefined} />
          </div>

          {!canUnlock ? (
            <div className="vault-door-gate__locked-caption">
              {lockedMessage || "The Vault is sealed for now. Exclusive drops will unlock here when they launch."}
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
        </div>

        {phase === "chamber" ? (
          <button type="button" className="vault-door-gate__exit" onClick={handleExit}>
            ← Exit Vault
          </button>
        ) : null}
      </div>
    </div>
  );
}
