# Recommended Fixes (ordered, production-safe)

**Audit only — do not implement from this doc unless explicitly requested.** Each item is minimal-risk and scoped.

## P0 — Verify deployed + mobile DevTools (no code)

1. Confirm production deployment includes `SUPABASE_AUTH_STORAGE_KEY` on client **and** server/middleware (`auth-storage-key.js`).
2. On failing mobile device: Network tab for `/api/library/stream` — note **401 vs 403 vs 302/200**.
3. Application → Cookies on `www.2mrrw.com`: `2mrrw-auth-token.*` and absence of stale `guest_session` after OTP login.
4. Compare `/api/account/state` JSON: `permissions.admin`, `permissions.subscriber`, `user.isGuest`.

## P1 — Highest impact code fixes (when approved)

### 1. Never call `playTrack` from auth `useEffect` without user gesture

**Problem:** `page.js:970-990` breaks iOS autoplay policy.  
**Safe approach:** On `authLoading` completion, set UI “Tap to play” in modal OR call `playTrack` only from explicit modal play button (same handler as card).  
**Files:** `page.js:1121-1126`, `970-990`.

### 2. Fix `playAudioIfNotPaused` logic

**Problem:** Returns when `audio.paused` (`AudioContext.js:123-124`), opposite of intent.  
**Safe fix:** `if (!audio.paused) return;` then `await audio.play()`, or rename and use `if (stateRef.current.isPlaying && audio.paused) await audio.play()`.  
**Files:** `AudioContext.js:123-131`, callers `1308`, `1624`, `1903`.

### 3. Shared `unlockAudioFromGesture()` for `resume` / visibility

**Problem:** Only `playTrack` runs sync unlock (`1137-1146`).  
**Safe approach:** Extract 5-line unlock; call from `resume`, `toggle`, and optionally visibility resume (with user tap fallback if rejected).  
**Files:** `AudioContext.js:1137-1146`, `1862-1872`, `2110-2125`.

### 4. Web Audio: fail-open or defer graph until CORS-safe

**Options (pick one):**

- **A.** Defer `initWebAudio()` until `audio.currentSrc` is same-origin OR probe `audio.crossOrigin` + successful play without graph.
- **B.** On `initWebAudio` catch / silent detection, disconnect graph and route element directly (bass/space modes disabled).
- **C.** Verify R2 signed responses include `Access-Control-Allow-Origin: https://www.2mrrw.com` (infra).

**Files:** `AudioContext.js:515-544`, `2367`; R2 CORS config.

## P2 — Session / entitlement hardening

### 5. Block background stream fetch when `!canStream`

**Problem:** Preview path sets `backgroundStreamResolve = true` even for guests (`1214-1216`), causing 401 console noise and error handlers.  
**Safe fix:** Only background-resolve when `entitledFullStream`.

### 6. Ensure fan login clears `guest_session` before first `playTrack`

Already partially in tree (`AuthContext.js:181`). Verify `account/state` response clears cookie server-side (`account/state/route.js` + `guest-session.js`).

### 7. Canonical host enforcement

Document/sign-in only on `https://www.2mrrw.com` to avoid apex cookie loss (stream-session audit).

## P3 — UX polish (mobile)

### 8. Global bar: immediate play on single tap

Reduce or bypass `DOUBLE_TAP_MS` delay for play affordance (`GlobalAudioPlayerBar.js:453-515`).

### 9. Modal explicit play control

`ImmersivePreviewModal` uses `toggle` only — add first-play button wired to `playTrack` in touch handler if parent did not start audio.

## P4 — Observability

### 10. Client log stream outcomes

Extend `logPlayback` / stream-client telemetry with `{ status, code, slug, hasCookiesHint }` (no PII).

### 11. Server stream 401 diagnostics

Optional response header `X-Stream-Auth: fan|guest|none` for support (internal).

## Do NOT do (guardrails)

- No UI redesign of cinematic shell.
- No dependency bumps.
- No client-side entitlement overrides (`music-access` must follow `/api/account/state`).
- No second `<audio>` element for mobile.

## Suggested verification order after fixes

1. iOS Safari private: guest preview plays (30s).
2. iOS Safari: subscriber OTP — full stream, no 401 on stream.
3. iOS Safari: admin — no pricing, full stream.
4. Android Chrome: same three.
5. App background/foreground: audio continues or shows tap-to-resume (acceptable).
