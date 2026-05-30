# Phase 6 — Auth / Session Continuity During Playback

## Auth boot sequence

**File:** `src/context/AuthContext.js:164-244`

1. `supabase.auth.getSession()` (+ localStorage fallback `2mrrw-auth-token`)
2. If real user → `refreshAccountState()`
3. Else → `refreshGuest()` → may chain `refreshAccountState()`
4. Subscribe `onAuthStateChange`:
   - `SIGNED_OUT` → clear all state (no AudioContext stop)
   - `SIGNED_IN` → `applySessionUser` → `refreshAccountState`

## account/state fetch during playback

**File:** `src/context/AuthContext.js:89-121`

```89:105:src/context/AuthContext.js
  const refreshAccountState = useCallback(async () => {
    if (accountStateFetchingRef.current) return null;
    accountStateFetchingRef.current = true;
    try {
      const res = await fetch("/api/account/state", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) {
          setUser(null);
          setIsAdmin(false);
          setLibrary([]);
          setOwnedSlugs(new Set());
          setAccountState(EMPTY_ACCOUNT_STATE);
        }
        return null;
      }
```

**Side effects on 401:** Clears entitlements in React state. **Does not** pause audio or call `stop()`. Track metadata frozen at play time until next `playTrack`.

**Side effects on success:** Updates `accountState` including `mediaProgress`, `permissions`, `subscriberActive`. Can trigger:

- `entitlements:updated` listener only if window event dispatched (checkout) — not on every refresh
- Modal re-play effect only if `modalPlaySlugRef` set (`page.js:951-981`)
- `playTrack` dependency on `accountState?.mediaProgress` — changing progress does **not** re-invoke playTrack callback identity unless progress array reference changes on re-render (callback stable unless mediaProgress in deps — **yes** `accountState?.mediaProgress` in playTrack deps line 1337)

**Note:** `playTrack` useCallback includes `accountState?.mediaProgress` in deps — function identity changes when progress updates, but does not auto-re-run play.

## Guest session

**File:** `src/lib/guest-session` (used by library/stream)

Stream route:

```109:111:src/app/api/library/stream/route.js
  const user = await getFanSessionUser() ?? await getGuestUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
```

Guest cookie loss mid-play → next stream fetch/redirect returns 401 → ACCESS_DENIED or preview fallback.

## Cookie / session stability risks

| Risk | Impact on playback |
|------|-------------------|
| Supabase cookie expiry mid-play | Next `/api/library/stream` JSON fetch → 401 |
| Safari ITP dropping auth cookies | Documented fallback in AuthContext localStorage restore |
| Guest session expiry | `account/state` returns expired; guest cleared |
| Same-origin playback events 404 | **None** on audio |
| CS cookies on cross-origin CS URL | Not used — browser hits storefront same-origin instead |

## Token refresh during play

Supabase `onAuthStateChange` handles `SIGNED_IN` but **not** explicit `TOKEN_REFRESHED` handler. Token refresh typically silent; if refresh fails → eventual 401 on API routes.

No code listens for auth refresh to re-validate stream or pause playback.

## Entitlement refresh side effects

### Window event: entitlements:updated

**Dispatchers:**
- `src/app/page.js:1260` (post-checkout)
- `src/app/success/page.js:111`

**Handler:** `AudioContext.js:1399-1408` — upgrades preview to full when playing. **Non-destructive.**

### accountState.permissions change

If `permissions.subscriber` flips false while playing with stale `canStream: true` metadata:
- No immediate termination
- Next stream retry/upgrade may 403 → ACCESS_DENIED pause

### mediaProgress update from parallel telemetry

`/api/media/playback` writes `media_playback_progress` on play/progress. In-memory `accountState.mediaProgress` updates only on next `refreshAccountState()` — **not** on each telemetry POST.

Resume position on **subsequent** play uses stale-or-fresh progress from last account/state load.

## Auth-gated modal replay

**File:** `src/app/page.js:951-981`

Re-runs `playTrack` once when `authLoading` transitions false and modal was opened during load. Does **not** re-run on every `accountState` change (guarded by `modalPlaySlugRef`).

## Listening position persistence (local)

**File:** `src/lib/listening-history.js:35-52`

- Saves every 15s during play (`AudioContext.js:317-328`)
- Saves on visibility hidden / pagehide
- `getSavedPlaybackPosition` used on next play if `positionSeconds > 5`

**Continuity bug class:** User listens near end → position saved → next play starts at 0 briefly → metadata seek → jump to end → `ended`.

## Stream session vs auth session

Orthogonal systems:
- **Auth session** — Supabase/guest cookie for API authorization
- **Stream session** — DB row + signed R2 URL for analytics/concurrency
- **Control session** — localStorage UUID for CS telemetry

Invalidating one does not automatically invalidate others. Stream 401 reflects auth; playback/events 404 reflects missing storefront proxy route.

## Recommendations (audit-only, not implemented)

1. Confirm reproducer's saved `mediaProgress` / localStorage position for affected slug
2. Check Network tab at T+2s for `library/stream` JSON fetch from `upgradeToFullStream`
3. Fix playback events URL to hit CS origin or add storefront proxy route (telemetry only)
4. Consider skipping 2s upgrade when already on redirect fast-path with playing audio
