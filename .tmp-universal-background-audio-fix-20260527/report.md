# Universal background audio fix — 2026-05-27

## Fix status

| Fix | Status |
|-----|--------|
| FIX 1 — Universal audio session unlock (gesture listeners, Android `load()`, ephemeral iOS ctx) | **DONE** |
| FIX 2 — Audio element attributes (`preload`, `playsInline`, webkit attrs, `crossOrigin`, hidden) | **ALREADY EXISTS** (verified unchanged) |
| FIX 3 — Media Session guard (`"mediaSession" in navigator`) | **DONE** |
| FIX 4 — `public/manifest.json` (`standalone`, `#0a0a0a`, `orientation: any`) | **DONE** (`orientation` was `portrait-primary`) |
| FIX 5 — Visibility handler (`wasPlayingBeforeHideRef`, no pause on hide, 300ms resume, rehydrate) | **DONE** |
| FIX 6 — `public/sw.js` install/activate/KEEP_ALIVE | **DONE** (created) |
| FIX 6b — Keep-alive pings every 20s while playing | **DONE** |
| FIX 7 — SW registration in `src/app/layout.js` | **DONE** |

## Build

- `npm run build` — **PASS** (exit 0)

## Manifest

- `display`: **standalone**
- `background_color` / `theme_color`: **#0a0a0a**
- `orientation`: **any** (was `portrait-primary`)

## Service worker

- `public/sw.js`: **created** (install skipWaiting, activate clients.claim, KEEP_ALIVE message ack)

## Files changed

- `src/context/AudioContext.js`
- `public/manifest.json`
- `public/sw.js` (new)
- `src/app/layout.js`

## Commit

`fix(audio): universal background audio — iOS session unlock, Android Chrome service worker, all browser gesture unlock, manifest orientation`
