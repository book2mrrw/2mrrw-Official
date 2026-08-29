"use client";

import { startTransition } from "react";
import { MARKS, PLAYBACK_SCENARIOS, perfMark, perfMeasure } from "@/lib/dev/performanceMarks";
import { playbackQueuesMatch, normalizeTrack } from "@/lib/playback/playback-track-utils";
import { proposeSelection, getCanonicalSelection } from "@/lib/playback/selection-port.js";

/** A queue entry with no resolvable `src` can never be played — traversal
 * (NEXT/PREVIOUS) must skip over it rather than stall or throw. */
function isPlayableEntry(entry) {
  return Boolean(entry?.src);
}

/**
 * Attaches Group 4 (queue management) commands to the shared `self` service object.
 *
 * Slice 3: the actual queue/index/traversal DECISION lives in SelectionAuthority.
 * These functions propose named transitions through the Selection port and
 * then act on the returned canonical snapshot — they no longer read or write
 * queueRef/queueIndexRef directly (those refs remain valid read-only
 * projections, kept in sync by usePlaybackEffects Effect 8). Shuffle
 * traversal state (order/position) is now Core-internal — no legacy ref
 * mirrors it at all.
 */
export function attachQueueCommands(self) {
  self.setQueueInternal = function setQueueInternal(tracks = [], startIndex = 0) {
    const { tracePlayback, logDirectInternalCallViolation } = self._deps;

    logDirectInternalCallViolation("setQueueInternal");
    const normalized = (tracks || []).map(normalizeTrack).filter((t) => t.src);
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    const before = getCanonicalSelection();
    const sameTracks = playbackQueuesMatch(normalized, before.queue);
    tracePlayback("queueReset", "setQueue", { length: normalized.length, index, sameTracks });
    perfMark(MARKS.QUEUE_UPDATE_START);
    startTransition(() => {
      proposeSelection("setQueueAndSelect", [normalized, index]);
      perfMark(MARKS.QUEUE_UPDATE_END);
      perfMeasure("queue-update", MARKS.QUEUE_UPDATE_START, MARKS.QUEUE_UPDATE_END);
    });
    return normalized;
  };

  self.playNextInternal = async function playNextInternal({ autoAdvance = false } = {}) {
    const { requestAuthoritativePlay, stateRef } = self._deps;

    const current = stateRef.current.currentTrack;
    if (autoAdvance && current?.metadata?.access?.previewOnly) {
      return false;
    }
    const before = getCanonicalSelection();
    const result = proposeSelection("next", [{
      repeatMode: before.repeatMode,
      shuffle: before.shuffle,
      autoAdvance,
      isPlayable: isPlayableEntry,
    }]);
    if (!result.accepted || result.unchanged || result.endOfQueue || !result.snapshot.nowPlaying) {
      return false;
    }
    if (typeof requestAuthoritativePlay !== "function") return false;
    return requestAuthoritativePlay(result.snapshot.nowPlaying, {
      resumeAt: 0,
      ...(autoAdvance
        ? { playbackScenario: PLAYBACK_SCENARIOS.QUEUE_AUTO_ADVANCE }
        : {}),
    }, {
      queueEntries: result.snapshot.queue,
      queueIndex: result.snapshot.queueIndex,
      alreadySelected: true,
      source: autoAdvance ? "autoplay" : "user",
      requireCurrentPlaying: autoAdvance,
      expectedCurrentMediaIdentity: autoAdvance
        ? (current?.id ?? current?.trackId ?? current?.slug ?? null)
        : null,
    });
  };

  self.playPreviousInternal = async function playPreviousInternal() {
    const {
      requestAuthoritativePlay, requestAuthoritativeSeek, audioRef,
    } = self._deps;

    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      if (typeof requestAuthoritativeSeek !== "function") return false;
      return requestAuthoritativeSeek(0);
    }
    const before = getCanonicalSelection();
    const result = proposeSelection("previous", [{
      repeatMode: before.repeatMode,
      isPlayable: isPlayableEntry,
    }]);
    if (!result.accepted || result.unchanged || !result.snapshot.nowPlaying) {
      return false;
    }
    if (typeof requestAuthoritativePlay !== "function") return false;
    return requestAuthoritativePlay(result.snapshot.nowPlaying, { resumeAt: 0 }, {
      queueEntries: result.snapshot.queue,
      queueIndex: result.snapshot.queueIndex,
      alreadySelected: true,
      source: "user",
    });
  };

  self.playQueueInternal = async function playQueueInternal(tracks = [], startIndex = 0, options = {}) {
    const {
      logDirectInternalCallViolation,
      requestAuthoritativePlay,
      stopAfterEachTrackRef,
    } = self._deps;
    logDirectInternalCallViolation("playQueueInternal");
    // autoAdvance defaults to true — singles/features pass false to stop after each track.
    // Preview-only tracks always stop after play; no queue advance for entry-level users.
    const startTrack = tracks[Math.max(0, Math.min(startIndex, tracks.length - 1))];
    const isPreviewOnlyStart = Boolean(startTrack?.metadata?.access?.previewOnly);
    stopAfterEachTrackRef.current = options.autoAdvance === false || isPreviewOnlyStart;
    const normalized = self.setQueueInternal(tracks, startIndex);
    if (!normalized.length) return false;
    const index = Math.max(0, Math.min(startIndex, normalized.length - 1));
    if (typeof requestAuthoritativePlay !== "function") return false;
    const result = getCanonicalSelection();
    return requestAuthoritativePlay(result.nowPlaying ?? normalized[index], {
      ...options,
      preserveActiveStream: Boolean(options.preserveActiveStream),
      // An explicit playQueue intent always starts from 0 unless the caller passes an
      // explicit resumeAt (e.g. session-restore). Without this, getSavedPlaybackPosition
      // silently restores a stale mid-track position when the user taps "Play All".
      resumeAt: options.resumeAt != null ? options.resumeAt : 0,
    }, {
      queueEntries: result.queue,
      queueIndex: result.queueIndex,
      alreadySelected: true,
      source: options.source ?? "user",
    });
  };
}
