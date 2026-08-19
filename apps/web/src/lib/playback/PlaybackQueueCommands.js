"use client";

import { startTransition } from "react";
import { MARKS, perfMark, perfMeasure } from "@/lib/dev/performanceMarks";
import { fisherYatesShuffle, playbackQueuesMatch, normalizeTrack } from "@/lib/playback/playback-track-utils";

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
      patchState,
      stateRef, queueRef, queueIndexRef, shuffleRef, repeatModeRef, csModeRef,
    } = self._deps;

    const current = stateRef.current.currentTrack;
    if (autoAdvance && current?.metadata?.access?.previewOnly) {
      return false;
    }
    const queue = queueRef.current;
    if (!queue.length) return false;
    let nextIndex = queueIndexRef.current + 1;
    if (shuffleRef.current && queue.length > 1) {
      nextIndex = self.advanceShuffleOrder(queue, queueIndexRef.current);
    } else if (nextIndex >= queue.length) {
      if (repeatModeRef.current === "all") nextIndex = 0;
      else return false;
    }
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
      const ok = await self.playTrackInternal(track, { resumeAt: 0 });
      if (ok && csModeRef.current) await self.applyCSModeToTrack(track);
      return ok;
    }
    return false;
  };

  self.playPreviousInternal = async function playPreviousInternal() {
    const {
      patchState, syncProgressTime, syncPositionState,
      stateRef, audioRef, queueRef, queueIndexRef, repeatModeRef, csModeRef,
    } = self._deps;

    const queue = queueRef.current;
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      syncProgressTime(0);
      syncPositionState(true);
      return true;
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
      const ok = await self.playTrackInternal(track, { resumeAt: 0 });
      if (ok && csModeRef.current) await self.applyCSModeToTrack(track);
      return ok;
    }
    return false;
  };

  // Advance the Fisher-Yates shuffle permutation and return the next queue index.
  // Generates a new permutation when the current one is exhausted (repeat-all semantics).
  self.advanceShuffleOrder = function advanceShuffleOrder(queue, currentIndex) {
    const { shuffledOrderRef, shufflePositionRef } = self._deps;
    if (!shuffledOrderRef.current || shuffledOrderRef.current.length !== queue.length) {
      const indices = Array.from({ length: queue.length }, (_, i) => i);
      shuffledOrderRef.current = fisherYatesShuffle(indices);
      // Ensure the current track is not the first to be played in the new order.
      const ci = shuffledOrderRef.current.indexOf(currentIndex);
      if (ci === 0 && queue.length > 1) {
        shuffledOrderRef.current[0] = shuffledOrderRef.current[1];
        shuffledOrderRef.current[1] = currentIndex;
      }
      shufflePositionRef.current = 0;
    }
    const nextPos = shufflePositionRef.current + 1;
    if (nextPos >= shuffledOrderRef.current.length) {
      // All tracks played — reshuffle for next cycle.
      const indices = Array.from({ length: queue.length }, (_, i) => i);
      shuffledOrderRef.current = fisherYatesShuffle(indices);
      shufflePositionRef.current = 0;
    } else {
      shufflePositionRef.current = nextPos;
    }
    return shuffledOrderRef.current[shufflePositionRef.current];
  };

  self.playQueueInternal = async function playQueueInternal(tracks = [], startIndex = 0, options = {}) {
    const { logDirectInternalCallViolation, stopAfterEachTrackRef } = self._deps;
    logDirectInternalCallViolation("playQueueInternal");
    // autoAdvance defaults to true — singles/features pass false to stop after each track.
    // Preview-only tracks always stop after play; no queue advance for entry-level users.
    const startTrack = tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))];
    const isPreviewOnlyStart = Boolean(startTrack?.metadata?.access?.previewOnly);
    stopAfterEachTrackRef.current = options.autoAdvance === false || isPreviewOnlyStart;
    const normalized = self.setQueueInternal(tracks, startIndex);
    if (!normalized.length) return false;
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    return self.playTrackInternal(normalized[index], {
      ...options,
      preserveActiveStream: Boolean(options.preserveActiveStream),
      // An explicit playQueue intent always starts from 0 unless the caller passes an
      // explicit resumeAt (e.g. session-restore). Without this, getSavedPlaybackPosition
      // silently restores a stale mid-track position when the user taps "Play All".
      resumeAt: options.resumeAt != null ? options.resumeAt : 0,
    });
  };
}
