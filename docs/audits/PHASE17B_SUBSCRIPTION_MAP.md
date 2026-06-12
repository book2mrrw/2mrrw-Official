# Phase 17B — Subscription Map (pre-implementation)

**Date:** 2026-06-01  
**Base:** Phase 17A `d817d1e` (persistent `HomeStorefront` mount)  
**Goal:** Playback, auth, and entitlement context updates must not reconcile `HeroSection` + `HomeStorefront`.

---

## Island ownership

| Island | Subscribes | Owns UI / behavior | Does not wrap |
|--------|------------|-------------------|---------------|
| **PlaybackChromeIsland** | `useAudioPlayer()` | `nowPlaying` sync, `AmbientPlaybackBackground`, desktop/mobile `StorefrontMiniPlayerBar`, scroll/cart FAB insets via context, ambient pause when `isPlaying`, `page-playback-actions-bridge` | `HeroSection` |
| **AuthSurfaceIsland** | `useAuth()` (admin/session slice) | `isAdminStable`, `openGiftSheet`, `handleLibraryChange` for gated surfaces | Hero |
| **EntitlementSurfaceIsland** | `useEntitlementAccountState()` | `entitlementAccountState`, `showSubscribeCta`, `showOwnTrackConversion` for gated surfaces | Hero |

---

## Page (`src/app/page.js`) after 17B

| Concern | Before 17B | After 17B |
|---------|------------|-----------|
| `useAudioPlayer()` | Full hook on `Page` | **Removed** — `usePagePlaybackActions()` (bridge, no re-render) |
| `useEntitlementAccountState()` | On `Page` | **Removed** — islands + `useAuth().accountState` for checkout upsell only |
| `useAuth()` | Full hook on `Page` | **Kept** for account tab, cart, checkout, deep links, `owns()` |
| `nowPlaying` / mini player | `Page` state + JSX | **PlaybackChromeIsland** |
| `mobileScrollPadding` | Derived on `Page` (re-rendered hero parent) | **PlaybackChromeContext** — applied below hero only |
| `activeFlowMode` | Derived on `Page` from `nowPlaying` | **HomeStorefrontFlowMode** (reads chrome context) |
| `HeroSection` props | `isMobile`, `mobileHeroHeight` | Unchanged — **no `nowPlaying` in parent chain** |

---

## Re-render blast radius (target)

```text
AudioContext patch (isPlaying, currentTrack, …)
  → PlaybackChromeIsland (+ MobileCartFab, HomeStorefrontFlowMode)
  → NOT HeroSection, NOT catalog-only Page state

Entitlement snapshot bump
  → EntitlementSurfaceIsland descendants (home, music grids, modals island)
  → NOT HeroSection

Auth session / admin flag
  → AuthSurfaceIsland descendants + Page account chrome (useAuth)
  → NOT HeroSection (unless user resizes / tab / catalog on Page)
```

---

## Hero render triggers (remaining on `Page`)

| Trigger | Re-renders `HeroSection`? |
|---------|---------------------------|
| `isMobile` / resize | **Yes** (prop) |
| `mobileHeroHeight` | **Yes** (`isMobile` only — 200 vs 380) |
| Playback state | **No** (island) |
| Entitlement snapshot | **No** (island) |
| `activeTab` / catalog / modals | **Yes** (same `Page` component — acceptable P2) |

Documented in `PHASE17B_RENDER_ISLAND_VALIDATION.md`.

---

## Stable `HomeStorefront` props (Page)

| Prop | Stabilization |
|------|----------------|
| `onDonateOpen` | `useCallback(() => setDonateOpen(true), [])` |
| `onFlowConversionActive` | `setFlowConversionActive` (stable setState) |
| `onSelectEvent` | `setSelectedEvent` |
| `onOpenAlbumTracklist` | `setAlbumTracklistRelease` |
| `onOpenCollection` | `openCollection` (`useCallback`) |
| Auth/entitlement | Injected by islands (not from `Page` render of those hooks) |

---

## Trace (`NEXT_PUBLIC_PLAYBACK_TRACE=1`)

| Event | Source |
|-------|--------|
| `playback-chrome-island` | `PlaybackChromeIsland` mount/update |
| `auth-surface-island` | `AuthSurfaceIsland` |
| `entitlement-surface-island` | `EntitlementSurfaceIsland` |
| Existing `HOME_*`, `catalog-rerender`, `scroll` | `page.js` (unchanged) |

---

## Files added

- `src/components/storefront/PlaybackChromeIsland.js`
- `src/components/storefront/AuthSurfaceIsland.js`
- `src/components/storefront/EntitlementSurfaceIsland.js`
- `src/components/storefront/HomeStorefrontFlowMode.js`
- `src/components/storefront/MobileCartFab.js`
- `src/components/storefront/playback-chrome-context.js`
- `src/lib/playback/page-playback-actions-bridge.js`
- `src/hooks/usePagePlaybackActions.js`
