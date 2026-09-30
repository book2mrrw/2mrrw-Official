"use client";

/**
 * VaultPodCover — the media a section's pod shows on its shelf, so a pod is
 * never sitting there blank before it is summoned.
 *
 * Sits on the pod art's own blank panel (the same rect the summoned screen
 * uses), not as a card drawn over the pod: the object is the surface.
 *
 * Playback is gesture-driven, never ambient. Eight pods looping at once is
 * precisely the decoder pressure VideoResourceManager exists to prevent, and
 * it would also make a still room restless. So the still is what a pod shows
 * at rest, and the loop runs only while the pod is hovered, focused, or
 * standing on the centre stage.
 *
 * play/pause are exposed imperatively rather than driven by a prop, because
 * hover would otherwise have to live in React state — and a state change per
 * pointer-enter would re-render the whole chamber, including eight pods mid
 * transition, for something that needs to touch exactly one video element.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { VRM } from "@/lib/media/video-resource-manager";

export const VaultPodCover = forwardRef(function VaultPodCover({ cover }, ref) {
  const videoRef = useRef(null);
  const still = cover?.still || null;
  const motion = cover?.motion || null;

  // Registered for as long as the element exists so the budget math sees it,
  // at the lowest tier: a cover loop is decoration with no content stakes and
  // should be the first thing evicted under real pressure.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return undefined;
    VRM.register(el, VRM.PRIORITY_DECORATIVE);
    return () => {
      VRM.requestPause(el);
      VRM.unregister(el);
    };
  }, [motion]);

  const play = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    /**
     * Both chambers are in the DOM at once and CSS hides the one that does not
     * match the viewport's orientation, so half of these elements have no box
     * at any given moment. Decoding into a box nobody can see is pure waste,
     * and it would spend the decoder budget the visible chamber needs.
     *
     * This also enforces prefers-reduced-motion: that media query takes the
     * loop out of layout entirely, so it lands here as "no box" and never
     * starts.
     */
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return;

    VRM.requestPlay(
      el,
      () => { el.play().catch(() => {}); },
      () => { el.pause(); }
    );
  }, []);

  const pause = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    VRM.requestPause(el);
    el.pause();
    // Back to the first frame, so the next hover starts the loop rather than
    // resuming it halfway through.
    try { el.currentTime = 0; } catch { /* not seekable yet */ }
  }, []);

  useImperativeHandle(ref, () => ({ play, pause }), [play, pause]);

  if (!still && !motion) return null;

  return (
    <span className="vault-door-gate__pod-cover" aria-hidden="true">
      {still ? (
        <img
          className="vault-door-gate__pod-cover-still"
          src={still}
          alt=""
          draggable={false}
          decoding="async"
        />
      ) : null}

      {motion ? (
        <video
          ref={videoRef}
          className="vault-door-gate__pod-cover-motion"
          src={motion}
          /**
           * A loop is meant to come with a still -- the still is the poster,
           * the resting frame and the fallback, and the manager says so on
           * upload. When one was uploaded without a still anyway, the loop has
           * to stand in for it: shown at rest rather than hidden, and given
           * preload="metadata" so the browser has a first frame to paint.
           * Otherwise the pod is a black rectangle, which is worse than the
           * blank pod this feature exists to fix.
           *
           * With a still present, preload stays "none" so eight loops never
           * touch the wire until one is actually asked for.
           */
          data-solo={still ? undefined : ""}
          preload={still ? "none" : "metadata"}
          poster={still || undefined}
          muted
          loop
          playsInline
          disablePictureInPicture
          tabIndex={-1}
        />
      ) : null}
    </span>
  );
});

export default VaultPodCover;
