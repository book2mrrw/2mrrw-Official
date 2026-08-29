/**
 * 2MRRW Playback Core — public API surface.
 *
 * The only stable import point for all external consumers of the Core.
 * Internals (IntentFactory, AuthorityGate, DomainStore, CommitGate, etc.)
 * are NOT exported here — they are Core-private.
 *
 * USAGE:
 *   import { PlaybackCore, CoreCommandType, ResumePolicy, StoreKey, Domain, DomainOwner } from '@/lib/playback-core';
 *
 *   const core = PlaybackCore.create();
 *   core.port.play({ trackId: '...', resumePolicy: ResumePolicy.RESUME_IF_AVAILABLE });
 *   core.port.pause();
 *   core.port.seek({ positionSeconds: 42 });
 *   core.destroy();
 *
 * MIGRATION:
 *   core.legacyAdapter  — read-only snapshot access during legacy→Core migration
 *   core.reactAdapter   — useSyncExternalStore hooks for React components
 *   core._transferDomainToCore(domain) — called by Slice 1+ wiring only
 */

// ─── Top-level Core class ─────────────────────────────────────────────────────
export { PlaybackCore } from "./core/PlaybackCore.js";

// ─── Public type constants ────────────────────────────────────────────────────
export {
  CoreCommandType,
  IntentType,
  ResumePolicy,
  DomainOwner,
  Domain,
  StoreKey,
  CommitRejectionReason,
  DiagnosticEventType,
  TransportStatus,
  TransportObservationType,
} from "./types/index.js";

// ─── Adapter classes (for migration and React integration) ───────────────────
export { LegacyPlaybackAdapter }  from "./ports/LegacyPlaybackAdapter.js";
export { ReactPlaybackAdapter }   from "./adapters/ReactPlaybackAdapter.js";
