"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useHoldToUnlock } from "@/hooks/vault/useHoldToUnlock";
import { useReducedMotion } from "@/components/environment/use-reduced-motion";
import { playVaultDoorOpen } from "@/lib/audio/vault-door-sfx";
import { useAudioPlayer } from "@/context/AudioContext";
import { VaultAudioTransport } from "@/components/vault/VaultAudioTransport";
import { VaultPodCover } from "@/components/vault/VaultPodCover";

/* The vault's own long-form player: full-screen, HLS-first with a direct-file
   fallback, and portalled onto document.body so it escapes the chamber's
   transforms and clipping. Loaded on demand -- it pulls in hls.js, which has
   no business in the bundle for anyone who never opens a video. */
const VaultVideoPlayer = dynamic(
  () => import("@/components/vault/VaultVideoPlayer").then((m) => m.VaultVideoPlayer ?? m.default),
  { ssr: false }
);

const SLIDE_MS = 2400;
const STEP_IN_MS = 1100;
// How long the summon takes to settle, after which the frame art can be
// painted without competing with the pod that is still travelling.
const SUMMON_SETTLE_MS = 1300;

/* How each media_type wants to be laid out. "card" carries a picture and so
   needs a thumbnail; "row" is a line of text and fills the width, which is
   what makes an audio or written section sit properly in the tall screen
   where a grid of thumbnails would leave it half empty. */
const SHAPE_OF = {
  video: "card",
  image: "card",
  mixed: "card",
  archive: "card",
  audio: "row",
  text: "row",
  commentary: "row",
  schedule: "row",
};

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  }
  return `${m}:${String(rem).padStart(2, "0")}`;
}

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
export function VaultDoorGate({ canUnlock = true, lockedMessage, sections = [], sectionCovers = {} }) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState("sealed");
  const [selected, setSelected] = useState(null);
  // The third step. A pod is only allowed to become the frame once it has
  // already travelled to the stage -- expanding is a second, separate tap
  // on a pod that is standing in the middle, never a shortcut from the shelf.
  const [expanded, setExpanded] = useState(false);
  const timerRef = useRef(null);

  // The track currently loaded into the chamber's transport. Null is idle --
  // the transport stays mounted either way so that starting a track never
  // mounts a fresh <audio> element mid-gesture.
  const [playingSlug, setPlayingSlug] = useState(null);
  const { pause: pauseSiteAudio } = useAudioPlayer();

  // Two players sharing one pair of ears is never right: starting something in
  // the Vault stops whatever the site player was doing, the same way opening
  // a vault video does.
  const playTrack = useCallback((slug) => {
    setPlayingSlug((current) => {
      if (current === slug) return null;
      pauseSiteAudio?.();
      return slug;
    });
  }, [pauseSiteAudio]);

  /**
   * Handles to each pod's cover, keyed by chamber and slot.
   *
   * Both chambers are rendered at once (CSS picks by orientation), so the same
   * slot id exists twice -- a single key would have the second overwrite the
   * first, leaving whichever chamber is actually on screen unable to start its
   * own loop.
   *
   * A ref map rather than state on purpose: a hover needs to reach exactly one
   * video element, and putting it in state would re-render all eight pods,
   * some mid-transition, on every pointer-enter.
   */
  const coverRefs = useRef(new Map());
  const coverKey = (chamberKey, slotId) => `${chamberKey}:${slotId}`;

  const hoverPod = useCallback((chamberKey, slotId, on) => {
    const handle = coverRefs.current.get(coverKey(chamberKey, slotId));
    if (on) handle?.play();
    else handle?.pause();
  }, []);

  const pauseAllCovers = useCallback(() => {
    for (const handle of coverRefs.current.values()) handle?.pause();
  }, []);

  // The item whose video is open, or null. The player is full-screen, so
  // everything the chamber was making noise with stops first -- a cover loop
  // or a diary entry playing underneath a video is just two things at once.
  const [videoItem, setVideoItem] = useState(null);

  const openVideo = useCallback(async (item) => {
    setPlayingSlug(null);
    pauseSiteAudio?.();
    pauseAllCovers();

    /**
     * The player tries HLS first and falls back to a plain URL. Nothing
     * enqueues vault video for transcoding yet, so that fallback is in
     * practice the only path -- and an item uploaded through Vault Manager has
     * no content_url at all: its bytes sit in R2 under a key only the server
     * will sign. Without resolving it here the player opens on a null source
     * and just shows an error.
     */
    let fallbackUrl = item.contentUrl || null;
    if (!fallbackUrl) {
      try {
        const res = await fetch(`/api/vault/media?slug=${encodeURIComponent(item.slug)}`, {
          cache: "no-store",
        });
        if (res.ok) fallbackUrl = (await res.json())?.url || null;
      } catch {
        // Leave it null: the player still attempts HLS and reports honestly.
      }
    }
    setVideoItem({ ...item, resolvedUrl: fallbackUrl });
  }, [pauseSiteAudio, pauseAllCovers]);

  /**
   * A summoned pod runs its loop. This is how touch gets it -- there is no
   * hover to key off, and the tap that brought the pod forward is the gesture.
   *
   * Asks both chambers because only one is laid out at a time and this does not
   * know which; play() no-ops on the hidden one. Synchronising a DOM element
   * with React state is exactly what an effect is for, and no state is set
   * here, so this costs no extra render.
   */
  useEffect(() => {
    if (!selected) return undefined;
    // Captured for the cleanup rather than read from the ref again later: the
    // map itself is never replaced, but reading a ref in cleanup is the shape
    // that silently breaks when that stops being true.
    const covers = coverRefs.current;
    const keys = ["wide", "tall"].map((c) => coverKey(c, selected));
    for (const k of keys) covers.get(k)?.play();
    return () => {
      for (const k of keys) covers.get(k)?.pause();
    };
  }, [selected]);

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
    setPlayingSlug(null);
    // Sealing the door cannot leave a player running over the top of it.
    setVideoItem(null);
    pauseAllCovers();
    setPhase("sealed");
  }, [resetHold, pauseAllCovers]);

  // Sending a pod home is the same journey run backwards: dropping the id
  // lets every property transition back to the value it had on the shelf,
  // so the return traces the arrival exactly rather than approximating it.
  // One dismiss goes the whole way, from wherever it is -- full screen does
  // not make you climb back down through the centre stage to escape.
  const dismissPod = useCallback(() => {
    setExpanded(false);
    setSelected(null);
    // Leaving the section takes its sound with it. A track still playing over
    // a chamber the listener has walked out of is a stuck sound, not a feature.
    setPlayingSlug(null);
    // A touch-started cover loop has no pointer-leave to stop it, so going
    // home is what ends it.
    pauseAllCovers();
  }, [pauseAllCovers]);

  // Rest -> centre stage -> frame. Each tap advances exactly one step.
  //
  // Reads `selected` directly rather than branching inside a setState updater:
  // stopping a cover loop is a DOM side effect, and updaters must stay pure --
  // React is free to run them more than once.
  const tapPod = useCallback((id) => {
    if (selected === id) {
      setExpanded((wasExpanded) => !wasExpanded);
      return;
    }
    // Summoning a different pod is leaving this one.
    setSelected(id);
    setPlayingSlug(null);
    pauseAllCovers();
  }, [selected, pauseAllCovers]);

  // Escape belongs to the innermost thing that is open. While a video is up,
  // that is the video -- the player has its own Escape handler, and dismissing
  // the pod as well would send one keypress through two layers and leave the
  // listener back in the room instead of where they were.
  useEffect(() => {
    if (!selected || videoItem) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismissPod();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, videoItem, dismissPod]);

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

  // Rows belonging to the pod on the stage. A category is not one kind of
  // thing -- Archive Sessionz alone holds an archive row and a video row --
  // so each item is drawn to its own media_type rather than the section's.
  const stagedItems = selected
    ? sections.filter((s) => s.category === (CHAMBERS.wide.slots.find((x) => x.id === selected)?.label))
    : [];

  // Whether this section needs a transport at all. A section of videos gets
  // no audio element mounted into it.
  const stagedHasAudio = stagedItems.some((s) => s.mediaType === "audio" && s.unlocked);
  const playingTitle = playingSlug
    ? (stagedItems.find((s) => s.slug === playingSlug)?.title || "")
    : "";

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

        {/* Click-away. Sits above the room but below the pods, so a click that
            lands on the room sends the summoned pod home while a click on a pod
            still reaches the pod. That is the dismiss gesture -- there is no
            close button, because anywhere-else is where people already aim. */}
        {selected && !expanded ? (
          <button
            type="button"
            className="vault-door-gate__chamber-scrim"
            onClick={dismissPod}
            tabIndex={-1}
            aria-label="Send it back"
          />
        ) : null}

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
              /* Hover is a mouse idea. pointerenter fires for touch too, but
                 there it means "a finger landed here on the way to tapping",
                 and pointerleave follows the instant it lifts -- so honouring
                 it on touch would start a loop and kill it again in the same
                 gesture. Touch gets its loop from being summoned instead,
                 which is what the tap does anyway. */
              onPointerEnter={(e) => {
                if (e.pointerType === "mouse") hoverPod(key, slot.id, true);
              }}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") hoverPod(key, slot.id, false);
              }}
              onFocus={() => hoverPod(key, slot.id, true)}
              onBlur={() => hoverPod(key, slot.id, false)}
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

                {/* The section's own cover, sitting on the pod's panel from the
                    moment the chamber opens -- the point being that a pod is
                    never blank before it is summoned. */}
                <VaultPodCover
                  ref={(handle) => {
                    const k = coverKey(key, slot.id);
                    if (handle) coverRefs.current.set(k, handle);
                    else coverRefs.current.delete(k);
                  }}
                  cover={sectionCovers?.[slot.label]}
                />
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="vault-door-gate" data-phase={phase} data-expanded={expanded || undefined} onContextMenu={swallowContextMenu}>
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
            {/* Chassis and content are siblings sized identically, not
                parent and child. As a child of the chassis box the content
                was being painted over by it no matter what z-index either
                carried; as a sibling that comes after, it simply wins. */}
            <div className="vault-door-gate__frame-stage" aria-hidden="true" />

            <div className="vault-door-gate__frame-content">
              <button
                type="button"
                className="vault-door-gate__frame-scrim"
                onClick={dismissPod}
                tabIndex={-1}
                aria-hidden="true"
              />
              <div className="vault-door-gate__frame-screen">
                <h3 className="vault-door-gate__frame-title">{stagedSlot.label}</h3>
                {stagedItems.length ? (
                  <ul className="vault-door-gate__list">
                    {stagedItems.map((item) => {
                      const shape = SHAPE_OF[item.mediaType] || "card";
                      // Only unlocked items are controls. A locked one keeps
                      // its badge and stays inert -- offering a play button
                      // that answers 403 is worse than not offering one.
                      //
                      // Audio plays inside the pod; video takes over the
                      // screen through the vault's own player. A video item
                      // with neither a stored file nor a URL has nothing to
                      // open, so it stays a listing.
                      const isAudio = item.mediaType === "audio" && item.unlocked;
                      const isVideo =
                        item.mediaType === "video" &&
                        item.unlocked &&
                        Boolean(item.contentUrl || item.hasMedia);
                      const playable = isAudio || isVideo;
                      const isPlaying = isAudio && playingSlug === item.slug;

                      const body = (
                        <>
                          {shape === "card" ? (
                            <span className="vault-door-gate__item-thumb">
                              {item.cover ? (
                                <img src={item.cover} alt="" aria-hidden="true" loading="lazy" draggable={false} />
                              ) : null}
                            </span>
                          ) : null}
                          <span className="vault-door-gate__item-meta">
                            <span className="vault-door-gate__item-kind">{item.mediaType}</span>
                            <strong className="vault-door-gate__item-title">{item.title}</strong>
                            {item.durationSeconds ? (
                              <span className="vault-door-gate__item-sub">{formatDuration(item.durationSeconds)}</span>
                            ) : null}
                          </span>
                          {item.unlocked ? null : (
                            <span className="vault-door-gate__item-lock">{item.accessLabel}</span>
                          )}
                        </>
                      );

                      return (
                        <li
                          key={item.id || item.slug}
                          className="vault-door-gate__item"
                          data-shape={shape}
                          data-locked={item.unlocked ? undefined : ""}
                          data-playing={isPlaying ? "" : undefined}
                        >
                          {playable ? (
                            <button
                              type="button"
                              className="vault-door-gate__item-hit"
                              onClick={() => (isAudio ? playTrack(item.slug) : openVideo(item))}
                              /* aria-pressed only where there is a toggled
                                 state to report. Opening a video is an action,
                                 not a switch the button holds down. */
                              aria-pressed={isAudio ? isPlaying : undefined}
                              aria-label={`${isPlaying ? "Stop" : "Play"} ${item.title}`}
                            >
                              <span className="vault-door-gate__item-cue" aria-hidden="true">
                                {isPlaying ? "❚❚" : "▶"}
                              </span>
                              {body}
                            </button>
                          ) : (
                            body
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {/* Mounted for the whole time a section is open, idle until a
                    track is chosen, so picking one never mounts a new element. */}
                {stagedHasAudio ? (
                  <VaultAudioTransport
                    slug={playingSlug}
                    title={playingTitle}
                    onEnded={() => setPlayingSlug(null)}
                  />
                ) : null}
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

      {/* Portals onto document.body, so it is not subject to the stage's
          transforms, clipping or stacking -- the pod stays exactly as it was
          and is still there when the video closes. */}
      {videoItem ? (
        <VaultVideoPlayer
          contentSlug={videoItem.slug}
          contentId={videoItem.id}
          title={videoItem.title}
          coverUrl={videoItem.cover}
          fallbackUrl={videoItem.resolvedUrl}
          savedPositionSeconds={0}
          onClose={() => setVideoItem(null)}
          onPauseAudio={pauseSiteAudio}
        />
      ) : null}
    </div>
  );
}
