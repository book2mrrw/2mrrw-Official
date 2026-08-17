"use client";

/**
 * useVideoWake — OWNER of video wake eligibility and timing.
 *
 * Drives VIDEO_STATE transitions for a single track artwork card:
 *   ARTWORK → VIDEO_ELIGIBLE   (when track has a video asset)
 *   VIDEO_ELIGIBLE → VIDEO_WAKE_PENDING  (when element enters viewport >50%)
 *   VIDEO_WAKE_PENDING → VIDEO_WOKEN     (after 3.5s dwell)
 *   Any → ARTWORK               (on scroll-away, track change, or gesture reset)
 *
 * ABSOLUTE RULE: This hook NEVER opens a modal. Modal is explicit user tap only.
 * All video wake happens INSIDE existing card bounds.
 *
 * @param {object} opts
 * @param {React.RefObject} opts.elementRef   — artwork card element to observe
 * @param {boolean}         opts.hasVideoAsset — true if this track has a video asset
 * @param {string}          opts.trackId       — PSM currentTrackId for identity tracking
 * @param {string}          opts.slug          — release slug
 * @returns {{ videoState: string }}
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { interactiveMediaState, VIDEO_STATE } from "@/media/InteractiveMediaState";

const DWELL_MS          = 3500;   // 3.5s dwell before video wakes
const VISIBILITY_RATIO  = 0.5;    // 50% visible threshold

export function useVideoWake({ elementRef, hasVideoAsset, trackId, slug }) {
  const [videoState, setVideoState] = useState(VIDEO_STATE.ARTWORK);

  const dwellTimer    = useRef(null);
  const observerRef   = useRef(null);
  const isVisible     = useRef(false);
  const activeTrackId = useRef(trackId);
  activeTrackId.current = trackId;

  const clearDwell = useCallback(() => {
    clearTimeout(dwellTimer.current);
    dwellTimer.current = null;
  }, []);

  const resetToArtwork = useCallback(() => {
    clearDwell();
    isVisible.current = false;
    setVideoState(VIDEO_STATE.ARTWORK);
    interactiveMediaState.setVideoArtwork();
  }, [clearDwell]);

  // Subscribe to IMS videoState so this component stays in sync
  useEffect(() => {
    return interactiveMediaState.subscribe((snap) => {
      setVideoState(snap.videoState);
    });
  }, []);

  // Track-change reset: if trackId changes while woken, go back to artwork
  useEffect(() => {
    resetToArtwork();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  // IntersectionObserver — manages visibility-based dwell timer
  useEffect(() => {
    if (!hasVideoAsset || !elementRef.current) {
      resetToArtwork();
      return;
    }

    // Mark as eligible when we have a video asset
    interactiveMediaState.setVideoEligible();
    setVideoState(VIDEO_STATE.VIDEO_ELIGIBLE);

    const observer = new IntersectionObserver(
      ([entry]) => {
        const nowVisible = entry.intersectionRatio >= VISIBILITY_RATIO;

        if (nowVisible && !isVisible.current) {
          isVisible.current = true;
          // Start dwell timer
          const snap = interactiveMediaState.getSnapshot();
          if (snap.videoState === VIDEO_STATE.VIDEO_ELIGIBLE) {
            interactiveMediaState.setVideoWakePending();
            dwellTimer.current = setTimeout(() => {
              dwellTimer.current = null;
              const s = interactiveMediaState.getSnapshot();
              // Only wake if still pending and no gesture is active
              if (
                s.videoState === VIDEO_STATE.VIDEO_WAKE_PENDING &&
                s.playbackMode === "NORMAL"
              ) {
                interactiveMediaState.setVideoWoken();
              }
            }, DWELL_MS);
          }
        } else if (!nowVisible && isVisible.current) {
          isVisible.current = false;
          clearDwell();
          // If pending, go back to eligible (not artwork — still has asset)
          const snap = interactiveMediaState.getSnapshot();
          if (snap.videoState === VIDEO_STATE.VIDEO_WAKE_PENDING) {
            interactiveMediaState.setVideoEligible();
          }
        }
      },
      { threshold: VISIBILITY_RATIO }
    );

    observer.observe(elementRef.current);
    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
      clearDwell();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVideoAsset, elementRef.current]);

  // Gesture activity resets pending wake (gesture = user engaged, don't auto-wake)
  useEffect(() => {
    return interactiveMediaState.subscribe((snap) => {
      if (
        snap.playbackMode !== "NORMAL" &&
        snap.videoState === VIDEO_STATE.VIDEO_WAKE_PENDING
      ) {
        clearDwell();
        interactiveMediaState.setVideoEligible();
      }
    });
  }, [clearDwell]);

  return { videoState };
}
