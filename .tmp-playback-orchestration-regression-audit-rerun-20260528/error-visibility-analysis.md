# Error Visibility Analysis

## Silent/low-visibility patterns
- Multiple catches intentionally suppress failures (`catch {}`) without emitting diagnostic payloads.
- Some failures only `console.warn` and never promote user-facing state or structured telemetry.

## High-impact hidden invalidation examples
- `waitAudioSrcReady` has no timeout path, so no emitted error when readiness never resolves.
- `loadAudioSrcAndPlay` swallows non-fatal play failures to console only.
- Several recovery/refresh paths use best-effort catches with no state transition (`stale URL refresh`, unlock, metadata refresh).

## Verdict
- **Error visibility is insufficient: YES**.
- Failures that matter to orchestration can remain silent or weakly surfaced, delaying recovery and root-cause detection.

## File-level points
- `src/context/AudioContext.js` (multiple catch blocks and no readiness timeout diagnostics)
- `src/media/mediaEngineBridge.js` (listener errors ignored)
- `src/system/recovery/useSessionRecovery.js` (hydrate failure fallback is silent to user state)
