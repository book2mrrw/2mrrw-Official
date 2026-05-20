# Frontend Foundation Baseline

**Status:** OFFICIAL — PRIMARY RECOVERY ANCHOR  
**Established:** 2026-05-19  
**Purpose:** Freeze the current cinematic frontend as the reproducible, deployable, recoverable baseline.

## Anchor identifiers

| Field | Value |
|-------|-------|
| Git commit (HEAD) | `undefined` |
| Git branch | `main` / `frontend-stable-foundation` |
| Commit message | chore(foundation): sync recovery-anchor metadata to e13b192 |
| Commit date | 2026-05-19 19:24:27 -0500 |
| UI origin (immutable) | `foundation-stable-v1` → `undefined` |
| Operational tag | `foundation-stable-v3` → same commit as HEAD |
| Prior operational (historical) | `foundation-stable-v2` → `undefined` (same tree as v3) |

## Production deployment

| Alias | URL |
|-------|-----|
| Primary production | https://artist-platform-silk.vercel.app |
| Legacy / embed parent | https://2mrrw-official.vercel.app |

Deploy command (local): `npm run deploy:prod` → `vercel deploy --prod --yes`

## Pinned frontend stack (package.json)

| Package | Exact version |
|---------|---------------|
| next | 16.2.4 |
| react | 19.2.4 |
| react-dom | 19.2.4 |
| framer-motion | 12.38.0 |
| @supabase/ssr | 0.10.3 |
| @supabase/supabase-js | 2.105.4 |
| @stripe/react-stripe-js | 6.2.0 |
| @stripe/stripe-js | 9.2.0 |
| qrcode.react | 4.2.0 |
| stripe (server SDK, shared lockfile) | 22.0.2 |

### Dev / tooling pins

| Package | Exact version |
|---------|---------------|
| @tailwindcss/postcss | 4.2.2 |
| tailwindcss | 4.2.2 |
| eslint | 9.39.4 |
| eslint-config-next | 16.2.4 |
| vercel (CLI) | 54.1.0 |

Lockfile: `package-lock.json` (lockfileVersion 3). All production-relevant deps use **exact** versions (no `^` or `~`).

## Architectural snapshot

- **Framework:** Next.js 16 App Router (`src/app/`)
- **Primary UI:** Client component monolith `src/app/page.js` — cinematic shell, modals, releases, vault, community, commerce UI
- **Root layout:** `src/app/layout.js` — `AuthProvider` → `AudioProvider` → `StripeProvider` → children + `GlobalAudioPlayerBar`
- **Auth / entitlements:** `AuthContext` hydrates from `GET /api/account/state` (no UI-side permission grants)
- **Supabase:** `@supabase/ssr` — `src/lib/supabase/client.js` (browser), `server.js` (RSC/API), `middleware.js` + root `middleware.js` session refresh
- **Sync:** `src/hooks/sync/*` — debounced fetch + realtime event resync
- **Media:** MP4 loops via `<video data-cinematic-video="true">`, public `/videos/*`, vault/control-system signed paths via API
- **Motion:** `framer-motion` + `useReducedMotion` for accessibility

## Routes (App Router pages)

| Route | File |
|-------|------|
| `/` | `src/app/page.js` |
| `/subscribe` | `src/app/subscribe/page.js` |
| `/success` | `src/app/success/page.js` |
| `/gift/[token]` | `src/app/gift/[token]/page.js` |

API routes under `src/app/api/*` serve account state, commerce, vault, community, signals, and media playback.

## Stabilization protections (active)

1. Exact dependency pinning in `package.json`
2. Cursor rules: `.cursor/rules/platform-architecture.mdc`, `.cursor/rules/frontend-foundation.mdc`
3. ESLint pragmatic overrides in `eslint.config.mjs` (hooks/static-components as warn — avoids breaking cinematic mount effects)
4. Foundation docs under `docs/foundation/`
5. `npm run check:frontend-guardrails` — risky pattern scan
6. `npm run test:foundation` — smoke validation
7. Protected local branches (see `FRONTEND_RECOVERY_PROTOCOL.md`)

## What this baseline is NOT

- Not a license to redesign UI without explicit approval
- Not a frozen backend — API and Supabase layers may evolve if UX is preserved
- Not a substitute for Vercel/env configuration — see `FRONTEND_DEPLOYMENT_REFERENCE.md`

## Verification commands

```bash
npm run lint
npm run build
npm run test:foundation
npm run check:frontend-guardrails
git diff --check
```

Record results in `FRONTEND_FOUNDATION_REPORT.md` after each foundation audit.
