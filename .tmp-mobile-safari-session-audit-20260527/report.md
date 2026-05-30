# Mobile Safari Session Audit — Admin Server-Side Session Not Recognized

**Date:** 2026-05-27  
**Repo:** `/Users/recharge/artist-platform`  
**Scope:** Read-only code audit. No fixes proposed.  
**Symptoms reported:** Admin authenticates on iOS Safari, lands on homepage; server does not recognize session (pricing visible, previews only); `/account` redirects to homepage. Desktop works with same account.

---

## Executive summary

The codebase has a **split auth transport model**: the browser Supabase client persists OTP sessions in **`localStorage`** (`2mrrw-auth-token`), while all server authorization (`getFanSessionUser`, `/api/account/state`, `/api/library/stream`) reads **HTTP cookies** via `@supabase/ssr` `createServerClient`. OTP verification never writes SSR auth cookies. Middleware can refresh cookies only when they already exist on the request.

On mobile Safari this gap is more likely to surface because ITP/private-mode can restrict `localStorage`, apex→www redirects can split host-only cookies, and a stale **`guest_session`** cookie can win server-side resolution when Supabase cookies are absent—replacing the authenticated client user with a guest identity and guest entitlements.

There is **no `/account` App Router page**; account UI is a tab inside `src/app/page.js`. A literal `/account` URL has no route handler in this repo.

---

## 1. Supabase SSR cookie handling on mobile Safari

### Files reviewed

| File | Role |
|------|------|
| `src/lib/supabase/server.js` | Server `createServerClient` + `cookies()` adapter |
| `src/lib/supabase/middleware.js` | Edge middleware session refresh |
| `middleware.js` | Delegates to `updateSession` |
| `src/lib/supabase/client.js` | **Browser client — not SSR cookie client** |

### 1.1 Server cookie adapter reads all cookies; writes best-effort

```7:26:src/lib/supabase/server.js
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from Server Component — middleware handles refresh
          }
        },
      },
    }
  );
```

- **Read path:** `getAll()` returns every cookie Next sees — includes chunked Supabase names if present.
- **Write path:** Swallows errors in Server Components; relies on middleware for refresh writes.

### 1.2 Middleware writes refreshed cookies onto the response

```4:27:src/lib/supabase/middleware.js
export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    ...
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();
  return supabaseResponse;
}
```

- Refreshed cookies are attached to **`supabaseResponse`** for matched routes.
- **No custom `cookieOptions`** (Domain, SameSite, Secure) are set in app code; options come from Supabase SSR defaults on each `setAll` call.

### 1.3 Browser client does NOT use SSR cookies — uses localStorage

```14:28:src/lib/supabase/client.js
export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        storage: getBrowserStorage(),
        storageKey: "2mrrw-auth-token",
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    }
  );
}
```

```4:11:src/lib/supabase/client.js
function getBrowserStorage() {
  if (typeof window === "undefined") return memoryLocalStorageAdapter();
  try {
    if (window.localStorage) return window.localStorage;
  } catch {
    // Safari ITP / private mode can deny access.
  }
  return memoryLocalStorageAdapter();
}
```

**Critical finding:** Auth flows (`AuthGate`, `verify-otp`, `login`, `join`) call `createClient()` from this module. `verifyOtp` stores the session in **`localStorage` / in-memory adapter**, not in Supabase SSR HTTP cookies. Server routes never read `2mrrw-auth-token`.

Foundation docs still describe `createBrowserClient` from `@supabase/ssr` for `client.js` (`docs/foundation/FRONTEND_FOUNDATION_BASELINE.md:61`, `docs/reports/supabase-auth-init-audit-readonly-20260526.md:28`) — **current code diverges**.

### 1.4 SameSite, Secure, Domain, chunked cookies

| Cookie class | SameSite | Secure | Domain | Chunking |
|--------------|----------|--------|--------|----------|
| `guest_session` | `lax` (`src/lib/guest-session.js:52`) | prod only (`:53`) | **Not set** (host-only) | N/A |
| Supabase auth | **Not overridden in repo** | From Supabase SSR defaults | **Not overridden in repo** | Handled by `@supabase/ssr` if token exceeds size (typical pattern `sb-<project-ref>-auth-token`, optional `.0`/`.1` chunks) |

No app code sets `Domain=` on Supabase cookies. Cookies are host-scoped to the issuing host (`www.2mrrw.com` vs `2mrrw.com` matter).

### 1.5 ITP / mobile Safari interaction (code-level)

- `client.js:9` explicitly documents Safari ITP / private mode denying `localStorage`.
- Fallback: `memoryLocalStorageAdapter()` — session survives only for the current document lifetime.
- `AuthContext.js:186-209` adds a **second** localStorage fallback reading `2mrrw-auth-token` and calling `setSession` — still **does not** populate HTTP cookies for server routes.

**Answer to audit questions:**

- Cookie adapter **can** read/write all Supabase cookies **if they exist on the request/response**.
- OTP login path **does not create** those cookies today.
- Chunked cookie names are not customized; Supabase SSR default naming applies when cookies are written (typically only via middleware refresh of an existing session, or if a cookie-based browser client were used).

---

## 2. Middleware session refresh path

### 2.1 Flow

```
Request → middleware.js:10-14
       → updateSession (src/lib/supabase/middleware.js)
       → createServerClient + getAll/setAll cookie adapters
       → supabase.auth.getUser()  // refresh if needed
       → return supabaseResponse (with Set-Cookie if refresh occurred)
```

```10:20:middleware.js
export async function middleware(request) {
  if (STRIPE_WEBHOOK_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/public/.*|api/health.*|api/guest/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|wav|mp3)$).*)",
  ],
};
```

- **`/api/account/state`** and **`/api/library/stream`** are matched (not excluded).
- **`/api/guest/*`** is **excluded** from middleware refresh.

### 2.2 Does refreshed cookie get written on mobile paths?

**Yes, when refresh occurs** — `setAll` writes to `supabaseResponse.cookies` (`middleware.js:18-20`). There is no mobile-specific branch.

**But:** if the incoming request has **no Supabase auth cookies**, `getUser()` has nothing to refresh. Middleware cannot mint a session from client-only `localStorage`.

### 2.3 Silent refresh failure → appears logged out?

Server-side: `getFanSessionUser()` → `supabase.auth.getUser()` returns no user → falls through to guest (`session-user.js:30-32`). No error is surfaced to the client from middleware.

Client-side: `AuthContext` may still hold a user from `getSession()` / localStorage while `/api/account/state` returns **`user: null`** or a **guest** user (see §4). UI can look partially signed-in while entitlements/stream behave as anonymous/guest.

---

## 3. Auth redirect after login

### 3.1 OTP / login flows (no auth callback route)

| Step | File:line | Post-login destination |
|------|-----------|------------------------|
| Join sends OTP | `src/app/join/page.js:64,106-110` | `/verify-otp?email=…&next=…` |
| Login sends OTP | `src/app/login/page.js:62-63,94-95` | `/verify-otp?email=…&next=…` |
| Verify success | `src/app/verify-otp/page.js:19,109-111` | `nextPath` default `"/?tab=mymusic"` |
| AuthGate (root) | `src/components/auth/AuthGate.js:266-272` | Stays on current page; `onVerified` only |

Default `nextPath` values use **relative paths** (`/?tab=mymusic`, gift paths) — not hardcoded apex/www.

**No `src/app/auth/callback` route** exists in the repo.

### 3.2 Apex → www redirect

```32:40:next.config.mjs
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "2mrrw.com" }],
        destination: "https://www.2mrrw.com/:path*",
        permanent: true,
      },
    ];
  },
```

- **`vercel.json`** contains only crons — no auth redirects.
- If a user opens **`https://2mrrw.com`** (apex), all paths 307/308 to **`https://www.2mrrw.com`**.
- Host-only cookies set on one host are **not sent** to the other.

### 3.3 Could redirect strip or scope cookies?

- **307 redirect itself** does not strip cookies, but cross-host redirect means cookies scoped to the first host are absent on the canonical host.
- OTP session in **localStorage is origin-scoped** (`https://www.2mrrw.com` vs `https://2mrrw.com` are different origins) — another split-brain vector if entry URL varies.
- **`guest_session`** is host-only, no `Domain` (`guest-session.js:48-56`).

---

## 4. Entitlement hydration timing

### 4.1 Bootstrap sequence

```164:238:src/context/AuthContext.js
  useEffect(() => {
    ...
    (async () => {
      ...
        const { data: sessionData } = await supabase.auth.getSession();
        // Safari ITP localStorage fallback ...
        const resolved = resolveUserFromSession(resolvedSession);
        if (resolved) {
          setUser(resolved.user);
          setIsAdmin(resolved.isAdmin);
          await refreshAccountStateRef.current?.();
        } else {
          await refreshGuestRef.current?.();
        }
        ...
    })().finally(() => {
      if (mounted) setLoading(false);
    });
```

- `loading` (`authLoading`) is `true` until bootstrap finishes (`:35-36`, `:236-237`).
- **`AppAuthRoot`** blocks the app behind a loading shell, then **AuthGate** if `!isOtpAuthenticated(user)` (`AppAuthRoot.js:16-30`).

### 4.2 `refreshAccountState` behavior

```89:121:src/context/AuthContext.js
  const refreshAccountState = useCallback(async () => {
    ...
      const res = await fetch("/api/account/state", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) {
          setUser(null);
          ...
        }
        return null;
      }
      const data = await res.json();
      if (data.user) {
        ...
        setUser((prev) => (prev?.id === data.user.id ? prev : data.user));
        setIsAdmin(Boolean(data.permissions?.admin) || resolved?.isAdmin);
      }
      applyAccountPayload(data);
```

Important details:

1. **Unauthenticated server response is HTTP 200**, not 401 — `account/state/route.js:64-83` returns `{ user: null, permissions: { guest: true, ... } }`.
2. When `data.user` is **null**, client **`user` is not cleared** — only `applyAccountPayload` resets entitlements to guest defaults.
3. When `data.user` is a **stale guest** (from `guest_session` cookie), **`setUser` replaces** the OTP admin user with the guest profile (`:111`).
4. **`isAdmin` client flag** can be overwritten to `false` when server returns non-admin guest (`:112`).

### 4.3 Server resolution order (guest can override admin server-side)

```5:32:src/lib/auth/session-user.js
export async function getFanSessionUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email && !user.email.endsWith("@guest.2mrrw.local")) {
    ... return fan user ...
  }
  const guest = await getGuestUser();
  if (guest) return guest;
  return null;
}
```

If Supabase cookies are missing, **`getGuestUser()` wins** when `guest_session` exists — even immediately after OTP login.

### 4.4 Race: guest defaults on slow mobile

| Phase | Client `user` | `accountState` | UI entitlement source |
|-------|---------------|----------------|-------------------------|
| OTP verify completes | Admin from session | Previous / empty | Client session |
| `refreshAccountState` in flight | Admin | Stale or empty | `authLoading` may still be false |
| Server returns `user:null` | **Still admin** (not cleared) | Guest permissions via `applyAccountPayload` | **Previews + pricing** (`resolveContentAccess` uses `accountState`) |
| Server returns stale guest | **Replaced by guest** | Guest permissions | Previews; `isAdmin` false |
| `useEffect` admin patch | Admin if not overwritten | May patch `permissions.admin` (`:295-313`) | Only if `isAdmin && userId` still true |

Playback and stream URLs use **`accountState`**, not raw client session:

```1103:1104:src/app/page.js
      { ...accountState, userId: currentUser?.id },
```

```214:227:src/lib/music-access.js
export function resolvePlaybackSrc(track, access, { userId } = {}) {
  ...
  if (access?.canStream && track.slug) {
    return libraryStreamRedirectSrc(track.slug);
  }
  ...
  return catalogPreviewAudioUrl(previewPath);
}
```

**Pricing visibility** when server state lacks admin:

```279:319:src/lib/music-access.js
export function resolveContentAccess(item, accountState = {}) {
  ...
  if (trackAccess.admin) {
    return { ... showPrice: false, showCart: false, canStream: true };
  }
  ...
  return { ... showPrice: !libraryMode, showCart: !libraryMode, ... };
}
```

Symptoms (**pricing visible, previews only**) match **guest/unauthenticated `accountState`** even when client briefly held an admin session.

### 4.5 `complete-profile` after OTP (server cookie required)

```13:20:src/app/api/auth/complete-profile/route.js
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id || user.email?.endsWith("@guest.2mrrw.local")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
```

Called from `AuthGate.js:248-257` and `verify-otp/page.js:89-94` with `credentials: "include"`. If Supabase cookies were never set, this returns **401** (best-effort; OTP flow continues). Profile/role sync may not run on mobile even when client session exists.

---

## 5. Account route protection

### 5.1 No `/account` page route

- Grep / glob: **no** `src/app/account/page.js`.
- Account UI is **`activeTab === "account"`** inside `src/app/page.js:2441-2461`.
- Mobile entry: **More → My Account** → `switchTab("account")` (`page.js:2712`).
- Desktop sidebar: `switchTab("account")` (`page.js:1789`).

### 5.2 Why `/account` may “redirect to homepage”

| Behavior | Evidence |
|----------|----------|
| Literal `/account` URL | **No route** in repo → Next.js 404 (not an account tab). User may interpret 404 or navigation back as “homepage”. |
| `/?tab=account` | `page.js:1399-1407` applies tab then **strips** `tab` from URL via `history.replaceState` → address bar shows `/` while account tab is active. |
| Session lost / guest replaced | `AppAuthRoot.js:29-30` renders **AuthGate** instead of app children when `!isOtpAuthenticated(user)` — full-screen auth over homepage shell. |
| Login page | `login/page.js:38-40` — if `getUser()` finds fan email, **`router.replace("/")`**. Uses client SDK (localStorage), not server cookies. |

### 5.3 Auth guards

| Component | File:line | Behavior |
|-----------|-----------|----------|
| `AuthProvider` | `layout.js:34` | Wraps entire app |
| `AppAuthRoot` | `layout.js:35`, `AppAuthRoot.js:8-33` | Loading shell → AuthGate if not OTP-authenticated |
| `AuthGate` | `AuthGate.js:75+` | OTP sign-in/up; `verifyOtp` → `applySessionUser` |
| `AuthGateProvider` | `AuthGateContext.js:15-29` | Stub; `requireAuth` is no-op |
| Middleware | `middleware.js` | Session refresh only; **no route protection** for account |

`isOtpAuthenticated` (`AuthGateContext.js:7-12`):

- Rejects `user.isGuest === true`.
- Accepts real email not ending in `@guest.2mrrw.local`.
- Does **not** consult server `/api/account/state`.

### 5.4 Account tab when `currentUser` falsy

```2445:2459:src/app/page.js
                  {currentUser ? (
                    ... account panel ...
                  ) : (
                    <div ...>Loading account…</div>
                  )}
```

No redirect — shows “Loading account…” if `currentUser` is null. If **`AppAuthRoot`** intercepts first, user never reaches account tab content.

---

## Grep highlights

| Pattern | Notable locations |
|---------|-------------------|
| `getFanSessionUser` | `src/lib/auth/session-user.js:5`; stream `route.js:109,141`; `account/state/route.js:63` |
| `isAdmin` | `AuthContext.js:34,66,112,325`; `page.js:509,1211,1494,1907+` |
| `authLoading` | `AuthContext.js:35,327` exported as `loading`; gated in `page.js:952,1106,1135,1482,1493` |
| Account redirect | No `/account` route; tab switching only in `page.js`; login → `/` at `login/page.js:39` |

---

## Ranked root causes

| Rank | Cause | Confidence | File:line evidence |
|------|-------|------------|-------------------|
| **1** | **Client/server auth transport split** — OTP stores session in `localStorage` (`client.js:19-22`); server reads HTTP cookies only (`server.js:11-18`, `session-user.js:6-9`). Mobile OTP never populates cookies middleware can refresh. | **High (code-confirmed)** | `client.js:14-28`, `AuthGate.js:233-238`, `session-user.js:5-9`, `middleware.js:26` |
| **2** | **Stale `guest_session` wins when Supabase cookies absent** — server falls back to guest user; `refreshAccountState` may **replace** admin client user with guest (`AuthContext.js:111-112`). | **High (code-confirmed)** | `session-user.js:30-31`, `account/state/route.js:63`, `AuthContext.js:109-112`, `guest-session.js:48-56` |
| **3** | **`accountState` hydrated as guest while client session exists** — 200 response with `user:null` does not clear client user but resets entitlements → previews + pricing (`music-access.js:193-194,318-319`). | **High (code-confirmed)** | `account/state/route.js:64-83`, `AuthContext.js:98-114`, `music-access.js:279-319` |
| **4** | **Apex (`2mrrw.com`) → www redirect splits host-only cookies/localStorage origins** | **Medium (code-confirmed policy; mobile impact needs capture)** | `next.config.mjs:32-40`, `guest-session.js:50-55` |
| **5** | **Safari ITP / private mode localStorage denial** — in-memory session adapter; reload/navigation loses client session | **Medium (code acknowledges; device verification needed)** | `client.js:4-11`, `AuthContext.js:186-209` |
| **6** | **`/account` URL has no route; tab param stripped from URL** — looks like “homepage” in address bar | **Medium (code-confirmed)** | No `src/app/account/`; `page.js:1399-1407`, `2442+` |
| **7** | **Desktop “works” due to persisted Supabase cookies from earlier sessions** — middleware refresh keeps server in sync; mobile clean/stale state exposes split | **Medium (hypothesis; needs paired cookie capture)** | `middleware.js:26`; prior audit `.tmp-stream-session-continuity-audit-20260527/` |

---

## Confirmed from code vs needs mobile DevTools verification

### Confirmed from code

- Browser auth uses `@supabase/supabase-js` + `localStorage`, not `@supabase/ssr` `createBrowserClient` cookies.
- Server auth uses cookie-based `createServerClient` only.
- Middleware refreshes cookies on matched routes when cookies exist.
- `guest_session`: `SameSite=lax`, `Secure` in prod, no `Domain`, `Path=/`.
- `/api/account/state` returns 200 with null/guest user when server session missing — not 401.
- No `/account` App Router page; account is a homepage tab.
- Apex → www permanent redirect in `next.config.mjs`.

### Needs mobile Safari DevTools / authenticated capture

1. After OTP on iOS Safari: are **any** `sb-*-auth-token` (or chunked) cookies present on `www.2mrrw.com` for `document` / Storage → Cookies?
2. On failing session: does `GET /api/account/state` return `user: null` or a **guest** `user` with `isGuest: true`?
3. Is a stale **`guest_session`** cookie present alongside missing Supabase cookies?
4. Entry URL: **`www` vs apex** on first login link from email/OTP flow.
5. Compare **desktop vs mobile** cookie jar for the same account after login.
6. Network tab: `/api/library/stream?slug=…` status **401** vs **403** (401 = no user; 403 = user but not entitled).
7. Whether `localStorage['2mrrw-auth-token']` exists after verify on iOS (Web Inspector → Storage).

### Investigation steps (verification only — not fixes)

1. iOS Safari Web Inspector: reproduce OTP login → inspect cookies on `www.2mrrw.com` before any navigation.
2. Capture response body of `/api/account/state` immediately after login on mobile vs desktop.
3. Repeat after clearing site data vs with existing `guest_session`.
4. Confirm initial URL host (`2mrrw.com` vs `www.2mrrw.com`) from OTP email link or PWA add-to-home-screen.

---

## Related prior audits

- `.tmp-stream-session-continuity-audit-20260527/` — cookie transport, apex→www, stream 401 chain.
- `docs/reports/supabase-auth-init-audit-readonly-20260526.md` — documents `createBrowserClient` expectation (current `client.js` differs).

---

## Manifest

```
.tmp-mobile-safari-session-audit-20260527/report.md
src/lib/supabase/client.js
src/lib/supabase/server.js
src/lib/supabase/middleware.js
middleware.js
src/lib/auth/session-user.js
src/context/AuthContext.js
src/context/AuthGateContext.js
src/components/auth/AppAuthRoot.js
src/components/auth/AuthGate.js
src/app/verify-otp/page.js
src/app/login/page.js
src/app/join/page.js
src/app/api/account/state/route.js
src/app/api/auth/complete-profile/route.js
src/lib/guest-session.js
src/lib/music-access.js
src/app/page.js
next.config.mjs
vercel.json
```
