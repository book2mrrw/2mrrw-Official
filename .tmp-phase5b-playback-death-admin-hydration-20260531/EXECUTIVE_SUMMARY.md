# Executive Summary — Phase 5B Playback Death + Admin Hydration

**Date:** 2026-05-31 | **Mode:** READ-ONLY | **Builds on:** Phase 5A, playback interruption forensic, auth reload audits

---

## One-liner

**Playback stops** because home scroll intentionally calls `pause()` when Audio Visuals enters view (`page.js:761`), not because auth remounts audio; **guest→admin flicker** is the entitlement snapshot flipping from EMPTY to full while `page.js` re-renders every second—same session, **different mechanisms (verdict B)**.

---

## Why playback stops

| Finding | Confidence |
|---------|--------------|
| Primary repro: `IntersectionObserver` → `handleAudioVisualsFocused` → `pause()` | **88%** |
| Alternate: `closeFeatureModal` calls `pause()` before scroll | **85%** (feature path) |
| Stream upgrade on checkout: `notifyEntitlementsUpdated` → `upgradeToFullStream` | **52%** (commerce return, not scroll) |
| Auth hydration / `refreshAccountState` | **<10%** for stop |

**Exact first bad event (single/album modal):** `src/app/page.js:761`  
**Chain:** `pause()` → `dispatchPlaybackCommand(PAUSE)` → `pauseInternal` → `audio.pause()` → `onPause` → `isPlaying: false`

**Element:** Single persistent `<audio>` in `AudioProvider` (`layout.js` + `AudioContext.js:3376–3383`) — **not destroyed** on stop.

---

## Why guest/admin UI flickers

| Finding | Confidence |
|---------|--------------|
| `useEntitlementAccountState` returns EMPTY while `loading` then full catalog access | **78%** |
| `page.js` re-renders on auth + 1 Hz `liveCountdown` | **72%** |
| Admin gets all digital `ownedSlugs` from `/api/account/state` | **68%** |
| Gift uses `isAdmin`; collector panel waits `accountStateReady` | **58%** mismatch window |

**Exact files:** `AuthContext.js` (`applyAccountPayload`, `useEntitlementAccountState`), `api/account/state/route.js` L192–202, `page.js` L636–640, L1078–1092, `CatalogGrid.js` L31–100

---

## Connected?

| Verdict | Label | Explanation |
|---------|-------|-------------|
| ~~A~~ | Same root cause | **Rejected** — pause is AV policy; flicker is React/entitlements |
| **B** | **Same incident, different mechanisms** | **Selected** — scroll stops audio; hydration/countdown/catalog repaint creates "refresh" at same time |
| C | Independent | Cold load: flicker without scroll stop; scroll stop without login |

**Confidence verdict B:** **72%**

---

## Top 3 playback (with files)

1. `page.js` — `handleAudioVisualsFocused` / `AudioVisualsSection` IO  
2. `page.js` — `closeFeatureModal`  
3. `AudioContext.js` — `upgradeToFullStream` + `entitlements:updated` listener  

## Top 3 hydration (with files)

1. `AuthContext.js` — `useEntitlementAccountState`, `applyAccountPayload`  
2. `page.js` — monolith + `liveCountdown`  
3. `api/account/state/route.js` — admin `finalOwnedSlugs`  

---

## Recommended next steps (audit only — not implemented)

1. Product decision: AV handoff vs continue music under scroll  
2. Gate gift overlay on `accountStateReady` like collector panel  
3. Memoize `CatalogGrid` / stabilize `onLibraryChange` to cut repaint  
4. Dev: correlate `[state-churn]` with `[playback-resilience]` on repro  

---

## Deliverables

All files under `.tmp-phase5b-playback-death-admin-hydration-20260531/` — see `MANIFEST.txt`.

**Zip:** `/Users/recharge/Downloads/phase5b-playback-death-admin-hydration-20260531.zip`
