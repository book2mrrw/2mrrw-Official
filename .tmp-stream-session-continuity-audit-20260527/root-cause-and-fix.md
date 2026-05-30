# Exact root cause and safest fix

## Exact failure point for 401
- `GET /api/library/stream?slug=hour-glass` returns 401 only when both resolvers fail:
  - `getFanSessionUser()` returns null (no valid Supabase fan session server-side), and
  - `getGuestUser()` returns null (no valid `guest_session` cookie path).

## Most likely root cause for continuity failures
- Session cookies are host-scoped in practice while traffic can originate at apex and redirect to www.
- On apex->www transition, server-side auth cookies may not be available on the effective host for stream call, so `supabase.auth.getUser()` resolves null.
- If guest cookie is also absent (or never initialized), fallback also resolves null -> 401.

## Refresh-failure contribution
- Middleware is correctly invoking `supabase.auth.getUser()` for stream route, so refresh attempts occur where possible.
- Refresh still fails when required refresh state/cookies are missing, stale, malformed, or project/domain-mismatched.

## Safest minimal production fix
1. Enforce canonical `www` usage before auth/session-critical operations (already partially in place via redirect; ensure login links, callbacks, and external entry points always target `https://www.2mrrw.com`).
2. Preserve current middleware refresh flow; do not alter playback architecture.
3. Add targeted observability (server log fields only) around stream 401 branch to distinguish:
   - fan session missing
   - guest cookie missing/invalid
   - guest admin lookup miss
4. For guest flows, ensure `/api/guest/session` initialization runs before entitlement-gated stream attempts for non-fan users.

## Confirmed vs unresolved

### Confirmed
- 401 branch mechanics and guest cookie behavior are proven by code + probes.
- Host redirect behavior apex->www is confirmed.

### Needs authenticated browser capture
- Exact Supabase cookie names and refresh request payload for the specific failing signed-in browser session.
