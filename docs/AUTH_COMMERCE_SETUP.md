# Auth, Commerce & Library Setup

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Run `supabase/migrations/001_auth_commerce_library.sql`, `002_repair_purchases_status.sql` if needed, then `003_guest_gifts_memberships.sql` in the SQL editor.
3. Enable **Email** auth. Users never see a password flow; the server creates hidden guest identities and stores real email + phone in `profiles`.
4. Create a **private** storage bucket `digital-assets` and upload audio files matching `storage_path` in the catalog.
5. Copy URL, anon key, service role key, and `GUEST_SESSION_SECRET` into `.env.local`.

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

- **Entry** → `POST /api/guest/session` with email + phone (+ optional name) creates/retrieves a passwordless guest identity and sets a signed httpOnly cookie.
- **Checkout** → `POST /api/create-payment-intent` → in-page Stripe modal → `payment_intent.succeeded` webhook (or `POST /api/purchase/confirm`) grants `library_items`.
- **Library** → `GET /api/library`; downloads via `GET /api/library/stream?slug=...`.
- **Gifts** → creator calls `POST /api/admin/gifts`; fan opens `/gift/[token]`, enters email + phone, and receives `library_items` with source `gift`.
- **QR access** → `GET /api/access/[token]` (hashed tokens in `access_tokens`).

## 6. page.js integration

The main UI uses `AuthProvider` for passwordless guest identity, the in-page Stripe modal, and server-backed library — localStorage purchases are no longer the source of truth.
