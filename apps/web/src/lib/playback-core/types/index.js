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
  /** Deck B: queue version changed since preparation began (future Deck B/prediction contract — distinct from Selection's selectionVersion). */
  QUEUE_VERSION_MISMATCH:   "QUEUE_VERSION_MISMATCH",
  /** Deck B: capability version changed since preparation began. */
  CAPABILITY_MISMATCH:      "CAPABILITY_MISMATCH",
  /** Deck B: prediction generation changed since preparation began. */
  PREDICTION_MISMATCH:      "PREDICTION_MISMATCH",
  /** Selection: the runtime epoch rotated since this proposal was captured. */
  SELECTION_EPOCH_MISMATCH: "SELECTION_EPOCH_MISMATCH",
  /** Selection: selectionVersion advanced since this proposal captured its base. */
  SELECTION_VERSION_STALE:  "SELECTION_VERSION_STALE",
  /** Selection: the proposed snapshot fails structural/coherence validation. */
  SELECTION_INVALID:        "SELECTION_INVALID",
  /** Continuity: the runtime epoch rotated since this candidate was captured. */
  CONTINUITY_EPOCH_MISMATCH: "CONTINUITY_EPOCH_MISMATCH",
  /** Continuity: the persisted candidate's schemaVersion is missing, corrupt, or unsupported. */
  CONTINUITY_SCHEMA_INVALID: "CONTINUITY_SCHEMA_INVALID",
  /** Continuity: the candidate fails structural validation (not a schema problem). */
  CONTINUITY_INVALID:        "CONTINUITY_INVALID",
  /** Continuity: a newer PLAY/PAUSE/RESUME/SEEK has landed since this position
   * restore was captured (DesiredStateStore.revision advanced) — the seek/pause
   * authority the user currently has moved on, even for the same track and the
   * same CoreEpoch. Distinct from CONTINUITY_EPOCH_MISMATCH (whole-runtime reset). */
  CONTINUITY_POSITION_SUPERSEDED: "CONTINUITY_POSITION_SUPERSEDED",
});

// ─── Selection transition types (Slice 3) ─────────────────────────────────────
// Named canonical transitions accepted by SelectionAuthority. Selection commits
// never accept arbitrary state patches — every commit is produced by exactly one
// of these named, validated transitions.

export const SelectionTransitionType = Object.freeze({
  SET_QUEUE_AND_SELECT: "SET_QUEUE_AND_SELECT",
  SELECT_INDEX:         "SELECT_INDEX",
  SELECT_MEDIA:         "SELECT_MEDIA",
  NEXT:                 "NEXT",
  PREVIOUS:             "PREVIOUS",
  REMOVE_ITEM:          "REMOVE_ITEM",
  INSERT_ITEM:          "INSERT_ITEM",
  REORDER_QUEUE:        "REORDER_QUEUE",
  REPLACE_QUEUE:        "REPLACE_QUEUE",
  CLEAR_QUEUE:          "CLEAR_QUEUE",
  RESTORE_SELECTION:    "RESTORE_SELECTION",
  SET_TRAVERSAL_POLICY: "SET_TRAVERSAL_POLICY",
  UPDATE_NOW_PLAYING_REPRESENTATION: "UPDATE_NOW_PLAYING_REPRESENTATION",
  UPDATE_QUEUE_REPRESENTATION:       "UPDATE_QUEUE_REPRESENTATION",
});

// ─── Continuity transition types (Slice 4D) ───────────────────────────────────
// Continuity does not hold its own copy of canonical Selection/Transport truth.
// It validates a persisted candidate and, when accepted, PROPOSES into the
// domain that actually owns the field (SelectionAuthority for queue/track,
// the existing SEEK/TransportMode path for position/volume/rate). What
// ContinuityAuthority itself commits (via its own dedicated CommitGate, same
// pattern as every other domain) is bookkeeping about the last validated
// candidate — never a second copy of canonical Selection or Transport state.

export const ContinuityTransitionType = Object.freeze({
  VALIDATE_CANDIDATE:      "VALIDATE_CANDIDATE",
  PROPOSE_SELECTION_RESTORE: "PROPOSE_SELECTION_RESTORE",
  VALIDATE_POSITION_RESTORE: "VALIDATE_POSITION_RESTORE",
  COMMIT_SNAPSHOT:         "COMMIT_SNAPSHOT",
  CLEAR_SNAPSHOT:          "CLEAR_SNAPSHOT",
});

// ─── Core readiness lifecycle ─────────────────────────────────────────────────
// A public PlaybackPort cannot accept executable commands before READY.
// Commands dispatched before _injectExecutionEngine() throw explicitly — no silent drops.

export const CoreReadiness = Object.freeze({
  /** Constructed but execution adapter not yet injected. Port commands throw. */
  CONSTRUCTING: "CONSTRUCTING",
  /** Execution adapter injected. Port accepts commands. */
  READY:        "READY",
  /** Initialization failed permanently. */
  FAILED:       "FAILED",
  /** Destroyed. All port calls throw. */
  DISPOSED:     "DISPOSED",
});

// ─── Diagnostic event types ───────────────────────────────────────────────────
// Every intent lifecycle stage has a named event so race conditions are observable.

export const DiagnosticEventType = Object.freeze({
  CORE_INITIALIZED:               "CORE_INITIALIZED",
  CORE_READY:                     "CORE_READY",
  CORE_DESTROYED:                 "CORE_DESTROYED",
  INTENT_CREATED:                 "INTENT_CREATED",
  INTENT_AUTHORITY_GRANTED:       "INTENT_AUTHORITY_GRANTED",
  INTENT_AUTHORITY_SUPERSEDED:    "INTENT_AUTHORITY_SUPERSEDED",
  INTENT_EXECUTION_START:         "INTENT_EXECUTION_START",
  INTENT_EXECUTION_COMPLETE:      "INTENT_EXECUTION_COMPLETE",
  INTENT_EXECUTION_ERROR:         "INTENT_EXECUTION_ERROR",
  INTENT_COMMIT_PROPOSED:         "INTENT_COMMIT_PROPOSED",
  INTENT_COMMIT_ACCEPTED:         "INTENT_COMMIT_ACCEPTED",
  INTENT_COMMIT_REJECTED:         "INTENT_COMMIT_REJECTED",
  DOMAIN_OWNER_CHANGED:           "DOMAIN_OWNER_CHANGED",
  DOMAIN_COMMITTED:               "DOMAIN_COMMITTED",
  CORE_ADAPTER_DISPATCH:          "CORE_ADAPTER_DISPATCH",
  CORE_ADAPTER_SKIPPED_SUPERSEDED:"CORE_ADAPTER_SKIPPED_SUPERSEDED",
  CORE_ADAPTER_UNKNOWN_COMMAND:   "CORE_ADAPTER_UNKNOWN_COMMAND",
  CORE_ADAPTER_OUT_OF_SCOPE:      "CORE_ADAPTER_OUT_OF_SCOPE",
});

// ─── Slice 1B production routing scope ────────────────────────────────────────
// The adapter defines a permanent mapping for all eight command types, but only
// the commands in this set are routed LIVE through Core to the production
// dispatcher. The remainder stay dormant contract infrastructure until the
// Selection Domain migration, because NowPlaying + Queue + QueueIndex must move
// together — routing NEXT/PREVIOUS/SET_QUEUE early would split that triple
// across two authorities.
//
// Locked for Slice 1B. Widening this set is a Slice 2 decision, not a local one.
export const CoreLiveCommandScope = Object.freeze(new Set([
  CoreCommandType.PLAY,
  CoreCommandType.PAUSE,
  CoreCommandType.RESUME,
  CoreCommandType.SEEK,
]));

// ─── Named domain store keys ──────────────────────────────────────────────────
// Keys used to look up domain stores inside PlaybackCore.
// Kept separate from Domain constants because stores are more granular
// (transport is split into three hot/cold stores).

export const StoreKey = Object.freeze({
  // Slice 3: NowPlaying + Queue + QueueIndex form ONE atomic Selection domain.
  // A prior scaffold kept NOW_PLAYING and QUEUE as two separate dormant stores;
  // that would have allowed tearing (a subscriber observing nowPlaying committed
  // but queue not yet committed). They are unified into one SELECTION store.
  SELECTION:         "selection",
  TRANSPORT_STATUS:  "transportStatus",
  TRANSPORT_TIMELINE:"transportTimeline",
  TRANSPORT_MODE:    "transportMode",
  CAPABILITY:        "capability",
  CONTINUITY:        "continuity",
  DIAGNOSTICS:       "diagnostics",
});

// Canonical Transport status is a single coherent state. Presentation booleans
// (`playing`, `buffering`, etc.) are derived by TransportAuthority at commit time;
// no caller may independently combine contradictory flags.
export const TransportStatus = Object.freeze({
  IDLE:       "IDLE",
  LOADING:    "LOADING",
  BUFFERING:  "BUFFERING",
  PLAYING:    "PLAYING",
  PAUSED:     "PAUSED",
  SEEKING:    "SEEKING",
  ENDED:      "ENDED",
  ERROR:      "ERROR",
  RECOVERING: "RECOVERING",
  DEGRADED:   "DEGRADED",
});

// Typed facts/results accepted by the Transport observation boundary. Physical
// producers know only this generic vocabulary; they never import Core internals.
export { TRANSPORT_OBSERVATION as TransportObservationType } from "../../playback/transport-observation-port.js";
