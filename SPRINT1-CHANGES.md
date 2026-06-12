# Sprint 1 — Storefront playback & fulfillment (P1.2–P1.6)

See control repo `SPRINT1-CHANGES.md` for P1.1.

## Files

- `src/lib/playback/resolve-playback-key.js` — canonical R2 key resolution (P1.2)
- `src/lib/playback/normalize-r2-key.js` — prefix normalization
- `src/lib/playback/playback-gate.js` — client gate aligned with account state (P1.4)
- `src/app/api/library/stream/route.js` — entitlement first, 3600s signed GET (P1.2)
- `src/lib/control-system/releases.js`, `media.js` — no public full audio URLs (P1.3–P1.4)
- `src/lib/commerce/fulfill-purchase.js` — collector + vault grants (P1.5)
- `src/lib/commerce/revoke-entitlements.js`, `handle-stripe-webhook.js` — refund parity (P1.6)
