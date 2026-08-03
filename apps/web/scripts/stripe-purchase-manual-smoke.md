# Stripe purchase → library → stream (manual smoke)

Use Stripe **test mode** keys on a preview deployment or local dev with webhook forwarding.

## Prerequisites

- `STRIPE_SECRET_KEY` (sk_test_…)
- `STRIPE_WEBHOOK_SECRET` from `stripe listen --forward-to localhost:3000/api/webhook`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_…)
- Entitled test user session (guest cookie or Supabase auth)
- Product slug with R2 `storage_path` (e.g. `hour-glass-digital`)

## Steps

1. Start storefront: `npm run dev`
2. Forward webhooks: `stripe listen --forward-to http://localhost:3000/api/webhook`
3. Open release shop page → checkout with test card `4242 4242 4242 4242`
4. Confirm webhook delivered (`checkout.session.completed` or `payment_intent.succeeded`)
5. Verify DB:
   - `library_items` row for user + product
   - `entitlements` active row (if migration applied)
6. Stream gate:
   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" \
     -H "Cookie: $E2E_SESSION_COOKIE" \
     "http://localhost:3000/api/library/stream?slug=hour-glass-digital&redirect=1"
   ```
   Expect `302` (redirect to signed R2 URL) or `200` JSON with `url`.

## Automated partial checks

```bash
E2E_SUPABASE_URL=... E2E_SUPABASE_SERVICE_ROLE_KEY=... \
E2E_USER_ID=... E2E_PRODUCT_SLUG=hour-glass-digital \
node scripts/test-library-stream-e2e.mjs
```

Optional HTTP smoke (preview/prod):

```bash
E2E_STREAM_BASE_URL=https://artist-platform-silk.vercel.app \
E2E_PRODUCT_SLUG=hour-glass-digital \
E2E_SESSION_COOKIE='guest_session=...' \
node scripts/test-library-stream-e2e.mjs
```
