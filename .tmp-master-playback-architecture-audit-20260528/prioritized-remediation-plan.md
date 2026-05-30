# Prioritized Permanent Remediation Plan

## Critical (P0)
1. Replace ad hoc playback mutation with a serialized command reducer.
   - Scope: `src/context/AudioContext.js`, `src/media/useMediaEngine.js`.
   - Outcome: deterministic ordering, reduced race conditions RC-1/2/8/9/10.
2. Unify stream strategy into one canonical acquisition contract.
   - Scope: `src/lib/music-access.js`, `src/lib/playback/stream-client.js`, `src/app/api/library/stream/route.js`.
   - Outcome: predictable startup/error semantics and simpler retry policy.
3. Introduce lifecycle orchestrator for mobile/app transitions.
   - Scope: `src/context/AudioContext.js`, `src/context/AuthContext.js`, `src/app/page.js`.
   - Outcome: deterministic background/foreground recovery and access sync.

## High (P1)
1. Refactor stream session lifecycle to idempotent, acknowledged semantics.
   - Scope: `src/lib/playback/stream-pipeline.js`, `src/app/api/library/stream/route.js`.
2. Consolidate media session updates to reducer commit points only.
   - Scope: `src/context/AudioContext.js`, `src/lib/media-session-artwork.js`.
3. Remove dual queue authorities (refs + state); keep one source of truth.
   - Scope: `src/context/AudioContext.js`.

## Medium (P2)
1. Harmonize entitlement refresh with playback command pipeline using versioned access snapshots.
   - Scope: `src/lib/music-access.js`, `src/context/AuthContext.js`, `src/context/AudioContext.js`.
2. Reduce listener/timer complexity with operation-scoped cancellation objects.
   - Scope: `src/context/AudioContext.js`, `src/components/audio/GlobalAudioPlayerBar.js`.
3. Add integration tests for queue + lock-screen control + visibility transitions.

## Low (P3)
1. Telemetry event dedupe and playback reducer event alignment.
   - Scope: `src/lib/control-system/playback.js`.
2. Optional SW enhancements for lifecycle observability.
   - Scope: `public/sw.js`, `src/app/layout.js`.

## Architecture principles to enforce
- Single playback authority.
- Single stream acquisition mode per environment.
- Event ordering over mutable refs.
- Lifecycle-first mobile semantics.
- Entitlement state versioning tied to playback command execution.
