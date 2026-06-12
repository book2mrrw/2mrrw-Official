# Phase 17B — Render Island Validation

**Date:** 2026-06-01  
**Base:** Phase 17A `d817d1e` + Phase 17B render islands  
**Build:** `npm run build` — pass

---

## Structural checks

| Check | Status |
|-------|--------|
| `HeroSection` sibling above `ScrollPaddingShell` (not inside playback padding) | Pass |
| `HomeStorefront` persistent mount (`display: none` off home) | Pass (17A retained) |
| `useAudioPlayer` removed from `Page` | Pass — `PlaybackChromeIsland` + `usePagePlaybackActions` bridge |
| `useEntitlementAccountState` removed from `Page` | Pass — `EntitlementSurfaceIsland` |
| Admin/gift gates on `AuthSurfaceIsland` | Pass |
| Stable `onDonateOpen` (`useCallback`) | Pass |
| `activeFlowMode` from `HomeStorefrontFlowMode` + chrome context | Pass |

---

## Hero remaining re-render triggers

| Trigger | Re-renders `HeroSection`? | Notes |
|---------|---------------------------|--------|
| `isMobile` / resize | Yes | Only intentional layout props |
| `mobileHeroHeight` | Yes | Derived from `isMobile` only (200 / 380) |
| Playback (`isPlaying`, `currentTrack`, …) | **No** | `PlaybackChromeIsland` |
| Entitlement snapshot | **No** | `EntitlementSurfaceIsland` |
| `nowPlaying` / mini player padding | **No** | `ScrollPaddingShell` only |
| `activeTab` / catalog / modals on `Page` | Yes* | *Memo bails if `isMobile` + `mobileHeroHeight` unchanged |

---

## Trace verification (`NEXT_PUBLIC_PLAYBACK_TRACE=1`)

1. Start dev server with trace enabled.
2. Play a track on home — expect `playback-chrome-island` logs; **no** full-page churn from `nowPlaying` on `Page`.
3. Toggle entitlement (or wait for snapshot) — expect `entitlement-surface-island`; hero props unchanged.
4. Admin gift gate — expect `auth-surface-island` on home/music surfaces.

Existing traces retained: `HOME_STOREFRONT_*`, `catalog-rerender`, `scroll`, `section-change`.

---

## Manual QA checklist

- [ ] Home tab → Music → Home: no catalog “refresh” remount (17A + stable mount).
- [ ] Play track: mini player + ambient appear; hero video/carousel behavior unchanged.
- [ ] Mobile: cart FAB clears mini player; bottom padding updates without hero jump.
- [ ] Subscribe CTA on home when entitled state expects it.
- [ ] Admin gift sheet still gated.
- [ ] Immersive preview/album modals: access + gift still correct.

---

## Known follow-ups (out of 17B scope)

- `LiveCountdownProvider` still wraps full page return (P1 narrow).
- `Page` still re-renders on `useAuth()` for account/cart (acceptable; hero memo mitigates).
- Music tab outer shell still on `Page` (only catalog rows are island-wrapped).
