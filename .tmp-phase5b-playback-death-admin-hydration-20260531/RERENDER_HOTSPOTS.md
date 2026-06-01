# Rerender Hotspots — "Site Refreshed" Feel

**Basis:** Phase 5A `RERENDER_HOTSPOTS.md` + Phase 5B re-grep (2026-05-31)

---

## Top 10 (blast radius)

| Rank | File | Hook | Trigger | Effect |
|------|------|------|---------|--------|
| 1 | `src/app/page.js` | `useAuth` + `useEntitlementAccountState` + `useAudioPlayer` | Any auth/playback state | Entire home shell (~61 `useState` + effects) |
| 2 | `src/context/AudioContext.js` | `useAuth` + `useEntitlementAccountState` | Auth loading clear, accountState, mediaProgress | Provider re-render; effects re-check |
| 3 | `src/app/page.js` | `liveCountdown` interval | **1 Hz** L1078–1092 | Full page re-render during scroll |
| 4 | `src/components/home/CatalogGrid.js` | props | Parent re-render | Unmemoized; new `onLibraryChange` lambdas |
| 5 | `src/components/audio/GlobalAudioPlayerBar.js` | `useEntitlementAccountState` | Account updates | Bar on all routes |
| 6 | `src/components/preview/ImmersivePreviewModal.js` | entitlements | Modal open + auth | Heavy subtree |
| 7 | `src/components/auth/AppAuthRoot.js` | `authStatus` | loading → authenticated | Gate mount/unmount |
| 8 | `src/hooks/useMusicLibrary.js` | auth | Library tab | My Music tab |
| 9 | `src/app/success/page.js` | poll + refresh | Post-purchase | Multi refresh waves |
| 10 | `src/app/subscribe/page.js` | poll | Subscription confirm | Same pattern |

---

## page.js patterns (admin flicker)

| Pattern | Lines | Note |
|---------|-------|------|
| `entitlementAccountState` → grids | ~1986–2860 | Access badges + locks flip EMPTY→full |
| `isAdmin` → gift | CatalogGrid L100 | Can precede full `accountState` |
| `accountStateReady && isAdmin` | L1687–1688, L2525 | Admin panel delayed vs gift |
| Hero parallax | L776–800 | **Non-React** DOM — feels like refresh |
| AV iframe mount | L452–462 | Layout shift on first IO |

---

## Auth → AudioProvider coupling

`layout.js`: `AuthProvider` > `AudioProvider` — **auth churn re-renders audio provider** without destroying `<audio>`.

---

## Strict Mode (dev)

`sessionBootstrappedRef` prevents double bootstrap fetch; children may still double-mount effects.

---

## Mitigations present

- `accountStateShallowEqual`, `libraryItemsShallowEqual`, `slugSetsEqual`  
- `accountStateFetchingRef`  
- `usePlaybackProgress` + `useSyncExternalStore` for progress without full tree  

---

## Not hotspots for playback stop

- Scroll IO itself only calls `pause()` — does not require parent re-render  
- Re-renders **amplify visibility** of pause + cover flash — symptom pairing, not shared root cause
