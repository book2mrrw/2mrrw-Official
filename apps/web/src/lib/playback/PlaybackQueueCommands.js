"use client";

import { startTransition } from "react";
import { nextQueueIndex } from "./queue-order";
import { MARKS, PLAYBACK_SCENARIOS, perfMark, perfMeasure } from "@/lib/dev/performanceMarks";
import { playbackQueuesMatch, normalizeTrack } from "@/lib/playback/playback-track-utils";

/**
 * Attaches Group 4 (queue management) commands to the shared `self` service object.
 */
export function attachQueueCommands(self) {
  self.setQueueInternal = function setQueueInternal(tracks = [], startIndex = 0) {
    const {
      patchState, tracePlayback, logDirectInternalCallViolation,
      stateRef, queueRef, queueIndexRef, shuffledOrderRef, shufflePositionRef,
    } = self._deps;

    logDirectInternalCallViolation("setQueueInternal");
    const normalized = (tracks || []).map(normalizeTrack).filter((t) => t.src);
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    const sameTracks = playbackQueuesMatch(normalized, queueRef.current);
    queueRef.current = normalized;
    queueIndexRef.current = normalized.length ? index : -1;
    // New queue → discard stale shuffle permutation.
    if (!sameTracks) {
      shuffledOrderRef.current = null;
      shufflePositionRef.current = 0;
    }
    tracePlayback("queueReset", "setQueue", { length: normalized.length, index, sameTracks });
    perfMark(MARKS.QUEUE_UPDATE_START);
    startTransition(() => {
      if (sameTracks) {
        if (queueIndexRef.current !== stateRef.current.queueIndex) {
          patchState({ queueIndex: queueIndexRef.current });
        }
      } else {
        patchState({ queue: normalized, queueIndex: queueIndexRef.current });
      }
      perfMark(MARKS.QUEUE_UPDATE_END);
      perfMeasure("queue-update", MARKS.QUEUE_UPDATE_START, MARKS.QUEUE_UPDATE_END);
    });
    return normalized;
  };

  self.playNextInternal = async function playNextInternal({ autoAdvance = false } = {}) {
    const {
      patchState, requestAuthoritativePlay,
      stateRef, queueRef, queueIndexRef, repeatModeRef,
    } = self._deps;

    const current = stateRef.current.currentTrack;
    if (autoAdvance && current?.metadata?.access?.previewOnly) {
      return false;
    }
    const queue = queueRef.current;
    if (!queue.length) return false;
    let nextIndex = nextQueueIndex(queue, queueIndexRef.current, self._deps, { advance: true });
    if (nextIndex < 0) return false;
    let attempts = 0;
    while (attempts < queue.length) {
      const track = queue[nextIndex];
      if (!track?.src) {
        nextIndex += 1;
        if (nextIndex >= queue.length) {
          if (repeatModeRef.current === "all") nextIndex = 0;
          else return false;
        }
        attempts += 1;
        continue;
      }
      queueIndexRef.current = nextIndex;
      patchState({ queueIndex: nextIndex });
      if (typeof requestAuthoritativePlay !== "function") return false;
      return requestAuthoritativePlay(track, {
        resumeAt: 0,
        ...(autoAdvance
          ? { playbackScenario: PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE }
          : {}),
      }, {
        queueEntries: queue,
        queueIndex: nextIndex,
        source: autoAdvance ? "autoplay" : "user",
        requireCurrentPlaying: autoAdvance,
        expectedCurrentMediaIdentity: autoAdvance
          ? (current?.id ?? current?.trackId ?? current?.slug ?? null)
          : null,
      });
    }
    return false;
  };

  self.playPreviousInternal = async function playPreviousInternal() {
    const {
      patchState,
      requestAuthoritativePlay, requestAuthoritativeSeek,
      audioRef, queueRef, queueIndexRef, repeatModeRef,
    } = self._deps;

    const queue = queueRef.current;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      if (typeof requestAuthoritativeSeek !== "function") return false;
      return requestAuthoritativeSeek(0);
    }
    if (!queue.length) return false;
    let prevIndex = queueIndexRef.current - 1;
    if (prevIndex < 0) prevIndex = repeatModeRef.current === "all" ? queue.length - 1 : 0;
    let attempts = 0;
    while (attempts < queue.length) {
      const track = queue[prevIndex];
      if (!track?.src) {
        prevIndex -= 1;
        if (prevIndex < 0) {
          if (repeatModeRef.current === "all") prevIndex = queue.length - 1;
          else return false;
        }
        attempts += 1;
        continue;
      }
      queueIndexRef.current = prevIndex;
      patchState({ queueIndex: prevIndex });
      if (typeof requestAuthoritativePlay !== "function") return false;
      return requestAuthoritativePlay(track, { resumeAt: 0 }, {
        queueEntries: queue,
        queueIndex: prevIndex,
        source: "user",
      });
    }
    return false;
  };

  // Advance the Fisher-Yates shuffle permutation and return the next queue index.
  // Repeat-all reuses the complete permutation; repeat-off stops after one cycle.
  self.advanceShuffleOrder = function advanceShuffleOrder(queue, currentIndex) {
    return nextQueueIndex(queue, currentIndex, self._deps, { advance: true });
  };

  self.playQueueInternal = async function playQueueInternal(tracks = [], startIndex = 0, options = {}) {
    const {
      logDirectInternalCallViolation,
      requestAuthoritativePlay,
      stopAfterEachTrackRef,
    } = self._deps;
    logDirectInternalCallViolation("playQueueInternal");
    // autoAdvance defaults to true — singles/features pass false to stop after each track.
    // Preview limits are enforced against the live track by the event handlers.
    // Do not latch temporary preview access onto the whole queue: after an
    // entitlement upgrade, the entitled tracklist must continue automatically.
    stopAfterEachTrackRef.current = options.autoAdvance === false;
    const normalized = self.setQueueInternal(tracks, startIndex);
    if (!normalized.length) return false;
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    if (typeof requestAuthoritativePlay !== "function") return false;
    return requestAuthoritativePlay(normalized[index], {
      ...options,
      preserveActiveStream: Boolean(options.preserveActiveStream),
      // An explicit playQueue intent always starts from 0 unless the caller passes an
      // explicit resumeAt (e.g. session-restore). Without this, getSavedPlaybackPosition
      // silently restores a stale mid-track position when the user taps "Play All".
      resumeAt: options.resumeAt != null ? options.resumeAt : 0,
    }, {
      queueEntries: normalized,
      queueIndex: index,
      source: options.source ?? "user",
    });
  };
}
