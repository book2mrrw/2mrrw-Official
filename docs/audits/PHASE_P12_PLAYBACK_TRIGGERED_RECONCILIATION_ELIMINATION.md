# Phase P12 — Playback-Triggered Reconciliation Elimination

**Repository:** `/Users/recharge/artist-platform`  
**Date:** 2026-06-03  
**Mode:** Forensic + surgical fix (P1/P9/P11 baseline preserved)  
**Symptom:** Cold load stable; **press play** → ~2–3s stall → artwork breaks → gifting/admin icons disappear → storefront feels refreshed  

---

## Executive summary

| Field | Value |
|-------|-------|
| **Root cause** | `playTrackInternal` → `patchState` → `AudioProvider` reconcile propagates to `PageStorefront`; `PlaybackChromeContext` padding/`nowPlaying` updates re-render `ScrollPaddingShell` + `HomeStorefrontFlowMode` under the storefront tree |
| **First state mutation** | `AudioContext.js` `playTrackInternal` — `patchState({ currentTrack, playbackState: "loading", … })` after transport `loading_stream` patch (~L3337) |
| **Secondary (~2–3s)** | Entitled library `backgroundStreamResolve` → `swapToSignedStream` element `src` reload (P2/P3); transport-only after P1 — not primary storefront reconcile driver |
| **Auth/admin icon loss** | Not auth flip — **reconcile + layout chrome** from playback-driven `PageStorefront` / context consumers; P9 chrome store held if `PageAuthRefSync` stopped running every playback tick |
| **Fix** | `AudioProviderSubtree` memo barrier; `playbackUiStateEqual` patch bail-out; external `playback-chrome-layout-store`; `PageAuthRefSync` layout effect deps; memo `SinglesStyleCard` |
| **Confidence** | **84%** reconcile chain; **79%** 2–3s stall = signed swap (unchanged transport path) |

---

## 1. Causal chain (playback → storefront)

```mermaid
sequenceDiagram
  participant User
  participant Card as ReleaseCardPlayButton
  participant AC as AudioContext
  participant AP as AudioProvider
  participant PCI as PlaybackChromeIsland
  participant PS as PageStorefront
  participant HCM as HomeStorefrontCatalogMedia

  User->>Card: Play (e.g. Hour Glass)
  Card->>AC: dispatchPlaybackCommand(playQueue)
  AC->>AC: playTrackInternal
  Note over AC: PLAYBACK_FIRST_MUTATION patchState loading
  AC->>AP: setState (UI fields)
  AP->>PCI: context consumer re-render
  PCI->>PCI: setNowPlaying + layout store commit
  Note over AP,PS: Before P12: PageStorefront re-rendered too
  AP-->>PS: blocked by AudioProviderSubtree memo
  PCI-->>HCM: children stable; no chrome context under catalog
  Note over AC: ~2-3s swapToSignedStream (element only)
```

### Prose

1. User play reaches `playTrackInternal` (`AudioContext.js`).
2. **First UI mutation:** `patchState` sets `currentTrack`, `playbackState: "loading"`, clears errors — `trace: PLAYBACK_FIRST_MUTATION`.
3. Pre-P12: every `setState` re-rendered **all** `AudioProvider` children, including `PageStorefront`, re-running `PageAuthRefSync` `useLayoutEffect` without deps and refreshing chrome/layout subscribers.
4. `PlaybackChromeIsland` synced `nowPlaying` → `PlaybackChromeContext` value change → `ScrollPaddingShell` / `HomeStorefrontFlowMode` re-rendered (padding 110px → 178px, `activeFlowMode` idle → nowplaying) — perceived storefront refresh.
5. P9 pinned media + chrome stores prevented **data** replacement; playback still **reconciled** the tree and MP4 surfaces (decoder stress / layout shift).
6. ~2–3s later, entitled streams: `swapToSignedStream` reloads `audio.src` (P2) — audible stall; P1 keeps this off `setState` for transport flags.

---

## 2. Auth / admin forensics

| Check | Result |
|-------|--------|
| `sessionHydrated` / `isAdmin` flip on play? | **No** direct play path in `AuthContext` |
| `commitStorefrontCardChrome` reset? | Ran on **every** `PageStorefront` render pre-P12; shallow equal usually no-op |
| Gifting visibility | `SinglesStyleCard` → `useStorefrontCardChrome().isAdminStable`; loss correlated with **card re-render/remount**, not entitlement API |
| `AuthSurfaceIsland` on play | Only if parent re-renders; blocked when `PageStorefront` stable |

---

## 3. Render forensics

| Surface | Mechanism | P12 mitigation |
|---------|-----------|----------------|
| Gifting overlay | `isAdminStable` from chrome store | Stop spurious `PageAuthRefSync` + card memo |
| MP4 carousel | Parent reconcile / layout shift | No `STORE_FRONT_REBUILD`; subtree memo + layout store |
| `STORE_FRONT_REBUILD` | Pinned singles (P9) | Unchanged — should not fire on play |
| `MEDIA_CARD_REINITIALIZED` | Remount | Should stay mount-only with stable parents |

---

## 4. Implementation (smallest fix at first trigger)

| # | File | Change |
|---|------|--------|
| 1 | `src/context/AudioContext.js` | `playbackUiStateEqual` + `PLAYBACK_UI_PATCH_SKIPPED`; `AudioProviderSubtree` memo; `PLAYBACK_FIRST_MUTATION` trace |
| 2 | `src/lib/storefront/playback-chrome-layout-store.js` | **New** — padding / nowPlaying key without React context |
| 3 | `src/hooks/usePlaybackChromeLayout.js` | **New** — `useSyncExternalStore` hook |
| 4 | `src/components/storefront/PlaybackChromeIsland.js` | Commit layout store; remove `PlaybackChromeContext.Provider` |
| 5 | `src/components/storefront/ScrollPaddingShell.js` | `usePlaybackChromeLayout` |
| 6 | `src/components/storefront/HomeStorefrontFlowMode.js` | `nowPlayingKey` from layout store |
| 7 | `src/components/storefront/MobileCartFab.js` | Layout store |
| 8 | `src/components/storefront/PageAuthRefSync.js` | `useLayoutEffect` auth deps only |
| 9 | `src/components/storefront/playback-chrome-context.js` | Thin adapter over layout store |
| 10 | `src/components/home/LatestSinglesStyleRow.js` | `memo(SinglesStyleCard)` |

**Not changed:** signed swap transport path (P3), P11 MP4 keys, `CatalogSurfaceProvider`, cinematic shell, recovery/orchestration.

---

## 5. Trace events (gated)

Enable: `NEXT_PUBLIC_UI_HYDRATION_TRACE=1` or `NEXT_PUBLIC_PLAYBACK_TRACE=1`

| Event | When |
|-------|------|
| `PLAYBACK_FIRST_MUTATION` | First `patchState` in `playTrackInternal` for track load |
| `PLAYBACK_UI_PATCH_SKIPPED` | `patchState` no-op — UI fields unchanged |
| `PLAYBACK_CHROME_LAYOUT_COMMIT` | Layout store padding/nowPlaying key change |
| `STORE_FRONT_REBUILD` | Should **not** appear on play (P9) |
| `MEDIA_CARD_REINITIALIZED` | Mount only, not play burst |

---

## 6. Validation

```bash
npm run build                 # PASS
npm run check:frontend-guardrails  # PASS (0 errors, 3 pre-existing page.js warnings)
```

### Manual pass (home, entitled admin)

1. Cold load — Latest Singles MP4 + gifting icons visible.  
2. Play **Hour Glass** — audio continues; **no** section flash; gifting icons remain; MP4 loops stay mounted.  
3. ~2–3s — possible brief audio buffer (signed swap); **no** storefront rebuild.  
4. Trace: `PLAYBACK_FIRST_MUTATION` once; no `STORE_FRONT_REBUILD`; `PLAYBACK_UI_PATCH_SKIPPED` on redundant ready/playing patches.

---

## 7. Prior audit alignment

| Audit | Relationship |
|-------|----------------|
| P-FORENSIC | `patchState` → `AudioProvider` churn — **addressed** subtree + UI equal |
| P1 | Transport split — **preserved**; extends UI bail-out |
| P2/P3 | Signed swap stall — **unchanged** (element-level) |
| P8/P9 | Post-load wave — **preserved**; P12 covers **playback** window |
| P11/P11B | MP4 integrity — **preserved** |

---

## 8. Files changed (manifest)

```
src/context/AudioContext.js
src/lib/storefront/playback-chrome-layout-store.js
src/hooks/usePlaybackChromeLayout.js
src/components/storefront/PlaybackChromeIsland.js
src/components/storefront/ScrollPaddingShell.js
src/components/storefront/HomeStorefrontFlowMode.js
src/components/storefront/MobileCartFab.js
src/components/storefront/PageAuthRefSync.js
src/components/storefront/playback-chrome-context.js
src/components/home/LatestSinglesStyleRow.js
docs/audits/PHASE_P12_PLAYBACK_TRIGGERED_RECONCILIATION_ELIMINATION.md
```

---

## 9. Deliverables

| Artifact | Path |
|----------|------|
| Report | `docs/audits/PHASE_P12_PLAYBACK_TRIGGERED_RECONCILIATION_ELIMINATION.md` |
| ZIP | `/Users/recharge/Downloads/PHASE_P12_PLAYBACK_TRIGGERED_RECONCILIATION_ELIMINATION.zip` |
| Commit | `Phase P12: eliminate playback-triggered storefront reconciliation` |
