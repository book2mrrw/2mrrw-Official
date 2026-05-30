# Runtime Audit - Current State (20260526 recovery)

Scope:
- `/Users/recharge/artist-platform`
- `/Users/recharge/2MRRW-Control-System`

Method constraints honored:
- Read-only audit (no code edits in target repos)
- Evidence-based only
- Compact checkpointed artifacts with separate raw snippets

---

## 1) Runtime architecture map
See `01-runtime-architecture-map.md`.

## 2) Origin interaction map
See `02-origin-interaction-map.md`.

## 3) Media URL map
See `03-media-url-map.md`.

## 4) Network request map
See `04-network-request-map.md`.

## 5) Console error inventory
See `05-console-error-inventory.md`.

## 6) Failed request inventory
See `06-failed-request-inventory.md`.

## 7) Playback pipeline audit
See `07-playback-pipeline-audit.md`.

## 8) Env audit
See `08-env-audit.md`.

## 9) Deployment audit
See `09-deployment-audit.md`.

## 10) r2.dev dependency audit
See `10-r2dev-dependency-audit.md`.

## 11) Stability score and risks
See `11-stability-score-and-risks.md` (score: **81/100**).

## 12) Next actions ordered
See `12-next-actions-ordered.md`.

---

## Key hard-evidence highlights
- Apex storefront redirects to www (`307`), including API path probe on `/api/account/state` (source: `raw/01-origin-and-cors-probes.txt`).
- Control System CORS OPTIONS probes on `/api/releases` and `/api/sync/stream` reflected both `https://www.2mrrw.com` and `https://2mrrw.com` origins with `204` (same raw source).
- Storefront `/api/library/stream?slug=hourglass` returned `401` unauthenticated, confirming guard behavior is active in runtime (same raw source; route logic at `src/app/api/library/stream/route.js:43`).
- Playback path trace confirms UI -> `AudioContext` -> `fetchLibraryStream` -> `/api/library/stream` -> signed URL generation/caching (sources: `src/lib/music-access.js:206`, `src/context/AudioContext.js:795`, `src/app/api/library/stream/route.js:77`).
- r2.dev remains active in runtime code paths in both repos (see `10-r2dev-dependency-audit.md` and `raw/03-r2dev-references.txt`).

## Unknowns / manual verification required
- Full authenticated browser console capture.
- Authenticated `/api/library/stream` success path and 403/409 branch capture under real account/device states.
