# Architecture After

## Canonical playback pipeline

1. UI entry point calls `playQueue`/`playTrack` with canonical track data from `normalizeTrackForPlayback`.
2. `AudioContext.playTrack` normalizes runtime state, increments request id, aborts prior stream resolution, and owns active resolution.
3. Entitled stream path resolves via `/api/library/stream` + `fetchLibraryStream(...)`.
4. Client validates:
   - library endpoint payload is JSON
   - signed stream URL exists
   - signed stream HEAD content-type is audio/octet-stream
5. Audio element source swap is applied only if request id still matches current request.

## Determinism and safety

- Latest playback request wins (AbortController + request id checks).
- Non-audio stream payloads are rejected before assignment.
- iOS visibility restore no longer unsafe-autoplays outside gesture chain.
- Singles/features/albums share identical canonical conversion helper in page-level modal open flows.
