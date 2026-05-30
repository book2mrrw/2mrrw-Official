# 08 Env Audit (names only)

## Enumerated variable names (storefront)
Source files: `artist-platform/.env.example`, `artist-platform/.env.local` (names only extracted).

- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL`
- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ENDPOINT`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_NAME`
- `NEXT_PUBLIC_R2_PUBLIC_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `PRINTFUL_API_KEY`
- `ADMIN_SEED_SECRET`
- `STRIPE_WEBHOOK_SECRET`
- `GUEST_SESSION_SECRET`

## Enumerated variable names (control system)
Source files: `/Users/recharge/2MRRW-Control-System/.env.example`, `/Users/recharge/2MRRW-Control-System/.env.local` (names only extracted).

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CONTROL_SYSTEM_API_URL`
- `STOREFRONT_SYNC_URL`
- `ADMIN_SEED_SECRET`
- `VERCEL_PROJECT_ID`
- `VERCEL_ORG_ID`
- `CONTROL_SYSTEM_ALLOWED_ORIGINS`
- `CONTROL_SYSTEM_FRONTEND_SHARED_SECRET`
- `CONTROL_SYSTEM_ADMIN_API_KEY`
- `CRON_SECRET`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_MEDIA_BUCKET` (deprecated in comments)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `ALLOW_CONTROL_STRIPE_SEED`
- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`
- `CLOUDFLARE_R2_BUCKET_NAME`
- `CLOUDFLARE_R2_ENDPOINT`
- `NEXT_PUBLIC_R2_PUBLIC_URL`
- `VERCEL_OIDC_TOKEN`

## Potentially missing/misaligned runtime vars (name-only risks)
- `NEXT_PUBLIC_R2_PUBLIC_URL` consistency across environments (code warns on mismatch: `src/lib/storage/r2-public-cdn.js:4`, `:29`).
- Storefront stream signing dependencies: `CLOUDFLARE_R2_*` + Supabase admin vars are required for full signed flow (`src/app/api/library/stream/route.js:30`, and route dependencies).
- Control system public-origin config: `CONTROL_SYSTEM_ALLOWED_ORIGINS` governs allowed origin set (`/Users/recharge/2MRRW-Control-System/src/server/http.ts:22`, `:30`).
