# R2 CORS complete — 2026-05-29

**Prompt:** `/Users/recharge/Downloads/cursor-cors-complete.md`  
**Scope:** One R2 CORS policy for all release types (singles, features, albums, mixtapes/EPs) across `digital-assets/`, `images/`, `previews/`, `videos/`; API CORS on `/api/media/*` and `/api/library/*`; no UI/playback/auth rewrites.

---

## Prompt requirements (checklist)

| Requirement | Status |
|-------------|--------|
| R2 policy JSON (6 origins, GET/HEAD, Range + expose headers, MaxAge 86400) | **Documented** in `r2-cors-policy.json`; **live R2 probes PASS** |
| Apply in Cloudflare dashboard only (not wrangler) | **Manual confirm** — `dashboard-steps.md` |
| `/api/media/visual`, `/api/media/preview`, `/api/library/stream` — CORS for all release types | **Code:** shared `media-cors.js`, no per-type branching; **visual** probed for single/feature/album/mixtapes-and-eps |
| Full Allow/Expose header lists on API routes | **Code updated** (working tree); **production** still on partial headers until deploy |
| Range in AllowedHeaders and ExposeHeaders | **R2 live PASS**; **API code** includes full lists after deploy |
| `npm run build` after code changes | **PASS** |
| Report zip | `/Users/recharge/Downloads/cors-complete-20260528.zip` |
| Commit / push / deploy | **Not requested** — changes uncommitted |

---

## Final R2 CORS JSON

See `r2-cors-policy.json` (identical to `docs/reports/r2-cors-policy-recommended.json`).

---

## API route audit

| Route | Release-type branching | CORS helper | Notes |
|-------|------------------------|-------------|-------|
| `/api/media/visual` | None — `normalizeReleaseType()` only for path resolution | `applyMediaCors` on all responses + OPTIONS | All four types use same code path |
| `/api/media/preview` | None — folder/legacy params only | `applyMediaCors` + OPTIONS | Entity folder, not release-type gate |
| `/api/media/playback` | None | `applyMediaCors` + OPTIONS | Analytics POST |
| `/api/library/stream` | None — `resolvePlaybackKey` handles all types | **Added** `applyMediaCors` + OPTIONS (this pass) | Was same-origin-only comment |
| `/api/library` | None | **Added** `applyMediaCors` + OPTIONS (this pass) | Grant/list JSON |

---

## Verification results (curl, 2026-05-29)

Full output: `curl-probes.txt`. Repeat: `./verification-curls.sh`.

### R2 public CDN (`pub-643e4a94…r2.dev`) — **PASS**

| Probe | Result |
|-------|--------|
| `videos/…/hourglass.mp4` GET + Origin | **200**, `Access-Control-Allow-Origin` echoed, full `Expose-Headers` |
| `previews/…/hourglass-preview.mp3` GET | **200**, CORS present |
| `images/…/cover.jpg` GET | **404** but **ACAO + Expose-Headers present** (CORS OK, object missing) |
| `digital-assets/…/audio.wav` GET | **404** with CORS headers (object missing) |
| Video Range `bytes=0-1023` | **206** + `Content-Range` + expose headers |
| OPTIONS preflight | **204**, `Allow-Methods: GET, HEAD`, `Allow-Headers` includes Range |
| Origins apex + localhost | **PASS** |

### Production API (`https://www.2mrrw.com`) — **partial until deploy**

| Probe | Result |
|-------|--------|
| `/api/media/preview` OPTIONS/GET | **PASS** origin echo; headers still `Range, Content-Type` only (deploy needed for full list) |
| `/api/media/visual` single/feature/album/mixtape | **200/302** + CORS on all four `releaseType` values |
| `/api/library/stream` OPTIONS | **204** but **no CORS headers** on production (pre-deploy) |
| `/api/library/stream` GET | **401** without session (expected); no CORS on production yet |

After deploying working-tree changes, re-run probes; expect:

```
Access-Control-Allow-Headers: Range, Content-Type, Authorization, Origin, Accept
Access-Control-Expose-Headers: Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified
```

on all `/api/media/*` and `/api/library/*` responses when `Origin` is allowlisted.

---

## Code changes (this pass)

| File | Change |
|------|--------|
| `src/lib/server/media-cors.js` | Full Allow/Expose header lists; comment scope includes `/api/library/*` |
| `src/app/api/library/stream/route.js` | OPTIONS + `applyMediaCors` on every response |
| `src/app/api/library/route.js` | OPTIONS + `applyMediaCors` on every response |

Prior commit `90c9941` already wired `/api/media/*` to `media-cors.js` (partial headers).

---

## Commit status

- **HEAD:** `90c9941495df152c97ba5e908bf85ca560db5718` (includes initial `media-cors.js` + `/api/media/*`)
- **This pass:** uncommitted working tree (library routes + expanded headers)
- **Deploy:** not run (prompt did not request)

---

## Manual action

Re-confirm dashboard policy matches `r2-cors-policy.json` even though live R2 probes already match required behavior.
