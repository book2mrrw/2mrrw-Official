# Suspect Matrix — 7 Investigation Areas

**Reproduction:** Release modal → playback → close modal → scroll → UI refresh + playback stop  
**Date:** 2026-05-31  

Legend: ✅ Confirmed cause · ⚠️ Contributing · ❌ Ruled out · 🔀 Path-dependent  

---

## 1. Navigation / Refresh

**Search:** `router.refresh|push|replace`, `window.location`, `assign`, `reload`

| Signal | Location | During repro? | Playback impact | Verdict |
|--------|----------|---------------|-----------------|---------|
| `router.refresh()` | `verify-otp/page.js` L124 only | No | Soft RSC refresh | ❌ |
| `router.push/replace` | auth/deep-link routes | No | Route change | ❌ |
| `window.location.assign` | `page.js` L1560 (cards tab), L1952 (subscribe) | No — tab switch only | Hard nav | ❌ |
| `window.history.replaceState` | `page.js` L1603, L1654 | No — URL cleanup on mount | None | ❌ |
| `enterGuest` hard redirect | `AuthContext.js` L329 | No | Full unload | ❌ |

**Conclusion:** ❌ **Ruled out** — no navigation or refresh in modal-close → scroll path.  
**Confidence:** High  

---

## 2. AudioProvider remount

**Mount chain:** `layout.js` → `AuthProvider` → `AudioProvider` → `AppAuthRoot` → `{children}` + `GlobalAudioPlayerBar`

| Path | Evidence | During repro? | Verdict |
|------|----------|---------------|---------|
| Layout remount | `AudioProvider` unconditional, no `key` | No | ❌ |
| Auth-driven remount | Auth state updates re-render provider, **do not unmount** | Possible background, not scroll-triggered | ❌ for stop |
| Page remount | `page.js` is child; re-render ≠ provider remount | Re-render yes, remount no | ❌ |
| `<audio>` destroy | Only `stopInternal` removes src (`AudioContext.js` L2698–2702) | Not called | ❌ |

**Conclusion:** ❌ **Ruled out** — single audio element survives; pause ≠ destroy.  
**Confidence:** High  

---

## 3. Queue overwrite

**Search:** `setQueue`, `2mrrw:playback-recovery`, `useSessionRecovery`

| Source | File:line | Trigger | Guard | During repro? |
|--------|-----------|---------|-------|---------------|
| `setQueue` | `AudioContext.js` L2444–2456 | playQueue, manual | — | No on scroll |
| Session recovery dispatch | `useSessionRecovery.js` L61–64 | Mount once | — | No mid-session |
| Recovery handler | `AudioPhase10Bridge.js` L36–65 | Event listener | Skips if `hasStarted \|\| queue.length > 0` (L41–48) | ❌ |
| `logStateChurn("recovery-setQueue")` | `AudioPhase10Bridge.js` L42–47 | Skipped path | Active session | ❌ |

**Conclusion:** ❌ **Ruled out** — active playback session blocks recovery overwrite.  
**Confidence:** High  

---

## 4. React key remounts

**Search:** `key={` on scroll/modal/entitlement surfaces

| Key | File:line | Changes on scroll? | Changes on modal close? | Impact |
|-----|-----------|---------------------|-------------------------|--------|
| `tabKey` wrapper | `page.js` L1957 | No — only `switchTab` / `switchMusicSubTab` (L1566, L1640) | No | Remount on tab switch only |
| `selectedAlbum.slug` album modal | `page.js` L1788 | No | On album change | Modal only |
| `featuredId` YouTube iframe | `page.js` L454, L532 | No — on video select | No | AV section only |
| `currentSingle.slug` carousel | `CarouselUI.js` L31, L58 | No — on carousel nav | No | Singles hero only |
| Catalog card keys | `item.slug` stable | No | No | ❌ |

**Conclusion:** ❌ **Ruled out for scroll** — no catalog `key` churn on scroll. ⚠️ `tabKey` causes full tab fade-in on **tab switch**, not this repro.  
**Confidence:** High  

---

## 5. Account / entitlement refresh

**Search:** `refreshAccountState`, `refreshLibrary`, `entitlements:updated`

| Trigger | File:line | Fires on modal close? | Fires on scroll? |
|---------|-----------|----------------------|------------------|
| Modal dismiss handlers | `closeSingleModal` L1368–1372, `closeAlbumModal` L1374–1377 | **No** | No |
| `handlePreviewLibraryChange` | `page.js` L1406–1409 | Only explicit library action in modal | No |
| `entitlements:updated` listener | `AudioContext.js` L2280–2305 | No | No — calls `upgradeToFullStream`, not pause |
| Inline `onLibraryChange` lambdas | `page.js` pass-through to grids | User action only | No |
| Auth polling | success/subscribe pages | Not on home scroll | No |

**Conclusion:** ❌ **Ruled out** — entitlement refresh does not fire in repro chain.  
**Confidence:** High  

---

## 6. Scroll systems

**Search:** IntersectionObserver, scroll listeners, lazy load, hydration, animations

| System | File:line | Fires on scroll? | Stops playback? | UI refresh? |
|--------|-----------|------------------|-----------------|-------------|
| **AudioVisualsSection IO** | `page.js` L408–421, L760–762 | ✅ First intersect | **✅ `pause()`** | ⚠️ iframe mount |
| Home vault/cards/shows IO | `page.js` L825–839 | ✅ | No | ⚠️ `setHomeScrollSection` |
| Hero parallax | `page.js` L776–809 | ✅ | No | ⚠️ DOM mutation |
| Singles row carousel IO | `page.js` L987–994 | Horizontal row only | No (pauses carousel `<video>`) | Minor |
| `usePlaybackCardPrewarm` IO | `usePlaybackCardPrewarm.js` L51–66 | Card enter | No — memory warm only | No |
| `liveCountdown` interval | `page.js` L1078–1092 | Time-based | No | ⚠️ Full page re-render 1 Hz |
| Catalog fetch | `page.js` L845–919 | No — page state | No | On load only |

**Conclusion:** ✅ **Confirmed** — AudioVisuals IO is playback stop; other scroll systems explain UI refresh.  
**Confidence:** High (stop), Medium–High (UI)  

---

## 7. Playback state loss (taxonomy A–G)

| Code | Hypothesis | Evidence | Verdict |
|------|------------|----------|---------|
| A | Audio destroyed | `<audio>` in provider; pause retains src | ❌ |
| B | Provider remount | Stable layout mount | ❌ |
| C | State reset | `pause()` not `stopInternal` | ❌ |
| D | Queue replaced | Recovery guard active | ❌ |
| E | Navigation | No route change | ❌ |
| F | Recovery race | Mount-only + skip active | ❌ |
| **G** | **Other — AV handoff** | `handleAudioVisualsFocused` → `pause()` | **✅** |

**Alternate G2 (feature modal):** `closeFeatureModal` → `pause()` — 🔀 path-dependent.

**Conclusion:** **G** — scroll-triggered AV audio-focus policy.  
**Confidence:** High  

---

## Summary table

| # | Area | Result | Confidence |
|---|------|--------|------------|
| 1 | Navigation/Refresh | ❌ Ruled out | High |
| 2 | AudioProvider remount | ❌ Ruled out | High |
| 3 | Queue overwrite | ❌ Ruled out | High |
| 4 | React key remounts | ❌ Ruled out (scroll) | High |
| 5 | Account/entitlement refresh | ❌ Ruled out | High |
| 6 | Scroll systems | ✅ Root cause + UI contributors | High |
| 7 | Playback state loss | ✅ Category G | High |

---

## Prior audit cross-check

| Prior finding | Source | This investigation |
|---------------|--------|-------------------|
| AudioVisuals pause on IO | `docs/reports/audio-logic-audit-20260525.md` §E | **Verified** — lines shifted to L760–762 / L408–417 |
| page.js monolith re-render churn | `.tmp-playback-stability-churn-audit-20260531` RC-2 | **Confirms UI refresh symptom**, not playback stop |
| Session recovery setQueue | RC-4 | **Ruled out** mid-session via bridge guard |
| No router.refresh on home | route-refresh-inventory | **Confirmed** |
