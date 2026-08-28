/**
 * The governed commit boundary for effects capable of changing audible output.
 * It is deliberately framework/vendor independent and invokes an admitted effect
 * synchronously so browser gesture activation is not lost.
 */
export class AudibleEffectAuthority {
  #epoch;
  #getDesiredState;
  #logger;
  #disposed = false;

  constructor({ coreEpoch, getDesiredState, logger }) {
    if (!coreEpoch) throw new TypeError("[AudibleEffectAuthority] coreEpoch is required");
    if (typeof getDesiredState !== "function") {
      throw new TypeError("[AudibleEffectAuthority] getDesiredState is required");
    }
    this.#epoch = coreEpoch;
    this.#getDesiredState = getDesiredState;
    this.#logger = logger;
  }

  capture({ desiredRevision, mediaIdentity = null, representationVersion = null } = {}) {
    const desired = this.#getDesiredState();
    return Object.freeze({
      coreEpoch: this.#epoch.current,
      desiredRevision: desiredRevision ?? desired.revision,
      mediaIdentity: mediaIdentity ?? desired.requestedMediaIdentity ?? null,
      representationVersion,
    });
  }

  evaluate(authority, { type = "BECOME_AUDIBLE", mediaIdentity = null } = {}) {
    if (this.#disposed) return { allowed: false, reason: "EFFECT_GUARD_DISPOSED" };
    if (!authority || !this.#epoch.isCurrent(authority.coreEpoch)) {
      return { allowed: false, reason: "CORE_EPOCH_MISMATCH" };
    }

    const desired = this.#getDesiredState();
    if (authority.desiredRevision !== desired.revision) {
      return { allowed: false, reason: "STALE_DESIRED_REVISION" };
    }

    const intendedIdentity = mediaIdentity ?? authority.mediaIdentity ?? null;
    if (
      intendedIdentity &&
      desired.requestedMediaIdentity &&
      intendedIdentity !== desired.requestedMediaIdentity
    ) {
      return { allowed: false, reason: "MEDIA_IDENTITY_MISMATCH" };
    }

    if (type === "BECOME_AUDIBLE" && desired.desiredTransport !== "PLAYING") {
      return { allowed: false, reason: "DESIRED_TRANSPORT_NOT_PLAYING" };
    }

    return { allowed: true, reason: "CURRENT_EFFECT_AUTHORITY" };
  }

  canApplyEffect(authority, effect = {}) {
    const request = {
      type: effect.type ?? "BECOME_AUDIBLE",
      mediaIdentity: effect.mediaIdentity ?? null,
    };
    this.#logger?.emit({
      type: "AUDIBLE_EFFECT_REQUESTED",
      effectType: request.type,
      desiredRevision: authority?.desiredRevision ?? null,
      mediaIdentity: request.mediaIdentity ?? authority?.mediaIdentity ?? null,
    });

    let decision;
    try {
      decision = this.evaluate(authority, request);
    } catch (error) {
      this.#logger?.emit({
        type: "AUDIBLE_EFFECT_GUARD_ERROR",
        effectType: request.type,
        error: error?.message ?? String(error),
      });
      return false;
    }

    this.#logger?.emit({
      type: decision.allowed ? "AUDIBLE_EFFECT_ALLOWED" : "AUDIBLE_EFFECT_REJECTED",
      effectType: request.type,
      reason: decision.reason,
      desiredRevision: authority?.desiredRevision ?? null,
      mediaIdentity: request.mediaIdentity ?? authority?.mediaIdentity ?? null,
    });
    return decision.allowed;
  }

  /**
   * Recovery/retry authority for the already-selected physical media. This
   * samples desired truth at the final boundary, requires exact media identity,
   * and cannot authorize a new selection.
   */
  canApplyCurrentEffect(effect = {}) {
    const desired = this.#getDesiredState();
    const mediaIdentity = effect.mediaIdentity ?? null;
    if (!mediaIdentity || !desired.requestedMediaIdentity) {
      this.#logger?.emit({
        type: "AUDIBLE_EFFECT_REJECTED",
        effectType: effect.type ?? "BECOME_AUDIBLE",
        reason: "MEDIA_IDENTITY_REQUIRED",
        desiredRevision: desired.revision,
        mediaIdentity,
      });
      return false;
    }
    return this.canApplyEffect(
      Object.freeze({
        coreEpoch: this.#epoch.current,
        desiredRevision: desired.revision,
        mediaIdentity,
        representationVersion: null,
      }),
      effect,
    );
  }

  dispose() {
    this.#disposed = true;
  }
}
