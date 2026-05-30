# Deploy CORS — 2026-05-29

## Commit
- **Hash:** `85a79d22961acadaa6522add4cd4afa2ee9e04d9` (short: `85a79d2`)
- **Message:** fix(cors): expand media-cors headers; add CORS to library stream and library routes
- **Files:** `src/lib/server/media-cors.js`, `src/app/api/library/stream/route.js`, `src/app/api/library/route.js`

## Build
- Local: `npm run build` — success

## Deploy
- **Production alias:** https://www.2mrrw.com
- **Deployment URL:** https://artist-platform-rgd5m84ac-eellian-morrows-projects.vercel.app
- **Inspect:** https://vercel.com/eellian-morrows-projects/artist-platform/AWc7ym2nnS6MUDDMxjJf4BUyWNFW
- **Deployment ID:** `dpl_AWc7ym2nnS6MUDDMxjJf4BUyWNFW`

## Verification summary (www.2mrrw.com)

| Probe | Result |
|-------|--------|
| `/api/library/stream` OPTIONS | 204 — full Allow/Expose CORS headers |
| `/api/library/stream` GET (no auth) | 401 — CORS headers present |
| `/api/media/preview` OPTIONS/GET | CORS headers on both |
| `/api/media/visual` (single, feature, album, mixtapes-and-eps) | 200 — full Allow/Expose on all four |

Full curl output: `curl-results.txt`

## Notes
- R2 probes: videos/previews OK; images/digital-assets sample paths 404 (object missing) but CORS headers still returned on R2.
