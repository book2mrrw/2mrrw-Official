/**
 * IntentFactory — creates frozen PlaybackIntent objects from raw command payloads.
 *
 * UI callers never call this directly. The call chain is:
 *   UI → PlaybackPort → CommandGateway → IntentFactory → PlaybackIntent
 *
 * The intent schema is designed for forward compatibility: optional fields are
 * included only when non-undefined, so later slices can add fields without
 * touching any UI component. The public PlaybackPort surface never exposes
 * intentId, sequence, sessionEpoch, or any other internal field.
 *
 * @param {import('./IntentSequencer.js').IntentSequencer} sequencer
 */
export class IntentFactory {
  #sequencer;

  constructor(sequencer) {
    this.#sequencer = sequencer;
  }

  /**
   * Create a PlaybackIntent from a command payload.
   * Registers the sequence number; caller must then register with AuthorityGate.
   *
   * @param {object} payload
   * @param {string} payload.type          - CoreCommandType constant
   * @param {string} [payload.source]      - who initiated ("user", "system", etc.)
   * @param {string} [payload.trackId]
   * @param {string} [payload.resumePolicy]
   * @param {number} [payload.positionSeconds]
   * @param {Array}  [payload.queueEntries]
   * @param {number} [payload.queueIndex]
   * @param {number} [payload.fromIndex]
   * @param {number} [payload.toIndex]
   * @returns {Readonly<PlaybackIntent>}
   */
  create(payload) {
    const { sequence, intentId } = this.#sequencer.next();

    const intent = {
      intentId,
      sessionEpoch: this.#sequencer.sessionEpoch,
      sequence,
      type: payload.type,
      source: payload.source ?? "unknown",
      createdAt: Date.now(),
    };

    // Include optional payload fields only when explicitly provided.
    // This keeps the intent schema additive — new fields never break old readers.
    if (payload.trackId       !== undefined) intent.trackId        = payload.trackId;
    if (payload.resumePolicy  !== undefined) intent.resumePolicy   = payload.resumePolicy;
    if (payload.positionSeconds !== undefined) intent.positionSeconds = payload.positionSeconds;
    if (payload.queueEntries  !== undefined) intent.queueEntries   = payload.queueEntries;
    if (payload.queueIndex    !== undefined) intent.queueIndex     = payload.queueIndex;
    if (payload.fromIndex     !== undefined) intent.fromIndex      = payload.fromIndex;
    if (payload.toIndex       !== undefined) intent.toIndex        = payload.toIndex;

    return Object.freeze(intent);
  }
}

/**
 * @typedef {object} PlaybackIntent
 * @property {string} intentId        - "<sessionEpoch>:<sequence>" — durable diagnostic ID
 * @property {string} sessionEpoch    - Core lifecycle epoch, never changes within a session
 * @property {number} sequence        - monotonically increasing; used for authority comparison
 * @property {string} type            - IntentType constant
 * @property {string} source          - initiator label
 * @property {number} createdAt       - Date.now() at creation
 * @property {string} [trackId]
 * @property {string} [resumePolicy]
 * @property {number} [positionSeconds]
 * @property {Array}  [queueEntries]
 * @property {number} [queueIndex]
 * @property {number} [fromIndex]
 * @property {number} [toIndex]
 */
