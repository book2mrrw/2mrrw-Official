# entitlements:updated — Event Map

## Dispatch sites (grep: src only)

| # | File | Line | Trigger | Also refreshes account? |
|---|------|-----|---------|-------------------------|
| D1 | `app/success/page.js` | ~111 | After first `Promise.all([refreshAccountState(), refreshLibrary()])` on success mount | Yes (immediately before) |
| D2 | `app/page.js` | ~1449 | `handleCheckoutSuccess` (inline checkout on home) | Yes (`refreshAccountState` + `refreshLibrary`) |

**No dispatch** from: `subscribe/page.js`, `AuthContext`, `CollectorCardModal`, OTP flows, or poll-only refreshes.

## Listeners

| File | Handler | Condition | Playback effect |
|------|---------|-----------|-----------------|
| `context/AudioContext.js` L2191–2202 | `onEntitlementsUpdated` | `!authLoading` && current track `metadata.access.previewOnly` && `isPlaying` | Calls `upgradeToFullStream()` — hot-swaps stream URL |

**Listener count:** 1 (single add in AudioProvider).

## Duplicate events?

| Scenario | Events fired |
|----------|--------------|
| Home inline checkout | 1× (D2) after refresh |
| Redirect to `/success` after checkout | 1× (D1) — separate navigation |
| User completes checkout on home **and** lands on success | Potentially **2×** if both flows run (unusual UX) |
| Poll `refreshAccountState` on success page | **0** extra events — only first batch dispatches |

## Stale preview risk

If purchase completes but **only** `refreshAccountState` runs (collector modal, gift, library change) **without** dispatch:

- UI entitlements update via React state  
- **Preview stream may remain** until user pauses/plays or another D1/D2 fires  

## authLoading gate

While bootstrap `loading === true`, listener returns early — upgrade ignored. If event fires during loading window after fast checkout, upgrade deferred until loading false (no retry queue).
