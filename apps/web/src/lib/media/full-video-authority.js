/**
 * FullVideoAuthority — enforces "exactly one full-video session active at a
 * time" as an explicit, additive rule, alongside (not instead of) VRM's own
 * decoder-budget arbitration (video-resource-manager.js). Vault video and
 * Full Visual Experience keep their existing VRM registrations completely
 * unchanged — this is a new, narrow sibling authority for session
 * exclusivity only. It has no knowledge of artwork, Motion Cover, or
 * decoder budget, and can never suppress anything it doesn't itself own.
 *
 * Yield is non-destructive by convention, mirroring VRM's own proven
 * pattern: onRevoked should pause, never unmount/reset/reload.
 */

let _current = null; // { id, onRevoked } | null

export const FullVideoAuthority = {
  /**
   * Request exclusive full-video session authority. If a different session
   * currently holds it, that session's onRevoked fires first (pause, not
   * destroy), then this one is granted immediately — a second request
   * always wins, since only one full-video session is ever a legitimate
   * simultaneous UI state. Calling again with the same id (e.g. a re-render)
   * simply re-confirms this session's own grant without revoking anything.
   */
  requestFullVideoSession(id, { onGranted, onRevoked } = {}) {
    if (_current && _current.id !== id) {
      const prev = _current;
      _current = null;
      try {
        prev.onRevoked?.();
      } catch {
        /* never throw from an authority callback */
      }
    }
    _current = { id, onRevoked };
    try {
      onGranted?.();
    } catch {
      /* never throw from an authority callback */
    }
  },

  /** Release authority. No-ops if `id` doesn't currently hold it. */
  releaseFullVideoSession(id) {
    if (_current?.id === id) _current = null;
  },

  getActiveSessionId() {
    return _current ? _current.id : null;
  },

  /** Test-only: reset all state. */
  _resetForTesting() {
    _current = null;
  },
};
