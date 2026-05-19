# Current Frontend System State

Snapshot as of foundation lock **2026-05-19** at operational commit `8496fa7178845783dab7441598af4ab68ef73d74` on branch `main` (UI origin `ce6ae20` via `foundation-stable-v1`).

## Rendering model

| Layer | Behavior |
|-------|----------|
| Root layout | Server Component — wraps client providers |
| `page.js` | `"use client"` — full SPA-style cinematic shell inside Next App Router |
| Secondary pages | `subscribe`, `success`, `gift/[token]` — focused flows |
| Hydration | Client mount effects for video autoplay, audio, modals; ESLint warns on set-state-in-effect by design |

## Media rendering

- **Hero / backgrounds:** MP4 from `/videos/*` and control-system resolved URLs
- **Release artwork:** `ReleaseArtwork` — prefers motion MP4 (`data-cinematic-video="true"`), falls back to still cover on error
- **Vault / control system:** Hooks `useVaultMedia`, `useMediaAssets`, `useHeroMedia`, `useAudioVisuals` — API-backed with local fallbacks in page payloads
- **Global audio:** `AudioContext` + `GlobalAudioPlayerBar` + `ModalAudioPlayer`; playback events to control-system API
- **Twitch embed:** Parent param whitelist includes `2mrrw-official.vercel.app`

## Auth & Supabase integration

| File | Role |
|------|------|
| `src/lib/supabase/client.js` | `createBrowserClient` for client usage |
| `src/lib/supabase/server.js` | `createServerClient` + cookies for RSC/API |
| `src/lib/supabase/middleware.js` | Session refresh |
| `middleware.js` | Applies `updateSession`; skips Stripe webhook paths |
| `src/context/AuthContext.js` | Single account state via `/api/account/state` |

**Pattern:** User + permissions model. Guest is an entry method, not a permanent identity class. No manual vault/subscriber toggles in UI.

## Sync behavior

Located in `src/hooks/sync/`:

- `useSyncEngine` — debounced refetch (250ms default), fallback data, version counter
- `useRealtimeEvents` — event-type filtered resync
- `useConnectionHealth`, `useResync` — connectivity and manual resync helpers

Account-wide refresh: `AuthContext.refreshAccountState()` after purchases, login, etc.

## Commerce / payments (frontend surface)

- `src/app/StripeProvider.js` — Elements wrapper
- `src/components/payments/CheckoutForm.js` — Stripe Payment Element
- QR: `qrcode.react` for collector/share flows in page

## Control system coupling

- `src/lib/control-system/*` — account, media, releases, vault, playback, circle
- Client hooks under `src/hooks/releases/*` and `src/hooks/media/*` fetch normalized data

## ESLint stabilization

`eslint.config.mjs` downgrades to **warn**:

- `react-hooks/set-state-in-effect`
- `react-hooks/static-components`
- `react/no-unescaped-entities`

Rationale: cinematic page uses intentional mount-time effects; refactors must not change visuals.

## Active guardrails

- Exact pins in `package.json`
- `.cursor/rules/frontend-foundation.mdc`
- `scripts/check-frontend-guardrails.mjs`
- `scripts/frontend-foundation-smoke.mjs`

## Known constraints

- `page.js` is large by design — extract leaves only, not layout rewrites
- Production media migration toward Supabase signed URLs is ongoing; public `/videos` remains for baseline parity
- Do not treat UI state as authorization source
