# Root Causes and Divergence

- Playback normalization had two competing meanings: catalog-item normalization and playback-track construction.
- Singles/Features/Album modal had duplicated conversion logic in `src/app/page.js` instead of one canonical helper.
- Stream JSON handling accepted non-audio upstream outcomes implicitly; signed URL content-type was not validated before playback handoff.
- Stream fetches could race each other under rapid taps/modal transitions, allowing stale responses to win.
- Visibility resume attempted autoplay after tab restore on iOS-class devices, which can violate gesture-chain expectations.

## Canonicalized In This Change

- `normalizeTrackForPlayback(...)` is now the canonical playback-track builder in `src/lib/music-playback.js`.
- Singles/features/album fallback play entry in `src/app/page.js` now routes through one helper (`playCanonicalCatalogItem`).
- Stream client validates JSON response content-type and validates signed URL content-type via HEAD before acceptance.
- AudioContext uses abort + request-id gating so latest request wins deterministically.
