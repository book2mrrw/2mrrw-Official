# Runtime Error Cleanup Audit — 2026-05-27

**Repo:** artist-platform  
**Control System reference:** `2MRRW-Control-System/src/app/api/playback/events/route.ts`  
**Scope:** Post-stabilization console/network noise; playback lifecycle protected.

## Executive summary

The dominant **repeatable** storefront Network error was `POST https://www.2mrrw.com/api/playback/events` → **404**. Telemetry only — does not stop audio. Root cause: browser same-origin rewrite (`buildControlSystemUrl`) with no storefront route. **Fix:** thin POST proxy on the storefront. Post-fix production probe: **200**.

## Audit phases 1–6 (summary)

| Phase | Doc | Summary |
|-------|-----|---------|
| **1** | `01-network-console-inventory.md` | Grep + curl inventory; classified Network/console noise; pre-fix POST www `/api/playback/events` → **404**, CS direct → **200**. |
| **2** | `02-playback-events-route.md` | Storefront route absent; CS `route.ts` validates schema and records durable analytics; client sends via same-origin `/api/playback/events`. |
| **3** | `03-image-failures.md` | `image_load_failed` from `ImagePipeline`; catalog cover paths; placeholders — not playback-blocking. |
| **4** | `04-preload-prefetch.md` | Preload/prefetch touchpoints (`ImagePipeline`, `MediaPreloader`, `AudioContext` warmers); cosmetic bandwidth, not entitlement. |
| **5** | `05-classification-table.md` | CRITICAL vs IMPORTANT vs COSMETIC; playback/events 404 = IMPORTANT fixable noise. |
| **6** | `06-hardening-plan.md` | Ordered low-risk actions: Phase B proxy first; images/Printful/CS GET env as follow-ups. |

## Fixes applied

| Change | Detail |
|--------|--------|
| **Storefront playback/events proxy** | New `src/app/api/playback/events/route.js` — `OPTIONS` → 204; `POST` forwards body, session header, and cookies to stable Control System origin; returns upstream status (502 if CS unreachable). |
| **Telemetry logging** | `src/lib/control-system/playback.js` — failed telemetry: `console.debug` in development only; never throws. |
| **Out of scope** | `AudioContext.js` playback lifecycle, images, preload, Printful, stream entitlement path. |

Supporting detail: `07-fix-summary.md`.

## Ship record

| Item | Value |
|------|--------|
| **Commits** | `e0ca4c3`, `1d7bd04`, **`9339e86`** (`fix(runtime): pin playback events proxy to stable CS origin`) |
| **Production deploy** | `dpl_JDLPREgNyp5Uhurx1PsMHTgioh2h` |
| **Post-fix probe** | `POST https://www.2mrrw.com/api/playback/events` → **200** (JSON; was **404** pre-fix) |
| **Build** | `npm run build` — success; route `ƒ /api/playback/events` |

## Sections (full artifacts)

| File | Topic |
|------|-------|
| `01-network-console-inventory.md` | Grep + curl probes + initiator map |
| `02-playback-events-route.md` | Storefront vs CS route analysis |
| `03-image-failures.md` | image_load_failed, catalog paths |
| `04-preload-prefetch.md` | Preload mechanisms |
| `05-classification-table.md` | CRITICAL / IMPORTANT / COSMETIC |
| `06-hardening-plan.md` | Ordered low-risk actions |
| `07-fix-summary.md` | Phase B implementation + verification |

## Playback-critical vs noise

- **Playback-critical:** `/api/library/stream` auth failures, audio element errors, entitlement state.
- **Noise (addressed):** `/api/playback/events` 404 via storefront proxy.
- **Noise (follow-up):** Printful shop fetch, image pipeline rejects on bad covers, client CS GET same-origin 404s without env URL.
