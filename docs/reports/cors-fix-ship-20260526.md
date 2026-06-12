# CORS fix ship report — 2026-05-26

## Issue 1 — artist-platform absolute `/api/account/state` URLs

### Grep before (requested patterns)

```bash
grep -rn "2mrrw.com/api/account" . --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --exclude-dir=".next" --exclude-dir="node_modules"
# → no matches

grep -rn "NEXT_PUBLIC_SITE_URL\|NEXT_PUBLIC_BASE_URL\|NEXT_PUBLIC_API_URL" . …
# → server-only: checkout/session, admin/gifts, gifts/email (Stripe/redirect URLs — kept as full URLs)
# → Supabase NEXT_PUBLIC_SUPABASE_URL (not storefront API)
```

### Grep after

Same as before — **no client-side absolute storefront `/api/account/state` URLs**.

| Caller | Path |
|--------|------|
| `src/context/AuthContext.js` | `fetch("/api/account/state", { credentials: "include" })` |
| `src/lib/control-system/account.js` | `fetchControlSystemJson("/api/account/state")` → Control System base from `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` |

`src/lib/control-system/playback.js` posts to Control System via `buildControlSystemUrl("/api/playback/events")` (cross-origin by design).

**Repo change this run:** none (already on `main` with relative account/state + `a636c18` in-flight guard).

---

## Issue 3 — Control System `/api/playback/events`

### Root cause

`next.config.mjs` `headers()` set **invalid** `Access-Control-Allow-Origin` to a comma-separated list of origins. Browsers require a **single** origin (or `*`). Production showed:

`access-control-allow-origin: https://www.2mrrw.com,https://2mrrw.com,…`

Middleware (`src/proxy.ts`) already handles OPTIONS 204 with proper headers, but production storefront origins were missing from `DEFAULT_FRONTEND_ORIGINS`.

### Fix

1. Removed broken global CORS `headers()` from `next.config.mjs`.
2. Added `https://2mrrw.com` and `https://www.2mrrw.com` to allowlists in `src/server/http.ts` and `src/proxy.ts`.
3. `/api/playback/events/route.ts` uses shared `corsPreflight` + `withCors` on POST responses.
4. `.env.example` documents production origins in `CONTROL_SYSTEM_ALLOWED_ORIGINS`.

### Route status (pre-fix production probe)

| Request | URL | Status | Notes |
|---------|-----|--------|-------|
| OPTIONS | `https://2mrrw-control-system.vercel.app/api/playback/events` | 204 | Invalid multi-origin `Allow-Origin` header |
| POST | same | 200 | Same invalid `Allow-Origin` on JSON body |

---

## Issue 2 — R2 bucket CORS (manual)

Wrangler is **not** installed globally; `npx wrangler r2 bucket cors get 2mrrw-media` failed with **network ETIMEDOUT** during install in this environment. No `wrangler.toml` in either repo.

### Cloudflare dashboard (R2 → bucket `2mrrw-media`)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2** → bucket **`2mrrw-media`**.
2. Open **Settings** → **CORS policy** → **Edit**.
3. Add a rule (adjust if you use a custom domain on R2):

```json
[
  {
    "AllowedOrigins": [
      "https://www.2mrrw.com",
      "https://2mrrw.com",
      "https://artist-platform-silk.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 86400
  }
]
```

4. Save. If media is served via **r2.dev** public URL or a **custom domain**, ensure that hostname’s CORS matches browser playback/download origins.

### Optional CLI (when authenticated)

```bash
npx wrangler login
npx wrangler r2 bucket cors put 2mrrw-media --file r2-cors.json
npx wrangler r2 bucket cors get 2mrrw-media
```

Requires `CLOUDFLARE_API_TOKEN` with R2 edit scope or interactive login.

---

## Builds

| Repo | Command | Result |
|------|---------|--------|
| artist-platform | `npm run build` | OK |
| 2MRRW-Control-System | `npm run build` | OK |

## Deploy / SHAs

| Repo | Commit | Production alias |
|------|--------|------------------|
| **2MRRW-Control-System** | `49c4a72a54e1a84e587103ff88615fa9d96a3710` | https://2mrrw-control-system.vercel.app |
| **artist-platform** | `3fd35d112bec92124d45dfae9c5851f473bce714` (docs only; app code at `ccd0fd3`) | https://www.2mrrw.com |

**Vercel deployments**

- CS: `dpl_GVfQC1kMGuvYzjutZPgHYxySxTT4` — https://vercel.com/eellian-morrows-projects/2mrrw-control-system/GVfQC1kMGuvYzjutZPgHYxySxTT4
- Storefront: `dpl_43pmkr1Pygjggxaq7UgYVE7KR5RA` — https://vercel.com/eellian-morrows-projects/artist-platform/43pmkr1Pygjggxaq7UgYVE7KR5RA

### Post-deploy CORS probe (CS `/api/playback/events`)

| Request | `Access-Control-Allow-Origin` | Status |
|---------|-------------------------------|--------|
| OPTIONS + `Origin: https://www.2mrrw.com` | `https://www.2mrrw.com` (single origin) | 204 |
| POST + same origin | `https://www.2mrrw.com` | 200 |

**Before fix:** comma-separated multi-origin value (browser-invalid).

