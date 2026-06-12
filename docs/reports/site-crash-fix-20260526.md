# Site crash fix — 2026-05-26

## Root cause (per incident prompt)

CORS block on `https://www.2mrrw.com/api/account/state` → failed fetch → state reset / re-fetch loop → React Error #185.

## Fixes applied

| Fix | Status | Notes |
|-----|--------|-------|
| **1. Relative `/api/account/state` URL** | Already in tree | `AuthContext` uses `fetch("/api/account/state", …)` — no `https://www.2mrrw.com` builder found in `src/`. |
| **2. Fetch loop guard** | **Shipped** `a636c18` | `accountStateFetchingRef` dedupes in-flight calls; `try/catch` logs network/CORS failures without clearing entitlements. |
| **2b. Session bootstrap loop** | Prior `bbe2161` | Empty-deps mount effect, refs for auth callbacks, `complete-profile` once-per-verify guards. |
| **3. Supabase allowed URLs** | **Manual** | Dashboard → Authentication → URL Configuration (see blockers below). |

## Build

- `artist-platform`: `npm run build` — **pass** (local + Vercel production build)
- `2MRRW-Control-System`: **not modified**

## Deploy

- Production alias: **https://www.2mrrw.com**
- Deployment: `dpl_HUqc4w7sBGGywXYSpeMGzmVGZ6x7`

## Commits

| SHA | Message |
|-----|---------|
| `bbe2161` | fix(critical): break complete-profile fetch loop and resolve 500 |
| `a636c18` | fix(critical): guard account/state fetch against CORS retry loops |

## Manual follow-up (blockers)

1. **Supabase Auth → URL Configuration** — ensure:
   - `https://www.2mrrw.com`
   - `https://2mrrw.com`
   - `http://localhost:3000`
   - Vercel preview pattern if used (`https://*.vercel.app`)
2. **Vercel env** — `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` must point at the Control System host, **not** `https://www.2mrrw.com` (would cross-origin-fetch CS APIs from the storefront).
3. **Do not** use `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_BASE_URL` for internal API `fetch()` — checkout/email redirects only.

## Verification

After deploy: hard refresh (Cmd+Shift+R), confirm Network tab shows same-origin `/api/account/state` → 200 (or 401 when signed out), no CORS error, no React #185.
