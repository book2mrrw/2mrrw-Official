# Apply R2 CORS policy — Cloudflare dashboard

Bucket: **`2mrrw-media`**

R2 CORS is **not** configurable via `wrangler.toml`. Apply only in the dashboard.

## Steps

1. Sign in to [Cloudflare Dashboard](https://dash.cloudflare.com).
2. Go to **R2 Object Storage** → bucket **`2mrrw-media`**.
3. Open **Settings** → **CORS policy**.
4. Replace the entire policy with the contents of `r2-cors-policy.json`.
5. Click **Save**.
6. Wait ~1 minute for propagation, then run `./verification-curls.sh`.

## Verify in dashboard

| Field | Required value |
|-------|----------------|
| Allowed origins | `https://www.2mrrw.com`, `https://2mrrw.com`, both Vercel preview hosts, `localhost:3000`, `127.0.0.1:3000` |
| Allowed methods | `GET`, `HEAD` |
| Allowed headers | `Range`, `Content-Type`, `Authorization`, `Origin`, `Accept` |
| Expose headers | `Accept-Ranges`, `Content-Length`, `Content-Range`, `Content-Type`, `ETag`, `Last-Modified` |
| Max age | `86400` |

## Related env (not CORS policy)

```
NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-643e4a94e0184b1fabf6522cfbb16f75.r2.dev
```

Do **not** use `pub-992d4f5d…r2.dev` — that host returns **401** regardless of CORS.
