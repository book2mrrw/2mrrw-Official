## `/api/account/state` — CORS & headers audit

**File:** `/Users/recharge/artist-platform/src/app/api/account/state/route.js`

### CORS
- **No CORS headers** — no `Access-Control-*`, no `response.headers.set()`, no `headers` option on `NextResponse.json()`.
- **No `OPTIONS` handler** — only `export async function GET()`.

### HTTP methods
- **GET only** — no POST, PUT, PATCH, DELETE.

### Explicit response metadata in code

The route does **not** set any custom response header strings. The only app-controlled response side effects are **cookies** on some paths (via `NextResponse` cookie API → `Set-Cookie`):

**`clearGuestCookie` (expired guest session path):**
```javascript
response.cookies.set(COOKIE_NAME, "", {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 0,
});
```
(`COOKIE_NAME` = `"guest_session"`)

**`withGuestCookie` (guest user success path):**
```javascript
response.cookies.set(COOKIE_NAME, encodeGuestCookie(guestId), {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,  // 60 * 60 * 24 * 7 if remember === false, else ONE_YEAR (60 * 60 * 24 * 365)
});
```

All other returns are plain `NextResponse.json(body)` or `NextResponse.json({ error: ... }, { status: 500 })` with **no** second-arg `headers` object.

### GET response paths (no extra headers in route)
| Path | Return |
|------|--------|
| Expired guest cookie | `clearGuestCookie({ user: null, expired: true })` |
| No user | `NextResponse.json({ user: null, library: [], ... })` |
| DB errors | `NextResponse.json({ error: "..." }, { status: 500 })` |
| Guest user | `withGuestCookie(NextResponse.json(body), user.id, { remember: ... })` |
| Signed-in user | `NextResponse.json(body)` |
| Catch | `NextResponse.json({ error: ... }, { status: 500 })` |

Framework defaults (e.g. `Content-Type: application/json`) apply; they are not set in this file.

---

## `next.config.mjs`

**File:** `/Users/recharge/artist-platform/next.config.mjs`

- **No `headers()`** — config is only `images.remotePatterns`.
- **Nothing** targets `/api/account/state` or `/api/*`.

Relevant block (full export):

```javascript
const nextConfig = {
  images: {
    remotePatterns,
  },
};

export default nextConfig;
```

---

## Middleware

**File:** `/Users/recharge/artist-platform/middleware.js`

- **`/api/account/state` is matched** (not in the exclusion list; excluded paths include `api/public/*`, `api/health*`, `api/guest/*`, static assets).
- Stripe webhooks bypass; everything else calls `updateSession(request)` from `/Users/recharge/artist-platform/src/lib/supabase/middleware.js`.
- **No CORS headers** in middleware.

`updateSession` only:
- `NextResponse.next({ request })`
- Supabase auth cookie refresh via `supabaseResponse.cookies.set(name, value, options)` (Supabase-provided cookie names/options, not CORS)

**`vercel.json`:** crons only — no header rules.

---

## Summary

| Check | Result |
|-------|--------|
| CORS headers in route | **None** |
| OPTIONS handler | **None** |
| Methods exported | **GET only** |
| `next.config` headers for this route | **None** |
| Middleware CORS for this route | **None** |
| App-set response metadata | **`Set-Cookie` for `guest_session` only** (clear or set via guest helpers) |

Same-origin `fetch("/api/account/state", { credentials: "include" })` in `AuthContext` does not need CORS; cross-origin callers would get framework defaults only, with no `Access-Control-Allow-*` from this codebase.
