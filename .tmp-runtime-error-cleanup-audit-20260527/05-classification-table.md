# Phase 5 — Classification Table

| Finding | Class | Fix in Phase B? |
|---------|-------|-----------------|
| `POST /api/playback/events` 404 on www | **IMPORTANT** | **Yes** — storefront proxy |
| Same-origin CS rewrite without storefront routes (`/api/hero` etc.) | **IMPORTANT** | No — server-side catalog path works; out of scope |
| Stream 401/403 (`stream-client`) | **CRITICAL** (when hit) | No — auth/entitlement track |
| Audio play() gesture errors | **IMPORTANT** | No — browser policy |
| Printful fetch console.error | **COSMETIC** | No |
| `image_load_failed` pipeline | **COSMETIC** | No |
| Missing local `public/images/*` | **COSMETIC** (dev) | No |
| Preload budget exceeded | **COSMETIC** | No |
| `console.error` in API routes (expected 5xx logging) | **COSMETIC** / ops | No |
