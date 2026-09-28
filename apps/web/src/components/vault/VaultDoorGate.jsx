"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useHoldToUnlock } from "@/hooks/vault/useHoldToUnlock";
import { useReducedMotion } from "@/components/environment/use-reduced-motion";
import { playVaultDoorOpen } from "@/lib/audio/vault-door-sfx";

const SLIDE_MS = 2400;
const STEP_IN_MS = 1100;
// How long the summon takes to settle, after which the frame art can be
// painted without competing with the pod that is still travelling.
const SUMMON_SETTLE_MS = 1300;

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
    room: "/vault/vault-room.webp",
    className: "vault-door-gate__chamber-frame--wide",
    /* The pod's own box as a share of the frame, needed to convert a
       distance across the room into a translate of the pod itself --
       translate percentages resolve against the moving element, not its
       parent. podH follows from the art's 1160x1356 and the frame ratio. */
    podW: 13,
    podH: 22.8,
    stageX: 50,
    stageY: 46,
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
    room: "/vault/vault-room-tall.webp",
    className: "vault-door-gate__chamber-frame--tall",
    podW: 19,
    podH: 14.8,
    stageX: 50,
    stageY: 47,
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
  // The third step. A pod is only allowed to become the frame once it has
  // already travelled to the stage -- expanding is a second, separate tap
  // on a pod that is standing in the middle, never a shortcut from the shelf.
  const [expanded, setExpanded] = useState(false);
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

  // Sending a pod home is the same journey run backwards: dropping the id
  // lets every property transition back to the value it had on the shelf,
  // so the return traces the arrival exactly rather than approximating it.
  // One dismiss goes the whole way, from wherever it is -- full screen does
  // not make you climb back down through the centre stage to escape.
  const dismissPod = useCallback(() => {
    setExpanded(false);
    setSelected(null);
  }, []);

  // Rest -> centre stage -> frame. Each tap advances exactly one step.
  const tapPod = useCallback((id) => {
    setSelected((current) => {
      if (current !== id) return id;
      setExpanded((wasExpanded) => !wasExpanded);
      return id;
    });
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismissPod();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, dismissPod]);

  // Decode the frame art while the viewer is still in the chamber. Left to
  // load on demand it cost one 58ms frame at 6x CPU -- landing exactly on
  // the tap that expands a pod, which is the worst possible moment for it.
  useEffect(() => {
    if (phase !== "chamber" || typeof window === "undefined") return;
    for (const src of ["/vault/vault-fullscreen.webp", "/vault/vault-fullscreen-tall.webp"]) {
      const img = new window.Image();
      img.src = src;
      if (img.decode) img.decode().catch(() => {});
    }
  }, [phase]);

  // A long press on an <img> is a "save/copy image" gesture to mobile
  // browsers, which fired their own context menu straight through the unlock
  // hold. Suppressing it here (with the callout/drag/select rules in CSS)
  // leaves the press belonging to the gesture, not the browser.
  const swallowContextMenu = useCallback((e) => e.preventDefault(), []);

  // Rasterising a full-viewport chassis at 3x DPR costs one long frame
  // wherever it happens, so the only question is when. On the expand tap it
  // was 50ms; mounted at the summon tap it became 82ms landing in the middle
  // of the pod's flight, which is far worse -- that is the one stretch of
  // continuous motion here. So it waits for the pod to actually arrive and
  // paints in the still moment after, where a long frame costs nothing.
  const [staged, setStaged] = useState(false);

  useEffect(() => {
    if (!selected) {
      setStaged(false);
      return undefined;
    }
    const t = setTimeout(() => setStaged(true), SUMMON_SETTLE_MS);
    return () => clearTimeout(t);
  }, [selected]);

  const stagedSlot = selected && (staged || expanded)
    ? CHAMBERS.wide.slots.find((s) => s.id === selected) || null
    : null;

  const doorsMoving = phase === "opening" || phase === "stepping" || phase === "chamber";
  const inChamber = phase === "stepping" || phase === "chamber";

  const renderChamber = (key) => {
    const chamber = CHAMBERS[key];
    return (
      <div
        className={`vault-door-gate__chamber-frame ${chamber.className}`}
        data-stepped={inChamber || undefined}
      >
        {/* The room with its shelves empty. Each pod is composited over it as
            its own layer rather than being part of the picture -- that is
            what will let one of them leave the wall and travel to the centre
            stage. A pod painted into the room could never do that. */}
        <img src={chamber.room} alt="" aria-hidden="true" draggable={false} />

        {chamber.slots.map((slot, i) => {
          const isSummoned = selected === slot.id;
          /* The trip expressed in the pod's own width and height, so the
             whole journey is one transform and never touches layout. */
          const dx = ((chamber.stageX - slot.x) / chamber.podW) * 100;
          const dy = ((chamber.stageY - slot.y) / chamber.podH) * 100;
          return (
            <button
              key={slot.id}
              type="button"
              className="vault-door-gate__pod"
              style={{
                left: `${slot.x}%`,
                top: `${slot.y}%`,
                "--pod-dx": isSummoned ? `${dx.toFixed(2)}%` : "0%",
                "--pod-dy": isSummoned ? `${dy.toFixed(2)}%` : "0%",
                /* staggered so the titles breathe independently instead of
                   pulsing in lockstep, which reads as a blinking UI */
                "--pod-delay": `${(i * 0.83).toFixed(2)}s`,
                /* turns its face toward the middle of the room as it comes
                   forward -- a pod from the left wall swings right, and the
                   other way round */
                "--pod-turn": slot.x < 50 ? "7deg" : "-7deg",
              }}
              data-summoned={isSummoned || undefined}
              data-dimmed={selected && !isSummoned ? "" : undefined}
              aria-expanded={isSummoned}
              tabIndex={phase === "chamber" ? undefined : -1}
              aria-hidden={phase === "chamber" ? undefined : "true"}
              onClick={() => tapPod(slot.id)}
            >
              {/* X lives on the outer element and Y on the inner one, each
                  with its own easing -- two straight transforms that read as
                  a curve, without animating anything the compositor cannot
                  handle on its own. */}
              <span className="vault-door-gate__pod-body">
                <img
                  className="vault-door-gate__pod-art"
                  src="/vault/pod.webp"
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
                <span className="vault-door-gate__pod-label">{slot.label}</span>

                {isSummoned ? (
                  <span className="vault-door-gate__pod-screen">
                    <span className="vault-door-gate__pod-empty">
                      Nothing in here yet
                    </span>
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}

        {selected && !expanded ? (
          <button
            type="button"
            className="vault-door-gate__pod-close"
            onClick={dismissPod}
            aria-label="Send it back"
          >
            ✕
          </button>
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

        {stagedSlot ? (
          <div
            className="vault-door-gate__frame-layer"
            data-open={expanded || undefined}
            role={expanded ? "dialog" : undefined}
            aria-modal={expanded ? "true" : undefined}
            aria-hidden={expanded ? undefined : "true"}
            aria-label={stagedSlot.label}
          >
            {/* The pod itself is the boundary: its chassis is the border of
                the view and the content sits on its screen. Not a panel
                drawn over the pod -- the pod, opened up. */}
            {/* Pinned to the chassis art's own ratio and sized to cover, so
                the screen rectangle below stays registered to the screen
                painted into the art. Measuring it against the stage instead
                let the two drift apart as soon as the stage was a different
                shape from the picture. */}
            <div className="vault-door-gate__frame-stage">
              <div className="vault-door-gate__frame-art" aria-hidden="true" />
              {/* Above the chassis but beneath the screen, so tapping the
                  surround backs out while tapping the content does not.
                  It has to live inside this box rather than beside it: a
                  sibling cannot sit between a parent's own children. */}
              <button
                type="button"
                className="vault-door-gate__frame-scrim"
                onClick={dismissPod}
                tabIndex={-1}
                aria-hidden="true"
              />
              <div className="vault-door-gate__frame-screen">
                <h3 className="vault-door-gate__frame-title">{stagedSlot.label}</h3>
                <p className="vault-door-gate__frame-empty">
                  Nothing in here yet
                </p>
              </div>
            </div>

            {/* Signposted rather than hidden: a labelled control, always
                visible, plus the two gestures people already try. */}
            <button
              type="button"
              className="vault-door-gate__frame-close"
              onClick={dismissPod}
              tabIndex={expanded ? undefined : -1}
            >
              ✕ Close
            </button>
            <p className="vault-door-gate__frame-hint" aria-hidden="true">
              Esc or tap outside to go back
            </p>
          </div>
        ) : null}

        {phase === "chamber" ? (
          <button type="button" className="vault-door-gate__exit" onClick={handleExit}>
            ← Exit Vault
          </button>
        ) : null}
      </div>
    </div>
  );
}
