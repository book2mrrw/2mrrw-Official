# CORS architecture fix — 2026-05-26

Systematic audit and repair for production audio/media network failures on **www.2mrrw.com** / **2mrrw.com**. Scope: networking/CORS only — no AudioContext/player rewrites.

---

## Origin map

| Layer | Origin / host | Used for |
|-------|----------------|----------|
| Storefront (prod) | `https://www.2mrrw.com` | Canonical UI, same-origin `/api/*` |
| Storefront (apex) | `https://2mrrw.com` | Redirect → www (see `next.config.mjs`) |
| Storefront (preview) | `https://artist-platform-silk.vercel.app` | Vercel preview |
| Control System API | `https://2mrrw-control-system.vercel.app` | Catalog, hero, vault, `POST /api/playback/events` |
| Supabase | `NEXT_PUBLIC_SUPABASE_URL` | Auth, DB (not CORS to storefront APIs) |
| R2 public CDN | `https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev` | Previews, covers (`NEXT_PUBLIC_R2_PUBLIC_URL`) |
| R2 signed GET | `*.r2.cloudflarestorage.com` | Full streams via `/api/library/stream` redirect |
| Stripe / Resend / Printful | External | Checkout, email, merch |

### Frontend → backend fetch paths

| Client caller | Request | CORS |
|---------------|---------|------|
| `AuthContext` | `fetch("/api/account/state")` | **Same-origin** — no CORS |
| `stream-client.js` | `fetch("/api/library/stream?...")` | **Same-origin** |
| `playback.js` | `fetch(CS + "/api/playback/events")` | **Cross-origin** — CS `proxy.ts` + `withCors` |
| `client.js` / releases | `fetch(CS + "/api/releases/...")` | **Cross-origin** — CS middleware |
| `<audio src="…r2.dev/…">` | Media element | **R2 bucket CORS** (manual) |

---

## Env audit (names only)

### artist-platform `.env.example`

| Variable | In example | Local `.env.local` set? |
|----------|------------|-------------------------|
| `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` | Yes | Yes |
| `NEXT_PUBLIC_SITE_URL` | Yes (added) | Yes |
| `NEXT_PUBLIC_BASE_URL` | Yes (added) | Yes |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Yes | **No** (use Vercel prod value) |
| `CLOUDFLARE_R2_*` | Yes | **No** (required for `/api/library/stream` signing) |
| `NEXT_PUBLIC_SUPABASE_URL` | — (legacy docs) | Yes |
| `NEXT_PUBLIC_API_URL` / `VITE_*` / `REACT_APP_*` | **Not used** | — |
| `MEDIA_URL` / `CDN_URL` | **Not used** | — |

### Control System `.env.example`

| Variable | Role |
|----------|------|
| `CONTROL_SYSTEM_ALLOWED_ORIGINS` | Extra CORS allowlist (comma-separated) |
| `NEXT_PUBLIC_APP_URL` | CS self URL + optional CORS entry |
| `NEXT_PUBLIC_R2_PUBLIC_URL` | Public preview/cover CDN base |

**Rule:** Never point `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` at the storefront host. Never use `NEXT_PUBLIC_SITE_URL` for internal `/api` `fetch()`.

---

## Root causes fixed

### 1. Invalid static CORS on Control System (`next.config.mjs`)

Commit `570d25f` re-added `headers()` with a **fixed** `Access-Control-Allow-Origin: https://www.2mrrw.com` on all `/api/*`. That:

- Broke apex visitors (`https://2mrrw.com`) — wrong origin echo
- Omitted `Access-Control-Allow-Credentials` while storefront sends `credentials: "include"` on playback events
- Fought `src/proxy.ts`, which already sets per-origin CORS correctly

**Fix:** Removed `headers()` from Control System `next.config.mjs`. CORS is owned by `src/proxy.ts` (OPTIONS 204) and `src/server/http.ts` (`corsPreflight` / `withCors`).

### 2. Duplicate hardcoded OPTIONS on CS routes

`/api/playback/events` and `/api/releases/[slug]` had local OPTIONS with incomplete allowlists and no credentials.

**Fix:** Route `OPTIONS` handlers delegate to `corsPreflight(request)` from `@/server/http`.

### 3. Allowlist gaps

**Fix:** Added `http://localhost:5173` and `http://127.0.0.1:5173` to `DEFAULT_FRONTEND_ORIGINS` in `proxy.ts` and `http.ts`.

### 4. Storefront

- **`/api/library/stream`:** Added `OPTIONS` → 204 for preflight safety (primary path remains same-origin relative).
- **Canonical host:** `next.config.mjs` redirects `2mrrw.com` → `https://www.2mrrw.com` (permanent).
- **`AuthContext`:** Already uses relative `/api/account/state` (verified).
- **`stream-client.js`:** Already uses relative `/api/library/stream` (verified).
- **`getControlSystemAccountState`:** Defined but **unused** in production client — no change.

---

## Credentials audit

| Call type | `credentials` | Notes |
|-----------|---------------|-------|
| Storefront `/api/*` | `include` | Same-origin cookies |
| CS `playback/events`, `fetchControlSystemJson` | `include` | Needs `Allow-Credentials: true` on CS (proxy/http) |
| R2 preview `<audio>` / `<img>` | None | Correct — public CDN |
| `vault-audio.js` HEAD check | Default | No credentials |

---

## Manual steps (R2)

Apply bucket CORS on Cloudflare R2 bucket **`2mrrw-media`**:

1. Dashboard → R2 → **2mrrw-media** → Settings → CORS policy
2. Paste policy from [`r2-cors-policy-recommended.json`](./r2-cors-policy-recommended.json)
3. Confirm `NEXT_PUBLIC_R2_PUBLIC_URL` on Vercel matches a **public-access** `r2.dev` hostname (see `r2-playback-fix-20260525.md`)

Optional CLI:

```bash
npx wrangler login
npx wrangler r2 bucket cors put 2mrrw-media --file docs/reports/r2-cors-policy-recommended.json
```

---

## Files changed

### 2MRRW-Control-System

- `next.config.mjs` — remove static CORS headers
- `src/proxy.ts`, `src/server/http.ts` — allowlist + localhost:5173
- `src/app/api/playback/events/route.ts` — `corsPreflight`
- `src/app/api/releases/[slug]/route.ts` — `corsPreflight`
- `.env.example` — document localhost:5173 in `CONTROL_SYSTEM_ALLOWED_ORIGINS`

### artist-platform

- `next.config.mjs` — apex → www redirect
- `src/app/api/library/stream/route.js` — `OPTIONS`
- `.env.example` — site URL + control system docs
- `docs/reports/r2-cors-policy-recommended.json` — new
- `docs/reports/cors-architecture-fix-20260526.md` — this file

---

## Build status

| Repo | `npm run build` |
|------|-----------------|
| 2MRRW-Control-System | **PASS** |
| artist-platform | **PASS** |

---

## Deploy order

1. **Control System** — `npx vercel deploy --prod --yes` (from control repo)
2. **Storefront** — `npx vercel deploy --prod --yes` (from artist-platform)

Post-deploy probe:

```bash
curl -sI -X OPTIONS \
  -H "Origin: https://2mrrw.com" \
  -H "Access-Control-Request-Method: POST" \
  https://2mrrw-control-system.vercel.app/api/playback/events | grep -i access-control
```

Expect single `access-control-allow-origin: https://2mrrw.com` and `access-control-allow-credentials: true`.

---

## Commit SHAs / deploy IDs

_Filled in after `git push` and Vercel deploy in this run._
