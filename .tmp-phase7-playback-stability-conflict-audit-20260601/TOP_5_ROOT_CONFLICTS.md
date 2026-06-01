# Top 5 Root Conflicts — Phase 7

**HEAD:** `34df134` | Ranked by production impact × confidence

Viewport Phase 6B behavior is **excluded as a defect**; conflicts below are **interactions** with other systems.

---

## #1 — Viewport transport bypasses serial command queue

**One-liner:** `exitAudioVisualViewport` resumes via direct `resumeInternal` while `playTrackInternal` / queued commands may still own `activeStreamAbortRef`, causing abort races and silent no-resume.

| Attribute | Detail |
|-----------|--------|
| **Confidence** | **82%** for scroll-related “music died and didn’t come back” |
| **Severity** | High |
| **Files** | `AudioContext.js` — `resumeFromViewport` L2877–2899, `exitAudioVisualViewport` L2923–2935, `dispatchPlaybackCommand` L3025–3120, `playTrackInternal` L1741–1750 |
| **Mechanism** | User/API actions use `commandQueueRef` serialization; viewport uses `void resumeFromViewport()` outside queue. Overlapping `waitAudioSrcReady` / abort / `resumeInternal` stream refresh (L2749+) can leave element paused while React thinks recovery ran. |
| **Repro hint** | Play track → scroll into Audio Visuals (pause) → scroll out quickly → or scroll out during catalog load / entitlement update. |
| **Not a 6B bug** | Pause-on-enter is intentional; conflict is **dual control planes**. |

---

## #2 — Competing resume: viewport vs visibility `RECOVER` vs `onPause` interrupt healer

**One-liner:** Three unpause paths (`resumeFromViewport`, `dispatchPlaybackCommand(RECOVER)`, `onPause` `canplay` auto-play) lack mutual exclusion.

| Attribute | Detail |
|-----------|--------|
| **Confidence** | **68%** for iOS background/foreground + AV scroll combos |
| **Severity** | High |
| **Files** | `AudioContext.js` — `onPause` L1151–1217, `onVisibility` L3349–3368, `resumeFromViewport` L2877+ |
| **Mechanism** | Visibility return dispatches **queued** RECOVER; viewport uses **direct** resume; non-user pause installs `canplay` listener that calls `audio.play()` if `stateRef.isPlaying` still true. |
| **Symptom** | Stutter, double-play attempt, or `INTERRUPTION_RESUME_FAILED` / `VISIBILITY_RECOVER_BLOCKED` diagnostics. |

---

## #3 — `entitlements:updated` → `upgradeToFullStream` during active preview playback

**One-liner:** Checkout or `notifyEntitlementsUpdated` swaps stream URL mid-play, overlapping viewport pause and queue work.

| Attribute | Detail |
|-----------|--------|
| **Confidence** | **58%** on post-purchase / admin hydration paths |
| **Severity** | Medium–High |
| **Files** | `AudioContext.js` L2379–2405, `upgradeToFullStream`; `state-churn-log.js` `notifyEntitlementsUpdated`; `page.js` L1547; `success/page.js` L129 |
| **Mechanism** | Preview playing + `meta.previewOnly` → full stream resolve replaces `audio.src` (may `pause` + `waitAudioSrcReady`). |
| **Symptom** | Brief stop, preview_fallback flash, or access error if upgrade races auth. |
| **Note** | `refreshAccountState` alone does not pause (still true). |

---

## #4 — `page.js` `nowPlaying` shadow state vs AudioContext

**One-liner:** Mini player uses independent `nowPlaying` plus slug match gate, so UI can show stale track or wrong playing glyph while audio state differs.

| Attribute | Detail |
|-----------|--------|
| **Confidence** | **65%** for UI-only bug reports |
| **Severity** | Medium (UX / trust, rarely kills audio alone) |
| **Files** | `page.js` L751, L1230–1249, L1397, L1491–1493, L1479–1482 |
| **Mechanism** | `openFeatureModal` clears `nowPlaying` then starts playback; modals gate `shouldShowNowPlaying`; `miniPlayerPlaying` requires slug match **and** `isPlaying`. |
| **Symptom** | “Bar says playing but silent” or opposite — often actually viewport pause (#1) plus visible bar. |

---

## #5 — Auth bootstrap flips entitlement SOT + rebinds audio event listeners

**One-liner:** `authLoading` transition re-attaches all `<audio>` listeners and swaps `useEntitlementAccountState` from EMPTY to full, correlating with spurious interruption classification B/D.

| Attribute | Detail |
|-----------|--------|
| **Confidence** | **55%** for first-load / guest→subscriber session |
| **Severity** | Medium |
| **Files** | `AuthContext.js` L441–446; `AudioContext.js` listener effect L1060–1680 (`authLoading` dep L1678); `playTrackInternal` entitlement progress L2012+ |
| **Mechanism** | Not a remount of AudioProvider, but listener teardown + entitlement-driven play metadata change + page monolith re-render. |
| **Symptom** | “Reload feel”, lock flicker, occasional pause during hydrate (usually stream/upgrade, not explicit pause). |

---

## Honorable mention (not top 5)

| Item | Why lower |
|------|-----------|
| Orphan `focus-controller.js` | Zero runtime imports — cleanup only |
| Session recovery race | Guarded by `AudioPhase10Bridge` skip — low if guard holds |
| `tabKey` remount | Visual reload only |
| Feature modal `pause()` on close | Explicit user path — not conflict |

---

## Recommended investigation order (ops)

1. Repro with `NEXT_PUBLIC_PLAYBACK_TRACE=1` — correlate `pauseForViewport` / `resumeInternal` / `stream:*` / `upgradeToFullStream`.
2. Confirm whether failure is **no resume** (#1–2) vs **UI only** (#4).
3. Correlate with `entitlements:updated` timestamp (#3).
4. Check `PLAYBACK INTERRUPTION CLASSIFICATION` bucket A vs B vs C.

---

## Top conflict one-liner (executive)

**Viewport resume and visibility/command-queue resume both drive the same `<audio>` element without a single mutex, so scroll through Audio Visuals during stream or entitlement work can abort in-flight playback and skip auto-resume.**
