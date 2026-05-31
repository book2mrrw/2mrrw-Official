# Initialization Audit — Hydration, Auth, Playback Controls

**Phase:** 5.2.4  
**Date:** 2026-05-31

---

## Provider tree (mount order)

```
html/body
  PostHogInit
  AuthProvider          ← supabase bootstrap, loading=true initially
    AppAuthRoot         ← hydration gate (blocks ALL descendants until client hydrated)
      AuthGateProvider
        AudioProvider   ← single <audio>, playback command queue
          SessionRecoveryRoot  ← async recovery on mount (no UI block)
            StripeProvider
              page.js (2873 lines, "use client")
              GlobalAudioPlayerBar
```

**Files:** `src/app/layout.js`, `src/components/auth/AppAuthRoot.js`, `src/context/AuthContext.js`, `src/context/AudioContext.js`.

---

## Boot timeline

| Phase | What runs | Blocks playback UI? |
|-------|-----------|---------------------|
| SSR | `AppAuthRoot` renders `BOOT_PLACEHOLDER` (empty dark screen) | **Yes** — children not mounted |
| First client paint | `useEffect` → `setHydrated(true)` | **Yes** until effect runs (~1 frame+) |
| Post-hydration | Full `page.js` + `AudioProvider` + `GlobalAudioPlayerBar` mount | Shell visible |
| Auth bootstrap | Dynamic `createClient`, `getSession`, optional `setSession` from localStorage, `refreshAccountState` or `refreshGuest` | **No full-page block**; `loading` → false in `finally` |
| Auth gate overlay | If `authStatus === "unauthenticated"` → `AuthGate` modal over shell | Blocks **interaction** with shell, not provider mount |
| Session recovery | `useSessionRecovery` fetches hydrate + signed URL refresh, dispatches `2mrrw:playback-recovery` | **Does not** gate `SessionRecoveryRoot` children (`isRecovering` unused in layout) |

### AppAuthRoot — critical for issue #2

```36:38:src/components/auth/AppAuthRoot.js
  if (!hydrated) {
    return BOOT_PLACEHOLDER;
  }
```

Until `hydrated`, **`AudioProvider` and `GlobalAudioPlayerBar` do not exist in the DOM.** Any tap during that window cannot reach playback code. Duration is typically one React commit after JS loads, but on slow devices parsing **~2873-line `page.js`** it can align with “controls dead until init.”

**Design intent (comment):** show placeholder on SSR; after hydration, mount cinematic shell while auth resolves. Tradeoff: brief total UI absence vs flash of unauthenticated content.

---

## AuthProvider — does it block play?

| Signal | Behavior | Blocks `playTrack`? |
|--------|----------|---------------------|
| `loading` / `authStatus: "loading"` | Guest/account fetch in flight | **No** direct guard on `playTrack` |
| `authLoading` in AudioContext | Skips `entitlements:updated` upgrade; defers **server mediaProgress** restore | **No** on initial tap |
| `onAuthStateChange` | `TOKEN_REFRESHED` / `INITIAL_SESSION` → **return early** (no refresh storm) | No reload |
| `SIGNED_IN` | `applySessionUser` only if **different** `user.id` | Re-render, not navigation |
| `enterGuest` | May `window.location.href = postAuthRedirect` | **Full navigation** (expected) |

Account state fetch: `GET /api/account/state` during bootstrap — competes for network with first tap but does not serialize behind a playback mutex.

---

## page.js init load

| Work | Effect on first interaction |
|------|------------------------------|
| Monolithic client bundle (~2873 lines) + framer-motion, stripe, many `dynamic()` modals | Long **parse/compile/hydrate** on mobile |
| Catalog `useEffect` fetch (`/api/catalog/...`) | Network contention |
| Home tab image preload (`imagePipeline.preload`, high priority) | Bandwidth contention with first audio byte |
| Deep link `useEffect` depends on `authLoading` | Deferred modal open until auth settles |
| `accountStateReady = !authLoading` | Gates **conversion UI**, not audio bar |

**No `authLoading` check** on play handlers in static grep — playback hooks call `useAudio()` regardless.

---

## Playback controls — actual gates

| Mechanism | Symptom | Severity |
|-----------|---------|----------|
| **AppAuthRoot `!hydrated`** | No player, no audio element | High for “instant tap on load” |
| **Serial command queue** | Pause/toggle/play queue behind in-flight `playTrack` | Medium during long `waitAudioSrcReady` |
| **AuthGate overlay** | Clicks hit OTP modal when `authStatus === "unauthenticated"` | Expected for guests without session |
| **Guest join modal** (page-level) | Separate from AuthGate; can block preview taps | UX (Phase 5.2.2 browser note) |
| `PlayerControlButton` `disabled` prop | Per-button only; not wired to `authLoading` globally | Low |

`playTrack` always enqueues:

```2601:2607:src/context/AudioContext.js
  const playTrack = useCallback((track, options = {}) => {
    perfMark(MARKS.PLAYBACK_TAP);
    return dispatchPlaybackCommand(
      PLAYBACK_COMMANDS.PLAY_TRACK,
      { track, options },
      { serial: true, cancelActiveStream: true }
    );
```

---

## Hydration marks

`performanceMarks.js` defines `HYDRATION_START` / `HYDRATION_END` but **no producer** found in `page.js` or layout for this audit — marks unused for measurement.

---

## Verdict (issue #2)

| User report | Finding |
|-------------|---------|
| Controls not responding until page init | **Confirmed partially:** `AppAuthRoot` prevents any playback subtree until hydration; heavy `page.js` extends time-to-interactive; serial queue defers control commands during active load |
| Auth loading blocks play | **Not confirmed** as hard block — play API is callable; entitlement restore waits for `!authLoading` only for resume position from server |

**Recommended next phase (init):** measure TTI + first `playTrack` acceptance with Performance API; consider mounting `AudioProvider` above `AppAuthRoot` or slim boot placeholder without unmounting audio (explicit scope change — not in 5.2.4).
