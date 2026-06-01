# Root Cause Ranking — Phase 5B

Scale: **Confidence** = likelihood this explains reported symptoms in production.

---

## Playback stop / death (A1–A9)

| Rank | Root cause | Confidence | Key files/functions |
|------|------------|------------|---------------------|
| **1** | **Audio Visuals scroll handoff** — `handleAudioVisualsFocused` → `pause()` | **88%** | `page.js` L760–762, L408–411 |
| **2** | **Feature modal close** — explicit `pause()` | **85%** (feature path only) | `page.js` L1334–1338 |
| **3** | **`entitlements:updated` → `upgradeToFullStream`** during preview playback | **52%** | `AudioContext.js` L2280–2300, L2178–2278; `notifyEntitlementsUpdated` in `page.js` L1453, `success/page.js` L129 |
| 4 | Stream error / ACCESS_DENIED after entitlement change | **38%** | `onError` L1324–1460; `playTrackInternal` L1802–1816 |
| 5 | Session recovery `setQueue` race (idle session only) | **28%** | `AudioPhase10Bridge.js` L41–65 |
| 6 | Preview 15s hard cap | **25%** (preview-only) | `onTime` L1146–1164 |
| 7 | User pause / media session pause | **20%** | `pauseInternal`, media session handlers |
| 8 | `stopInternal` / media session stop | **10%** | L2684–2718 |
| 9 | Visibility RECOVER failure (iOS) | **15%** | L3088–3103 |
| 10 | AuthProvider remount destroying audio | **<5%** | Disproven — stable layout |

---

## UI refresh / guest→admin flicker (B1–B9)

| Rank | Root cause | Confidence | Key files/functions |
|------|------------|------------|---------------------|
| **1** | **`useEntitlementAccountState` EMPTY → full** when `loading` clears | **78%** | `AuthContext.js` L441–446 |
| **2** | **`page.js` monolith re-render** on auth + 1 Hz countdown | **72%** | `page.js` L636–653, L1078–1092 |
| **3** | **Admin `finalOwnedSlugs` expansion** | **68%** | `api/account/state/route.js` L192–202 |
| 4 | `AppAuthRoot` placeholder → shell | **45%** | `AppAuthRoot.js` L38–44 |
| 5 | Commerce poll multi-refresh | **40%** | `success/page.js`, `subscribe/page.js` |
| 6 | `isAdmin` before `accountStateReady` (gift vs panel) | **58%** | `page.js` L2525 vs `CatalogGrid` L100 |
| 7 | Unmemoized `CatalogGrid` + inline callbacks | **55%** | `CatalogGrid.js` L23+ |
| 8 | Hero parallax DOM mutation | **50%** (feel only) | `page.js` L776–800 |
| 9 | AV iframe lazy mount | **45%** (feel only) | `page.js` L452–462 |
| 10 | Strict Mode double effects | **35%** (dev) | `AuthContext` bootstrap guard |

---

## Combined cross-symptom top 3

| # | Root cause | Primary symptom | Confidence |
|---|------------|-----------------|------------|
| 1 | **AV scroll `pause()`** | Playback stops after modal + scroll | **88%** |
| 2 | **Entitlement EMPTY→full + page re-render** | Locks/gift/admin flicker, "reload" feel | **75%** |
| 3 | **Same session, decoupled mechanisms** | Both visible together | **72%** (correlation B, not A) |

---

## Connection verdict (A / B / C)

| Code | Meaning | Applies? |
|------|---------|----------|
| **A** | Same root cause for stop + flicker | **No** — pause is scroll policy; flicker is React/auth |
| **B** | Same incident, different mechanisms | **Yes** — primary for documented repro |
| **C** | Independent | **Partial** — cold load flicker without scroll stop |

**Selected verdict: B**

---

## Documented negatives (re-verified 2026-05-31)

- `refreshAccountState` does not pause audio  
- `TOKEN_REFRESHED` does not re-fetch entitlements  
- Active session blocks recovery `setQueue`  
- No `AudioProvider` remount on auth  
- Scroll does not call `refreshAccountState`
