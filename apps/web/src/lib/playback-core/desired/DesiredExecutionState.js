/**
 * DesiredExecutionState — what the user currently wants the transport to be doing.
 *
 * WHY THIS EXISTS (Slice 1C):
 *   Slice 1B physically proved that independent last-command-wins instructions
 *   cannot represent user intent across all valid timing sequences. The failing
 *   case was PLAY A → PAUSE: PAUSE carried no media identity, so the queued PLAY
 *   completed afterwards and set transport back to PLAYING. Under a desired-state
 *   model PAUSE inherits the media identity PLAY established and mutates only the
 *   transport disposition, so convergence ends at "A, PAUSED".
 *
 * NAMING — why "Execution" and not "Playback":
 *   Core does NOT own canonical Selection state. NowPlaying + Queue + QueueIndex
 *   must migrate together in Slice 3. `requestedMediaIdentity` is therefore a
 *   TRANSPORT-EXECUTION TARGET carried on the PLAY request — it is not a claim of
 *   Selection ownership, and nothing here writes the Selection domain. PSM/legacy
 *   remains the canonical Selection authority.
 *
 * OWNERSHIP:
 *   Core owns:  USER INTENT AUTHORITY + DESIRED EXECUTION STATE
 *   PSM owns:   CANONICAL PHYSICAL / ORCHESTRATION TRANSPORT STATE
 *   Desired state is not canonical physical state. Physical state is permitted to
 *   lag desired state (INV-DESIRED-3); it may never converge toward a stale revision.
 *
 * REVISION vs COMMIT VERSION — two different dimensions, both retained:
 *   desiredRevision  → what the user currently WANTS   (this file)
 *   commitVersion    → what canonical state has ACCEPTED as truth (DomainStore)
 */

/** Transport disposition the user is asking for. */
export const TransportDisposition = Object.freeze({
  IDLE:    "IDLE",
  PLAYING: "PLAYING",
  PAUSED:  "PAUSED",
});

/**
 * @typedef {Object} DesiredExecutionState
 * @property {number}      revision               monotonically increasing, Core-owned
 * @property {string|null} requestedMediaIdentity transport-execution target (NOT Selection ownership)
 * @property {object|null} requestedMediaEntry    full track object for the legacy PLAY_TRACK payload
 * @property {object|null} requestedOptions       execution options preserved through convergence
 * @property {string}      desiredTransport       TransportDisposition
 * @property {number|null} positionTarget         explicit seek target; null = "whatever the load yields"
 * @property {string|null} resumePolicy           carried through to the legacy handler
 * @property {string|null} sourceIntentId         intent that produced this revision (diagnostics)
 */

/** The state before any user intent has been expressed. */
export function initialDesiredExecutionState() {
  return Object.freeze({
    revision:               0,
    requestedMediaIdentity: null,
    requestedMediaEntry:    null,
    requestedOptions:       null,
    desiredTransport:       TransportDisposition.IDLE,
    positionTarget:         null,
    resumePolicy:           null,
    sourceIntentId:         null,
  });
}

/**
 * True when two desired states describe the same intent, ignoring revision.
 * Used to suppress redundant diagnostics, never to skip convergence.
 */
export function sameDesiredIntent(a, b) {
  return (
    a.requestedMediaIdentity === b.requestedMediaIdentity &&
    a.desiredTransport       === b.desiredTransport &&
    a.positionTarget         === b.positionTarget
  );
}
