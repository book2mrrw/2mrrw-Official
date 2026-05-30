# Phase 1 — Network / Console Error Inventory

**Audit date:** 2026-05-27  
**Production probes:** live curl against www.2mrrw.com and 2mrrw-control-system.vercel.app

## Grep scope

| Pattern | Primary hits |
|---------|----------------|
| `playback/events`, `sendControlSystemPlaybackEvent` | `AudioContext.js`, `lib/control-system/playback.js` |
| `console.error` | 50+ API routes, `AudioContext.js`, `AuthContext.js`, `stream-client.js`, `page.js` |
| `image_load_failed` | `ImagePipeline.js:23` |
| `preload` / `prefetch` | `ImagePipeline`, `MediaPreloader`, `page.js`, `AudioContext` CS warmers |
| `buildControlSystemUrl` same-origin | `client.js:40-51` — browser `/api/*` → storefront origin |

## Production probes (curl)

| URL | Method | Status | Body |
|-----|--------|--------|------|
| `https://www.2mrrw.com/api/playback/events` | OPTIONS | **204** | — |
| `https://www.2mrrw.com/api/playback/events` | POST | **404** | Next.js HTML |
| `https://2mrrw-control-system.vercel.app/api/playback/events` | OPTIONS | **204** | CORS preflight OK |
| `https://2mrrw-control-system.vercel.app/api/playback/events` | POST | **200** | `{"data":{...}}` |
| `https://www.2mrrw.com/api/hero` | GET | **404** | (client CS reads use server path or fallback) |
| `https://2mrrw-control-system.vercel.app/api/hero` | GET | **200** | — |
| `https://www.2mrrw.com/images/features/idbu.jpg` | HEAD | **200** | CDN/deployed asset OK |

## Classified runtime errors (browser Network tab)

| # | Error type | Initiator | Severity | User impact | Playback-critical? |
|---|------------|-----------|----------|-------------|-------------------|
| 1 | `POST /api/playback/events` → **404** | `playback.js:57` via `AudioContext.js:598,1396,1820` (`persistPlayback` / seek / replay) | **IMPORTANT** (noise) | None — fire-and-forget analytics | **No** |
| 2 | `[stream-client] library stream 401/403` | `stream-client.js:71` | **CRITICAL** when occurs | No audio / preview fallback | **Yes** |
| 3 | `[account/state] fetch failed` | `AuthContext.js:117` | **IMPORTANT** | Stale entitlements UI | Indirect |
| 4 | `[AUDIO]` play() rejections | `AudioContext.js` (multiple) | **IMPORTANT** | Autoplay / gesture policy | Sometimes |
| 5 | `PRINTFUL FETCH ERROR` | `page.js:880` | **COSMETIC** | Shop shows fallback merch | No |
| 6 | `image_load_failed` (pipeline reject) | `ImagePipeline.js:23` | **COSMETIC** | Cover placeholder / retry | No |
| 7 | Client `fetchControlSystemJson` → www `/api/hero` etc. **404** | `useMediaAssets.js`, hooks using CS in browser | **IMPORTANT** (if called) | Falls back to inline catalog | No for playback |
| 8 | `preload.budget.exceeded` telemetry | `preloadBudget.js:38` | **COSMETIC** | None | No |

## Initiator map (playback telemetry)

```
User play / progress / seek / replay
  → AudioContext.persistPlayback (line ~582-603)
    → fetch("/api/media/playback")     [storefront — exists, 200]
    → sendControlSystemPlaybackEvent   [playback.js — same-origin rewrite → 404]
```

Control System handler: `2MRRW-Control-System/src/app/api/playback/events/route.ts` — Zod schema, durable analytics only; **no entitlement or stream side effects**.
