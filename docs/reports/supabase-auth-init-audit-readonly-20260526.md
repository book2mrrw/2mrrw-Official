# Supabase auth init audit (read-only) — 2026-05-26

## Scope and provenance

- **Repository:** `/Users/recharge/artist-platform`
- **Method:** Read-only grep/read of application source; no application source files were modified for this deliverable.
- **Prior work:** Findings consolidated from subagent transcript `agent-transcripts/22ed5f23-e4b1-454c-aaaa-196208826de1/subagents/86f91acc-886c-4917-ac93-a60256f8b4cd.jsonl`, re-checked against current `src/` where noted below.

## Redaction policy (this document)

- **No** `NEXT_PUBLIC_SUPABASE_ANON_KEY`, service role keys, or other secrets appear here.
- **`NEXT_PUBLIC_SUPABASE_URL`:** reported only as **Set in `.env.local` (`https://*.supabase.co`)** — the concrete project hostname from any source is **not** reproduced in this file.

---

## 1. `NEXT_PUBLIC_SUPABASE_URL`

- **Configured in:** `.env.local` (local environment; keep gitignored).
- **Value (redacted form only):** Set in `.env.local` (`https://*.supabase.co`).
- **Do not** commit `.env.local` or paste anon/service keys into reports, tickets, or chat logs.

---

## 2. Server vs client Supabase client boundaries

| Module | Role |
|--------|------|
| `src/lib/supabase/client.js` | `createBrowserClient` from `@supabase/ssr` — browser / `"use client"` surfaces |
| `src/lib/supabase/server.js` | `createServerClient` + `cookies()` from `next/headers` — server-only |
| `src/lib/supabase/middleware.js` | `createServerClient` for Edge middleware |
| `src/lib/supabase/admin.js` | `createClient` from `@supabase/supabase-js` with service role — server/API/scripts only |

**Import checks (current `src/`):**

- `@/lib/supabase/server` is used from server-side modules, e.g. `src/lib/auth/session-user.js`, `src/app/api/auth/complete-profile/route.js`, and API routes that call `getFanSessionUser()` (account state, library stream, gifts, collector-card, etc.). No `"use client"` consumers were found for the server helper in this pass.
- `@/lib/supabase/client` appears in client pages/components (`join`, `login`, `verify-otp`, `AuthGate`) and via **dynamic** `import("@/lib/supabase/client")` inside `src/context/AuthContext.js` (client context).

**Conclusion:** No evidence in `src/` of importing `src/lib/supabase/server.js` into a client bundle. Browser usage stays on the browser client / client modules. Root `middleware.js` delegates session refresh via the middleware Supabase helper (per prior read of `middleware.js` + `src/lib/supabase/middleware.js`).

---

## 3. `refreshSession()` / `getSession()` in effects or render

- **`refreshSession`:** no matches under `src/` (`*.js` / `*.jsx`) in a focused search.
- **`supabase.auth.getSession()`:** only **`src/context/AuthContext.js`** in `src/` (runtime app code; exclude `node_modules` / `.next` from secret-bearing artifacts).
- **Effect shape:** `getSession` runs inside a **mount-only** `useEffect` with dependency array **`[]`**. Callbacks are invoked via **refs** (`refreshAccountStateRef`, `applySessionUserRef`, `refreshGuestRef`) set before the effect — intentional stale-closure avoidance; not the same as “missing supabase in deps” in the naive sense because the client is created inside the effect’s async IIFE.
- **`src/app/login/page.js`:** uses **`supabase.auth.getUser()`** (not `getSession`) inside `useEffect` with **`[router]`** in the dependency list (per prior read).
- **Render:** no `getSession` / `refreshSession` in synchronous render paths found in this audit scope.

---

## 4. `AuthContext.js` — `supabase.auth.*` call sites

Dynamic import, bootstrap `getSession`, `onAuthStateChange`, and cleanup:

```164:218:/Users/recharge/artist-platform/src/context/AuthContext.js
  useEffect(() => {
    if (sessionBootstrappedRef.current) return;
    sessionBootstrappedRef.current = true;

    let mounted = true;
    let authSubscription = null;

    const clearAuthenticatedState = () => {
      setUser(null);
      setIsAdmin(false);
      setLibrary([]);
      setOwnedSlugs(new Set());
      setAccountState(EMPTY_ACCOUNT_STATE);
    };

    (async () => {
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();

        const { data: sessionData } = await supabase.auth.getSession();
        if (!mounted) return;

        const resolved = resolveUserFromSession(sessionData?.session);
        if (resolved) {
          setUser(resolved.user);
          setIsAdmin(resolved.isAdmin);
          await refreshAccountStateRef.current?.();
        } else {
          await refreshGuestRef.current?.();
        }

        const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (!mounted) return;
          if (event === "SIGNED_OUT") {
            clearAuthenticatedState();
            return;
          }
          if (event === "SIGNED_IN" && session) {
            await applySessionUserRef.current?.(session);
          }
        });
        authSubscription = authListener?.subscription;
      } catch {
        /* session restore optional */
      }
    })().finally(() => {
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      authSubscription?.unsubscribe();
    };
  }, []);
```

`signOut`:

```243:247:/Users/recharge/artist-platform/src/context/AuthContext.js
  const signOut = useCallback(async () => {
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      await supabase.auth.signOut();
```

---

## Grep summary (requested patterns, `src/` application code)

| Pattern | Notable paths |
|---------|----------------|
| `createBrowserClient` | `src/lib/supabase/client.js` |
| `createClientComponentClient` | **none** in `src/` |
| `createClient` from `@supabase/supabase-js` | `src/lib/supabase/admin.js` and API routes / scripts (outside this table’s detail) |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` / `supabaseUrl` | Wired through `src/lib/supabase/{client,server,middleware,admin}.js` and consumers (see manifest) |

---

## Files reviewed

See **`supabase-auth-init-audit-readonly-20260526-manifest.txt`** for the explicit path list.

---

## Operational note

Build output under `.next/` can embed public anon URL/key material from bundling; **do not** ship or archive `.next/` as part of a “secrets-safe” audit bundle. This deliverable includes **only** the markdown report and plain-text manifest under `docs/reports/`.
