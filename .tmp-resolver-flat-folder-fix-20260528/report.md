# Flat entity-folder R2 discovery fix (2026-05-28)

## Architecture enforced

```
domain/category/release-folder/<media-files>
```

Examples: `digital-assets/singles/hour-glass/master.wav`, `images/singles/hour-glass/cover.jpg` — **not** `…/hour-glass/audio/master.wav`.

Mixtape/EP tracks: `digital-assets/mixtapes-and-eps/love-hz-vol-1/01-roll-call/<files>`.

## Files changed

| File | Change |
|------|--------|
| `src/lib/storage/r2.js` | `listR2Objects(prefix, { recursive: false })` default; `Delimiter: '/'` + `isDirectChildObjectKey`; `discoverFileByExtensions` scans direct children only |
| `src/lib/media/entity-resolver.js` | `listEntityFolderObjects` passes `{ recursive: false }` |
| `src/lib/media/canonical-paths.js` | `normalizeToEntityFolder` strips trailing `audio/`, `artwork/`, `video/`, `waveform/` segments from DB paths; doc comment updated |
| `scripts/verify-r2-entity-folders.mjs` | Probe uses `Delimiter: '/'` + direct-child filter (matches runtime) |

## Audited (no code change required)

- `src/lib/playback/resolve-playback-key.js` — already passes entity folder → `resolveAudio` → discovery
- `src/app/api/library/stream/route.js` — uses `resolvePlaybackKey` only
- `src/app/api/media/preview/route.js`, `visual/route.js` — folder param + entity resolvers
- Canonical path builders — already end at release/track folder (no `audio/` subdirs)

## Key behavior change

**Before:** `ListObjectsV2` without delimiter listed all keys under prefix, so discovery could return nested files (e.g. `…/hour-glass/audio/master.wav`).

**After:** Non-recursive listing with `Delimiter: '/'` and `isDirectChildObjectKey` — only keys where the remainder after the folder prefix contains **no** `/`. Nested subfolders are ignored unless `listR2Objects(..., { recursive: true })` is explicitly requested (no playback callers use this).

## Grep / recursive patterns

- No playback code used `recursive: true` or hardcoded `audio.wav` / `artwork.jpg` / `loop.mp4` in `src/`.
- `mkdir(..., { recursive: true })` in unrelated scripts left unchanged.

## Verification

- `npm run build` — **passed** (Next.js 16.2.4)
- Live R2 probe: `node scripts/verify-r2-entity-folders.mjs` (requires `CLOUDFLARE_R2_*` in `.env.local`)

## Not done (per scope)

- No UI / AudioContext changes
- No git commit
