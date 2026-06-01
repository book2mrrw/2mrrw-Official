# Playback Death Audit (A1–A9)

**Project:** `/Users/recharge/artist-platform`  
**Date:** 2026-05-31  
**Mode:** READ-ONLY Phase 5B — re-verified via grep/read + Phase 5A / interruption forensic

---

## A1 — AudioProvider → audioRef → element ownership

| Item | Finding |
|------|---------|
| Provider mount | `AudioProvider` in `src/app/layout.js` L43–57 — **no `key`**, wraps `AppAuthRoot` + children |
| Element | Single `<audio ref={audioRef}>` rendered inside provider JSX `src/context/AudioContext.js` L3372–3383 |
| Ref lifecycle | `audioRef = useRef(null)` L526; React attaches on mount — **no destroy/recreate** on auth or route change |
| Recreate paths | **None** in production layout. Effect cleanup L1559–1581 removes **listeners only**, not the element |
| `stopInternal` | L2684–2718: `audio.removeAttribute("src"); audio.load()` — **clears src** but same DOM node |
| Unlock gesture | `unlockAudioFromGesture` L1645–1655 may `play()` then `pause()` once for Safari unlock — not user-visible stop |

**Verdict:** Element ownership is stable. Playback death is **state/command driven**, not element remount.

---

## A2 — Audio event handler inventory

See `AUDIO_EVENT_MAP.md` (complete table).

---

## A3 — Pause / stop / setQueue / clear paths

See `PLAYBACK_STOP_COMMANDS.md`.

---

## A4 — Stream swap / upgrade / retry / preview fallback

See `STREAM_SWAP_AUDIT.md`.

---

## A5 — Recovery queue overwrite

See `RECOVERY_AUDIT.md`.

---

## A6 — Lifecycle (visibility / pagehide / blur / focus)

| Handler | Location | On hide | On show |
|---------|----------|---------|---------|
| `visibilitychange` | `AudioContext.js` L3039–3162 | Saves position; may prefetch stream URL refresh (no pause) | `syncPlaybackUiFromAudioElement` → optional `RECOVER` command |
| `pagehide` | L3138–3150 | Saves position only | — |
| `pageshow` | L3114–3125 | — | Rehydrates media session metadata |
| `beforeunload` | L3127–3136 | Persists media session track | — |
| `window.online` | L1528–1537, L1350–1362 | — | Retries play or `retryStreamPlayback` |
| `devicechange` | L1540–1556 | — | Logs only |
| `page.js` `visibilitychange` | `page.js` L1002–1007 | Ambient audio pause (not global player) | — |
| `useSyncEngine` | `src/hooks/sync/useSyncEngine.js` L67–101 | `focus` / `visibility` resync | Not audio pause |

**No `blur`/`focus` on global `<audio>`** in AudioContext.

---

## A7 — Scroll repro (play → close modal → scroll → stop)

See `SCROLL_TRACE.md`.

**Reachable first bad event (single/album modal):** `page.js` L760–762 → `pause()`.

---

## A8 — Evidence-backed last-event timeline before silence

Typical single/album modal + scroll path (dev: filter `[state-churn]`, `[playback-resilience]`):

| Order | Event | Evidence |
|-------|-------|----------|
| T0 | `play` / `playing` on `<audio>` | `onPlay` L1077–1093 |
| T1 | Modal close — **no** `pause` | `closeSingleModal` L1368–1372 |
| T2 | `timeupdate` continues | L1139+ |
| T3 | Scroll → `liveCountdown` tick (optional) | `page.js` L1078–1092 — UI only |
| T4 | IO `triggerFocus` → `handleAudioVisualsFocused` | `page.js` L408–411, L760–762 |
| T5 | `dispatchPlaybackCommand(PAUSE)` | `AudioContext.js` L2904 |
| T6 | `pause` event → `onPause` → `isPlaying: false` | L1096–1109 |

**Not observed on this path before T4:** `recovery-setQueue`, `upgradeToFullStream`, `stopInternal`, `refreshAccountState`.

---

## A9 — Root cause ranking (playback stop)

See `ROOT_CAUSE_RANKING.md` §Playback.

**Summary top 3:**

1. **Scroll Audio Visuals handoff** — `page.js` L761 `pause()` — **High (88%)** for documented repro  
2. **Feature modal close** — `closeFeatureModal` L1338 — **High (85%)** for feature path only  
3. **`entitlements:updated` → `upgradeToFullStream`** during preview play — **Medium (52%)** for checkout/success return, not scroll  

---

## Ruled out (re-verified)

- `AudioProvider` remount on auth — layout structure  
- `refreshAccountState` calling `pause` — no audio APIs in `AuthContext.js`  
- Session recovery `setQueue` during active play — `AudioPhase10Bridge.js` L41–48 guard  
- `router.refresh` on home scroll/modal — not in chain  
