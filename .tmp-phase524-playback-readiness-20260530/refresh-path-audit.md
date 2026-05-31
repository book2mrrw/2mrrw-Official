# Refresh Path Audit — Full Reload vs Soft Invalidation

**Phase:** 5.2.4  
**Date:** 2026-05-31  
**Scope:** `src/`, `public/sw.js`, layout inline SW registration

---

## Summary

| Category | Count in app source | Full page reload? |
|----------|---------------------|-------------------|
| `location.reload()` | **0** | — |
| `router.refresh()` | **1** (verify-otp) | Soft RSC refresh |
| `window.location.href` / `assign` | **6** intentional navigations | **Full load** |
| `router.push` / `replace` | Multiple routes | Client navigation (no full reload) |
| `visibilitychange` → reload | **0** | Refetch/resume only |
| Auth token refresh → reload | **0** | Re-render only |
| Service worker → forced reload | **0** listener | `skipWaiting` only |

**No evidence of an accidental reload loop in application code.** Unexpected refreshes likely **external** (deploy, iOS tab discard, manual) or **full navigation** from explicit `window.location` / OTP flow.

---

## Full navigation (`window.location`)

| File | Trigger | Classification |
|------|---------|----------------|
| `src/context/AuthContext.js:328` | `enterGuest` when `postAuthRedirect` in sessionStorage | **Expected** post-guest auth |
| `src/app/page.js:1542` | Collector cards CTA | **Expected** user nav |
| `src/app/page.js:1933,2142` | Subscribe / collector buttons | **Expected** |
| `src/app/subscribe/page.js:144` | Back to home | **Expected** |

---

## Next.js soft refresh

| File | Call | Classification |
|------|------|----------------|
| `src/app/verify-otp/page.js:117` | `router.refresh()` after OTP verify | **Expected** — refreshes server components on auth route only |

**Not used** on home shell or `AudioContext`.

---

## Router navigation (no full reload)

Examples: `join`, `login`, `verify-otp`, `gift/[token]`, `success`, `DeepLinkRedirect`, `collector/activate`.  
These swap App Router segments; **root `layout.js` persists** — `AudioProvider` stays mounted when navigating within app.

**Exception:** leaving site origin or hard `window.location` resets everything.

---

## `visibilitychange` handlers

| Location | On visible | On hidden | Reload? |
|----------|------------|-----------|---------|
| `AudioContext.js` ~2746 | Resume playback / MediaSession rehydrate; iOS may force paused state | Save position, refresh signed URL meta | **No** |
| `page.js` ~987 | Resume carousel **videos** only | Pause carousel videos | **No** |
| `useSyncEngine.js` ~94 | `guardedResync("visibility")` — refetch control-system data | — | **No** (data only) |

**Loop risk:** Low. `useSyncEngine` has circuit breaker (3 failures → 30s open). `AudioContext` visibility recover uses `RECOVER` command, not reload.

---

## Auth & session refresh

| Mechanism | Side effect | Reload? |
|-----------|-------------|---------|
| `supabase.auth.onAuthStateChange` | `SIGNED_OUT` clears state; `SIGNED_IN` applies user if new id; `TOKEN_REFRESHED` **ignored** | **No** |
| Safari ITP `setSession` from localStorage on boot | Silent session restore | **No** |
| `refreshAccountState` / `refreshLibrary` | Fetch + React state | **No** |
| `window.dispatchEvent("entitlements:updated")` | Checkout success → may `upgradeToFullStream` | **No** |

---

## Polling & intervals (not reload)

| Source | Interval | Purpose |
|--------|----------|---------|
| `AudioContext.js` | 20s | SW `KEEP_ALIVE` postMessage |
| `AudioContext.js` | 5s (position save) | Playback persistence |
| `page.js` | 1s | Live countdown UI |
| `subscribe/page.js` | 2.5s | Subscription status sync |
| `AuthGate` / verify-otp | 1s | OTP resend countdown |

---

## Service worker (`public/sw.js`)

- `install` → `skipWaiting()`
- `activate` → `clients.claim()`
- `message` → `KEEP_ALIVE` ACK only
- **No `fetch` handler**, no cache bust, **no `controllerchange` → `location.reload()`**

**Classification:** **Expected** low-risk keep-alive; new SW version activates without app-coded reload. Fans may still see stale chunk mix briefly after deploy until natural navigation (Vercel/Next concern, not a reload call).

Registered in `layout.js` inline script on `window.load`.

---

## Session recovery (mount)

`useSessionRecovery` → hydrate catalog + `refreshSignedUrlsForQueue` → `2mrrw:playback-recovery` event.  
**No reload.** `AudioPhase10Bridge` listens and may restore queue.

---

## Checkout / URL side effects

| File | Behavior | Risk |
|------|----------|------|
| `page.js` ~1440 | `?checkout=pending` triggers `handleCheckout` once | **Unexpected work** on return URL, not full reload |
| `page.js` deep link | `history.replaceState` strips `deepLink` param | **No** reload |

---

## Classified refresh mechanisms

### Expected
- User-initiated `window.location` / subscribe / collector routes
- OTP `router.refresh()`
- Soft `router.push` between app pages
- Visibility resume / signed URL refresh / sync engine refetch

### Unexpected (user report) — plausible causes **outside grep hits**
- **Vercel production deployment** or preview swap (full document load)
- **iOS Safari tab eviction** or PWA restart (looks like refresh)
- **Memory pressure** on large `page.js` session
- **Guest `enterGuest` redirect** after modal
- **No** `location.reload` loop in repo

### Potential (low)
- Service worker update without reload listener → rare chunk mismatch until hard refresh
- `router.refresh` only on `/verify-otp` — not home

---

## Grep commands used

```
router.refresh, location.reload, window.location
visibilitychange, onAuthStateChange
refresh, reload (src/**/*.js)
serviceWorker, sw.js, setInterval
```

---

## Recommendations (audit only)

1. Add RUM/logging for `performance.navigation.type` + route transitions on home (diagnose “unexpected refresh”).
2. Document deploy behavior for fans on long-lived PWA tabs.
3. Do **not** add `controllerchange` reload without explicit product decision.
