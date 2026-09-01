/**
 * Module-level playback command executor — lives entirely outside React.
 * All mutable state is accessed via runtime refs at call time, never captured
 * in closures. This function has a permanently stable identity: callers import
 * and call it directly with no ref indirection required.
 *
 * Chain of authority:
 *   dispatchPlaybackCommand → [serial queue] → executePlaybackCommand → handler bag
 */

import { getAudioEngineRuntime } from "./audio-engine-runtime";
import { isSamePlaybackTrack } from "@/lib/music-playback";
import { PLAYBACK_ORCHESTRATION_EVENTS } from "@/media/PlaybackStateMachine";
import { PLAYBACK_COMMANDS } from "./playback-commands";
import { PhysicalEffectAuthorityMode } from "@/lib/audio/physical-effect-authority";

/**
 * Execute a single playback command against the current handler bag.
 * Returns false if the command has been superseded or no handler is registered.
 *
 * @param {{ type: string, payload: Record<string, any>, requestId: number }} command
 * @returns {Promise<boolean|any>}
 */
export async function executePlaybackCommand(command) {
  const { activeCommandRef, commandHandlersRef, queueRef, tracePlaybackRef } =
    getAudioEngineRuntime().refs;

  if (command.requestId !== activeCommandRef.current?.requestId) return false;

  const h = commandHandlersRef.current;

  switch (command.type) {
    case PLAYBACK_COMMANDS.PLAY_TRACK: {
      const track = command.payload.track;
      const opts = {
        ...(command.payload.options || {}),
        effectAuthorityMode: command.effectAuthorityMode,
        effectGuardRequired:
          command.effectAuthorityMode === PhysicalEffectAuthorityMode.CORE ||
          command.payload.options?.effectGuardRequired === true,
      };
      // Replace the queue with a single-item queue unless the caller explicitly
      // opts out (retry/recovery flows) or the track is already in the current queue.
      // Without this, playing a single or feature while an album queue is active
      // leaves the old queue intact — when the single ends, the next album track
      // auto-advances instead of stopping (or playing the next single).
      if (track && !opts.preserveQueue) {
        const alreadyQueued = queueRef.current.some((qt) => isSamePlaybackTrack(qt, track));
        if (!alreadyQueued) h.setQueue([track], 0);
      }
      return h.playTrack(track, opts);
    }
    case PLAYBACK_COMMANDS.PLAY_QUEUE:
      return h.playQueue(
        command.payload.tracks || [],
        command.payload.startIndex || 0,
        command.payload.options || {}
      );
    case PLAYBACK_COMMANDS.PAUSE:
      h.pause({ userInitiated: true });
      return true;
    case PLAYBACK_COMMANDS.INTERRUPT:
      h.pause({ interrupt: true });
      return true;
    case PLAYBACK_COMMANDS.RESUME:
      return h.resume({
        ...(command.payload || {}),
        effectAuthorityMode:
          command.effectAuthorityMode === PhysicalEffectAuthorityMode.CORE
            ? PhysicalEffectAuthorityMode.CORE
            : PhysicalEffectAuthorityMode.CORE_CURRENT,
        effectGuardRequired:
          command.effectAuthorityMode === PhysicalEffectAuthorityMode.CORE ||
          command.payload?.effectGuardRequired === true,
      });
    case PLAYBACK_COMMANDS.RECOVER: {
      tracePlaybackRef.current?.("recovery", "executePlaybackCommand", {
        command: "RECOVER",
        reason: command.payload?.reason ?? null,
      });
      if (command.payload?.hard === false) {
        return h.resume();
      }
      return h.recover(
        PLAYBACK_ORCHESTRATION_EVENTS.RECOVERY_REQUESTED,
        {
          reason: command.payload?.reason || "recover_command",
          resumeAfter: Boolean(command.payload?.resumeAfter ?? true),
        }
      );
    }
    case PLAYBACK_COMMANDS.SEEK:
      h.seek(command.payload.time);
      return true;
    case PLAYBACK_COMMANDS.NEXT_TRACK:
      return h.playNext();
    case PLAYBACK_COMMANDS.COMPLETE:
      return h.playNext({ autoAdvance: true });
    case PLAYBACK_COMMANDS.PREV_TRACK:
      return h.playPrev();
    case PLAYBACK_COMMANDS.STOP:
      h.stop();
      return true;
    case PLAYBACK_COMMANDS.SET_QUEUE:
      h.setQueue(command.payload.tracks || [], command.payload.startIndex ?? 0);
      return true;
    case PLAYBACK_COMMANDS.REPLACE_TRACK:
      return h.playTrack(command.payload.track, command.payload.options || {});
    case PLAYBACK_COMMANDS.UPGRADE_STREAM:
      return h.upgradeStream();
    case PLAYBACK_COMMANDS.RECOVER_PLAYBACK:
      return h.retryStream();
    case PLAYBACK_COMMANDS.VIEWPORT_PAUSE:
      h.pause({ fromViewport: true });
      return true;
    case PLAYBACK_COMMANDS.VIEWPORT_RESUME:
      return h.resumeViewport();
    case PLAYBACK_COMMANDS.SET_PLAYBACK_RATE:
      h.setPlaybackRate(command.payload.rate);
      return true;
    default:
      return false;
  }
}
