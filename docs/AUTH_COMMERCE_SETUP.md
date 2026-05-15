# Auth, Commerce & Library Setup

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/migrations/001_auth_commerce_library.sql` in the SQL editor.
3. Enable **Email** auth (and **Phone** if you want OTP).
4. Create a **private** storage bucket `digital-assets` and upload audio files matching `storage_path` in the catalog.
5. Copy URL, anon key, and service role key into `.env.local`.

## 2. Stripe

1. Create products/prices are resolved server-side from your DB — no Stripe Product IDs required for digital items.
2. Add webhook endpoint (canonical — use this URL only):
   `https://2mrrw-official.vercel.app/api/webhook`
3. Events: **`payment_intent.succeeded`** (required for in-page checkout entitlements)
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET` in Vercel **Production** env (and `.env.local` for local CLI).
5. Legacy paths `/api/webhooks/stripe` and `/api/stripe/webhook` still work but should be removed from Stripe Dashboard.

## 3. Seed catalog

```bash
curl -X POST http://localhost:3000/api/admin/seed-products \
  -H "x-seed-secret: YOUR_ADMIN_SEED_SECRET"
```

## 4. Local dev

```bash
cp .env.example .env.local
# fill values
npm run dev
```

Use Stripe CLI for webhooks:

```bash
stripe listen --forward-to localhost:3000/api/webhook
```

## 5. Flow

- **Sign up / sign in** → Supabase session (cookies via middleware).
- **Checkout** → `POST /api/create-payment-intent` → in-page Stripe modal → `payment_intent.succeeded` webhook (or `POST /api/purchase/confirm`) grants `library_items`.
- **Library** → `GET /api/library`; downloads via `GET /api/library/stream?slug=...`.
- **QR access** → `GET /api/access/[token]` (hashed tokens in `access_tokens`).

## 6. page.js integration

The main UI uses `AuthProvider` for session, Stripe Checkout redirect, and server-backed library — localStorage purchases are no longer the source of truth when signed in.
