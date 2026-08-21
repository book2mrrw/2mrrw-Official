/**
 * 2MRRW Playback Core — canonical type constants.
 *
 * Framework-independent: no React, no browser APIs, no Next.js.
 * All values are frozen — treat them as sealed enums.
 */

// ─── Public command types (issued by UI through PlaybackPort) ─────────────────

export const CoreCommandType = Object.freeze({
  PLAY:          "PLAY",
  PAUSE:         "PAUSE",
  RESUME:        "RESUME",
  SEEK:          "SEEK",
  NEXT:          "NEXT",
  PREVIOUS:      "PREVIOUS",
  SET_QUEUE:     "SET_QUEUE",
  REORDER_QUEUE: "REORDER_QUEUE",
});

// ─── Internal intent types ────────────────────────────────────────────────────
// Superset of CoreCommandType. UI never sees these labels.

export const IntentType = Object.freeze({
  ...CoreCommandType,
  // Reserved for future internal-only intent types (e.g., PRELOAD_NEXT, HANDOFF)
});

// ─── Resume policy ────────────────────────────────────────────────────────────
// Explicit enumeration — replaces the ambiguous resumeAt: 0 pattern.
// Starting from position zero and deleting a saved position are SEPARATE operations.

export const ResumePolicy = Object.freeze({
  /** Always start at 0:00. Never restore saved position. Does NOT delete history. */
  START_FROM_BEGINNING:     "START_FROM_BEGINNING",
  /** Restore saved position if one exists; otherwise start from 0:00. */
  RESUME_IF_AVAILABLE:      "RESUME_IF_AVAILABLE",
  /** Restore to an explicit caller-supplied position. */
  RESUME_EXACT_POSITION:    "RESUME_EXACT_POSITION",
  /** Continue from wherever the current session is, ignoring saved position. */
  CONTINUE_CURRENT_SESSION: "CONTINUE_CURRENT_SESSION",
  /** Restart the entire release from track 1 / 0:00. */
  RESTART_RELEASE:          "RESTART_RELEASE",
});

// ─── Domain ownership ─────────────────────────────────────────────────────────
// Exactly one writer per canonical state domain at any instant.
// LEGACY + CORE must never coexist as dual writers.

export const DomainOwner = Object.freeze({
  LEGACY: "LEGACY",
  CORE:   "CORE",
});

// ─── Canonical state domains ──────────────────────────────────────────────────

export const Domain = Object.freeze({
  TRANSPORT:         "TRANSPORT",
  SELECTION:         "SELECTION",
  CAPABILITY:        "CAPABILITY",
  CONTINUITY:        "CONTINUITY",
  MEDIA_PREPARATION: "MEDIA_PREPARATION",
});

// ─── Commit rejection reasons ─────────────────────────────────────────────────

export const CommitRejectionReason = Object.freeze({
  /** A newer intent was registered — this one no longer has authority. */
  SUPERSEDED:               "SUPERSEDED",
  /** The target domain is not yet owned by Core. */
  DOMAIN_NOT_OWNED_BY_CORE: "DOMAIN_NOT_OWNED_BY_CORE",
  /** The intent object is missing required fields. */
  INVALID_INTENT:           "INVALID_INTENT",
  /** Deck B: media environment epoch changed since preparation began. */
  EPOCH_MISMATCH:           "EPOCH_MISMATCH",
  /** Deck B: queue version changed since preparation began. */
  QUEUE_VERSION_MISMATCH:   "QUEUE_VERSION_MISMATCH",
  /** Deck B: capability version changed since preparation began. */
  CAPABILITY_MISMATCH:      "CAPABILITY_MISMATCH",
  /** Deck B: prediction generation changed since preparation began. */
  PREDICTION_MISMATCH:      "PREDICTION_MISMATCH",
});

// ─── Diagnostic event types ───────────────────────────────────────────────────
// Every intent lifecycle stage has a named event so race conditions are observable.

export const DiagnosticEventType = Object.freeze({
  CORE_INITIALIZED:            "CORE_INITIALIZED",
  CORE_DESTROYED:              "CORE_DESTROYED",
  INTENT_CREATED:              "INTENT_CREATED",
  INTENT_AUTHORITY_GRANTED:    "INTENT_AUTHORITY_GRANTED",
  INTENT_AUTHORITY_SUPERSEDED: "INTENT_AUTHORITY_SUPERSEDED",
  INTENT_EXECUTION_START:      "INTENT_EXECUTION_START",
  INTENT_EXECUTION_COMPLETE:   "INTENT_EXECUTION_COMPLETE",
  INTENT_EXECUTION_ERROR:      "INTENT_EXECUTION_ERROR",
  INTENT_COMMIT_PROPOSED:      "INTENT_COMMIT_PROPOSED",
  INTENT_COMMIT_ACCEPTED:      "INTENT_COMMIT_ACCEPTED",
  INTENT_COMMIT_REJECTED:      "INTENT_COMMIT_REJECTED",
  DOMAIN_OWNER_CHANGED:        "DOMAIN_OWNER_CHANGED",
  DOMAIN_COMMITTED:            "DOMAIN_COMMITTED",
});

// ─── Named domain store keys ──────────────────────────────────────────────────
// Keys used to look up domain stores inside PlaybackCore.
// Kept separate from Domain constants because stores are more granular
// (transport is split into three hot/cold stores).

export const StoreKey = Object.freeze({
  NOW_PLAYING:       "nowPlaying",
  TRANSPORT_STATUS:  "transportStatus",
  TRANSPORT_TIMELINE:"transportTimeline",
  TRANSPORT_MODE:    "transportMode",
  QUEUE:             "queue",
  CAPABILITY:        "capability",
  CONTINUITY:        "continuity",
  DIAGNOSTICS:       "diagnostics",
});
