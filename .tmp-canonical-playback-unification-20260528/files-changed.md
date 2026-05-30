# Files Changed

- `src/lib/playback/stream-client.js`
  - Added structured stream errors.
  - Added strict JSON content-type assertion for stream API responses.
  - Added signed URL HEAD validation for audio-compatible content-type.
  - Added `signal` support for abortable fetches.

- `src/lib/music-playback.js`
  - Implemented canonical `normalizeTrackForPlayback(...)` as playback-track constructor.
  - Routed `toPlaybackTrack(...)` through canonical function.

- `src/context/AudioContext.js`
  - Added request-id + abort-controller cancellation system.
  - Added latest-request-wins gating for async stream resolution.
  - Added stream content-type guard enforcement at runtime.
  - Added explicit structured error logging in playback failure path.
  - Hardened visibility resume behavior on iOS-class devices.

- `src/app/page.js`
  - Unified singles/features/album modal fallback playback through one canonical helper (`playCanonicalCatalogItem`).
  - Replaced direct conversion duplication with `normalizeTrackForPlayback(...)`.

- `src/app/api/library/stream/route.js`
  - Added `X-Content-Type-Options: nosniff` on redirect stream responses.
