/**
 * DesiredStateReducer — pure reduction of a user intent onto desired state.
 *
 * INV-DESIRED-2 (locked):
 *   A later command may inherit unaffected desired-state fields from prior
 *   commands. Supersession revokes AUTHORITY, not SEMANTIC CONTEXT.
 *
 * This is the whole fix for HB-2 in one sentence: PAUSE mutates `desiredTransport`
 * and inherits `requestedMediaIdentity`, so the media selection established by an
 * earlier PLAY survives the supersession that revoked that PLAY's authority.
 *
 * Pure: no I/O, no clock, no randomness, no mutation of the input. Returns a new
 * frozen state, or the SAME object when the intent is out of scope.
 */

import { TransportDisposition } from "./DesiredExecutionState.js";
import { CoreCommandType }      from "../types/index.js";

/**
 * Resolve the transport-execution target for a PLAY intent.
 * Prefers the full queue entry (needed for the legacy PLAY_TRACK payload) and
 * falls back to a minimal identity object.
 */
function resolveMediaEntry(intent) {
  const entry =
    intent.queueEntries?.[intent.queueIndex ?? 0] ??
    (intent.trackId ? { id: intent.trackId, slug: intent.trackId } : null);
  return entry;
}

function identityOf(entry) {
  return entry?.id ?? entry?.slug ?? null;
}

/**
 * Reduce one intent onto the current desired state.
 *
 * @param {import('./DesiredExecutionState.js').DesiredExecutionState} state
 * @param {import('../intents/IntentFactory.js').PlaybackIntent} intent
 * @returns {import('./DesiredExecutionState.js').DesiredExecutionState}
 *   A new frozen state with revision+1, or `state` unchanged if out of scope.
 */
export function reduceDesiredState(state, intent) {
  const next = (patch) =>
    Object.freeze({
      ...state,
      ...patch,
      revision:       state.revision + 1,
      sourceIntentId: intent.intentId ?? null,
    });

  switch (intent.type) {
    // PLAY establishes a NEW media target. positionTarget is cleared to null so
    // the legacy handler's own resume-policy logic decides the start position —
    // Core does not fight it with an explicit seek.
    case CoreCommandType.PLAY: {
      const entry = resolveMediaEntry(intent);
      return next({
        requestedMediaIdentity: identityOf(entry),
        requestedMediaEntry:    entry,
        requestedOptions:       intent.options ?? null,
        desiredTransport:       TransportDisposition.PLAYING,
        positionTarget:         null,
        resumePolicy:           intent.resumePolicy ?? null,
      });
    }

    // PAUSE / RESUME mutate ONLY the disposition. Media identity and position
    // target are inherited — this is INV-DESIRED-2 and the HB-2 fix.
    case CoreCommandType.PAUSE:
      return next({ desiredTransport: TransportDisposition.PAUSED });

    case CoreCommandType.RESUME:
      return next({ desiredTransport: TransportDisposition.PLAYING });

    // SEEK mutates ONLY the position target. Media identity and disposition are
    // inherited, so a SEEK can never land on a track the user did not select.
    case CoreCommandType.SEEK:
      return next({ positionTarget: intent.positionSeconds });

    // Out of Slice 1C scope — desired state is untouched and the revision does
    // NOT advance, so no convergence work is implied.
    default:
      return state;
  }
}
