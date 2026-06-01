# Playback Interruption Forensic Investigation

**Project:** 2MRRW Artist Platform (`/Users/recharge/artist-platform`)  
**Date:** 2026-05-31  
**Mode:** READ-ONLY — no fixes, refactors, or optimizations  
**Reproduction:** Open release modal → start playback → close modal → scroll → UI visibly refreshes → playback stops  

---

## 1. Executive summary

The **first deterministic playback-stop event** in the primary reproduction path (single/album release modal, not feature modal) is **`handleAudioVisualsFocused` → `pause()`**, fired when the home-page **Audio Visuals** section first enters the viewport during scroll. This is intentional AV-handoff code, not a provider remount or navigation refresh.

The **UI refresh symptoms** (cover art flicker, admin/gift controls, page-rebuild feel) are **symptoms of React re-renders and DOM side effects**, not the playback root cause. They come from: (a) modal-close shell updates, (b) 1 Hz live-countdown state on `page.js`, (c) mobile home scroll-section IO, (d) hero parallax DOM mutation, and (e) Audio Visuals iframe lazy mount — all coinciding with scroll.

**Verdict:** Root cause category **G (other)** — scroll-triggered **audio-focus handoff** in `page.js`. Confidence **High** for playback stop; **Medium–High** for UI refresh attribution.

---

## 2. Reproduction path (code-validated)

| Step | User action | Code path | Playback state |
|------|-------------|-----------|----------------|
| 1 | Open release modal | `openSingleModal` / `openAlbumModal` → `playCanonicalCatalogItem` / `playAlbumTracks` → `playTrack` / `playQueue` (`page.js` L1272–1350, L1196–1204, L1163–1184) | **Working** — single `<audio>` in `AudioProvider` |
| 2 | Start playback | Same gesture or modal controls via `useMediaEngine` → `audio.play()` (`ImmersivePreviewModal.js` L510–514; `AudioContext.js` L3376–3383) | **Working** |
| 3 | Close modal | `closeSingleModal` / `closeAlbumModal` — **no `pause()`** (`page.js` L1368–1377). Feature modal is exception: `closeFeatureModal` calls `pause()` (L1334–1338) | **Continues** for single/album; **stops immediately** for feature modal |
| 4 | Scroll main column | `mainScrollRef` scroll listeners + IO observers (`page.js` L803–839, L408–421, L760–762) | **Stops** when Audio Visuals IO fires (single/album path) |
| 5 | UI refresh visible | Parent `Page()` re-render + catalog subtree repaint (`page.js` L1078–1092, L825–832, L776–800) | Symptom only |

**Modal variant note:** If user opens via **Features** rail (`openFeatureModal`), `closeFeatureModal` invokes `pause()` **before scroll** — first bad event shifts to modal close (L1338).

---

## 3. First bad event

**Primary path (single/album release modal):**

```
IntersectionObserver callback (AudioVisualsSection)
  → triggerFocus() [page.js L383–391, L410–411]
  → onAudioVisualsFocused() [L386–387]
  → handleAudioVisualsFocused() [L760–762]
  → pause() [L761]
  → dispatchPlaybackCommand(PAUSE) [AudioContext.js L2904]
  → pauseInternal() → audioRef.current.pause() [L2557–2559]
  → audio "pause" event → onPause → patchState({ isPlaying: false }) [L1096–1109]
```

**File:line of first bad event:** `src/app/page.js:761` — `if (isPlaying) pause();`

**Alternate path (feature modal):** `src/app/page.js:1338` — `pause();` inside `closeFeatureModal`.

---

## 4. Root cause

**Scroll-triggered global music pause** when the **Audio Visuals** YouTube section enters the viewport. The section implements an intentional handoff: pause site music so the embedded YouTube player can take focus. There is **no auto-resume** when scrolling away (documented in `docs/reports/audio-logic-audit-20260525.md` §E).

This is **not** caused by:
- `router.refresh` / hard navigation
- `AudioProvider` remount
- Session recovery `setQueue` overwrite (guarded when `hasStarted`)
- Entitlement refresh during scroll
- React `key` remount of catalog on scroll

---

## 5. Category (playback state loss taxonomy)

| Code | Meaning | Applies? |
|------|---------|----------|
| A | Audio element destroyed | **No** — `<audio>` persists in `AudioProvider` (`AudioContext.js` L3376–3383) |
| B | Provider remount | **No** — `AudioProvider` in root layout, no `key` prop (`layout.js` L43–57) |
| C | State reset (`stopInternal` / `EMPTY_STATE`) | **No** — `pause()` only; track/time preserved |
| D | Queue replaced | **No** — no `setQueue` on scroll; recovery skipped when active (`AudioPhase10Bridge.js` L41–48) |
| E | Navigation | **No** — no route change in repro |
| F | Recovery race | **No** — mount-only recovery; guards active session |
| **G** | **Other — scroll AV handoff** | **Yes** |

**Category:** **G (other)** — intentional AV-section audio-focus policy.

---

## 6. Exact event chain (modal close → scroll → stop)

See [`event-chain.md`](./event-chain.md) for timestamp-ordered chain with file:line refs.

Summary:

1. **Modal close** — state flags cleared; `useEffect` promotes `nowPlaying` mini-player (`page.js` L1136–1155); `usePlayerBodyState` removes `modalOpen` body class (`usePlayerBodyState.js` L19–20); **audio keeps playing** (single/album).
2. **First scroll tick** — `applyHeroParallax` mutates hero DOM (`page.js` L776–809); optional `setHomeScrollSection` on mobile (`L825–832`).
3. **Audio Visuals IO (first intersect)** — `triggerFocus` once → **`pause()`** (`L408–411`, `L760–762`).
4. **Audio pipeline** — `pauseInternal` → element pause → `onPause` → UI shows paused (`AudioContext.js` L2557–2559, L1096–1109).
5. **Concurrent UI refresh** — 1s `liveCountdown` interval re-renders `Page()` (`page.js` L1078–1092); `CatalogGrid` / `LatestSinglesStyleRow` repaint (unmemoized); `setHasEntered(true)` mounts YouTube iframe (`page.js` L452–462).

---

## 7. UI refresh symptoms (cover art, admin, gift button)

These are **re-render / repaint artifacts**, not separate root causes for playback stop.

| Symptom | Mechanism | File:line | Tied to playback stop? |
|---------|-----------|-----------|------------------------|
| Cover art flash | `Page()` re-render every 1s (`liveCountdown`); `AmbientPlaybackBackground` opacity transitions; hero parallax | `page.js` L1078–1092, L1865–1871, L776–800 | No — coincident |
| Admin / gift controls flicker | `CatalogGrid` not memoized; receives fresh inline `onLibraryChange` lambdas each render; `isAdmin` / `accountState` props unchanged but subtree repaints | `CatalogGrid.js` L23–100; `page.js` L2103 | No |
| Page rebuild feel | Hero parallax + Audio Visuals iframe lazy mount (`hasEntered`) + optional `fadeInTab` animation only on `tabKey` change (not scroll) | `page.js` L452–462, L1957 | No |
| Mini player appears | Modal-close effect sets `nowPlaying` when modals close | `page.js` L1136–1150 | No — expected UX |
| Mobile nav highlight shift | `setHomeScrollSection` from vault/cards/shows IO | `page.js` L825–832, L1627–1633 | No |

Prior audit finding (AudioVisuals pause on IO) **confirmed** with current line numbers (was ~595–597 in May 25 audit; now L760–762 / L408–417).

---

## 8. Suspect area verdicts (7 areas)

Full matrix: [`suspect-matrix.md`](./suspect-matrix.md)

| # | Area | Verdict | Confidence |
|---|------|---------|------------|
| 1 | Navigation/Refresh | **Ruled out** for this repro | High |
| 2 | AudioProvider remount | **Ruled out** | High |
| 3 | Queue overwrite | **Ruled out** during repro | High |
| 4 | React key remounts | **Partial** — `tabKey` remounts tab content on tab switch only, not scroll | High |
| 5 | Account/entitlement refresh | **Ruled out** during scroll/modal close | High |
| 6 | Scroll systems | **Confirmed** — AudioVisuals IO + secondary re-render churn | High |
| 7 | Playback state loss | **Category G** — user-initiated-policy pause via scroll IO | High |

---

## 9. Ruled out causes

- **`router.refresh`** — only `verify-otp/page.js` L124; not in home modal flow.
- **`window.location` / reload** — not triggered by modal close or scroll on home.
- **`refreshAccountState` / `entitlements:updated`** — no listeners on scroll; not called by modal dismiss handlers (only by explicit library-change callbacks).
- **Session recovery `setQueue`** — `AudioPhase10Bridge` skips when `hasStarted || queue.length > 0` (L41–48).
- **`stopInternal` / src removal** — not invoked by pause path.
- **Provider remount** — `AudioProvider` stable in `layout.js`; no conditional mount.

---

## 10. Secondary / contributing factors

| Factor | Effect | Severity |
|--------|--------|----------|
| `page.js` 61× `useState` + 1 Hz countdown | Whole-page re-render during scroll makes refresh **more visible** | Medium (UI only) |
| `closeFeatureModal` calls `pause()` | Feature-modal path stops **on close**, not scroll | Medium (path-dependent) |
| Unmemoized `CatalogGrid` + unstable callback props | Admin/gift UI repaints on any parent render | Low–Medium (UI only) |
| Prior audit RC-2 (auth churn) | Could amplify refresh if entitlement poll coincides; **not triggered by scroll** | Low for this repro |

---

## 11. Confidence assessment

| Finding | Confidence | Basis |
|---------|------------|-------|
| First bad event = AudioVisuals IO → `pause()` (single/album modal) | **High** | Direct code path; matches prior audit; deterministic IO threshold |
| UI refresh = re-render churn, not navigation/remount | **Medium–High** | Code paths identified; exact visual timing device-dependent |
| Navigation/refresh ruled out | **High** | Grep inventory + route-refresh audit |
| Provider remount ruled out | **High** | Layout structure |
| Queue/recovery ruled out | **High** | Active-session guard in bridge |
| Feature-modal alternate path (pause on close) | **High** | Explicit `pause()` in `closeFeatureModal` |

**Overall root cause confidence:** **High** (playback stop)  
**Overall UI refresh attribution confidence:** **Medium–High**

---

## Deliverables

| File | Purpose |
|------|---------|
| `report.md` | This document (11 items) |
| `event-chain.md` | Ordered chain with file:line refs |
| `suspect-matrix.md` | 7-area investigation matrix |
| `manifest.txt` | File index |

**Zip:** `/Users/recharge/Downloads/playback-interruption-forensic-20260531.zip`
