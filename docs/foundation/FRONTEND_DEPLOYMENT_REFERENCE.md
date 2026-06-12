# Frontend Deployment Reference

Operational reference for deploying and validating the official frontend foundation.

## Production URLs

| Role | URL |
|------|-----|
| **Primary production alias** | https://artist-platform-silk.vercel.app |
| Legacy / Twitch embed parent | https://2mrrw-official.vercel.app |

`src/app/page.js` registers Twitch parent domains: `2mrrw-official.vercel.app`, `localhost`, `127.0.0.1`.

## Deploy commands

| Command | Purpose |
|---------|---------|
| `npm run build` | Local production build verification |
| `npm run deploy:prod` | `vercel deploy --prod --yes` |
| `npm run dev` | Local development server |

## Environment (frontend-relevant, no secrets)

Copy from `.env.example`. Required public vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (checkout UI)
- `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL` — e.g. control system on Vercel

Server-only vars (API routes, not exposed to client bundles) include Stripe secret, Supabase service role, webhook secrets — never commit `.env.local`.

## Build output

- Next.js App Router default output (`.next/`)
- Static assets: `public/videos/*`, `public/audio/*`, images
- Middleware: `middleware.js` — Supabase session refresh; Stripe webhook paths bypassed

## Post-deploy smoke (manual)

1. Load `/` — hero video/MP4, navigation, modals open/close
2. Guest flow — account state loads without console auth errors
3. Audio bar — play/pause on a preview track
4. `/subscribe` — Stripe elements render
5. Check network: `/api/account/state` returns 200 for signed-in/guest session

## Rollback

1. Identify last good deployment in Vercel dashboard for `artist-platform-silk`
2. Promote previous deployment OR redeploy from recovery commit `ce6ae20e34fd7e1bf1278d5f6da5c07fb7fee15c`
3. Run `npm run test:foundation` on that commit before promoting

See `FRONTEND_DEPLOYMENT_RULES.md` for governance.
