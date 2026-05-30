# Verification checklist

## Automated

- [x] `npm run build` — pass (local + Vercel prod build)
- [x] All `page.js` `playTrack` / `playQueue` paths go through `toPlaybackTrack` (grep: lines 1018, 1023, 1115, 1151)
- [x] No raw `playTrack({ ...feat })` in preview components

## Manual — Features

- [ ] Guest: tap feature **cover** → modal opens, preview audio within ~2s (WAV may be slower than MP3)
- [ ] Guest: tap feature **▶** on card → plays without opening modal
- [ ] Subscriber/admin: feature plays full stream via `/api/library/stream?slug=i-dont-believe-you` (or `2-heavy`)
- [ ] Modal floating play toggles same `AudioContext` track (no silent duplicate)

## Manual — Albums

- [ ] Guest: open album modal → track 0 plays if title matches a single (e.g. Love Hz → **Hour Glass** → `hour-glass` preview)
- [ ] Guest: album tracklist sheet ▶ on matched track plays preview
- [ ] Entitled: album modal row 2+ calls `playAlbumTracks` with **distinct** slugs when CS/catalog provides them
- [ ] Albums with only non-catalog track titles: no false play (empty `src` filtered — no silent error bypass)

## Manual — Regression

- [ ] Latest Singles carousel + modal unchanged
- [ ] Global player bar visible during modal (expected); toggle works
- [ ] Deep link `?deepLink=feature:i-dont-believe-you` opens feature modal + plays

## Production

- [x] Pushed `main` @ `51af6ff`
- [x] Vercel prod deploy `dpl_6TVL1w5PT4FakprbpU1dqmTnisDj` → https://www.2mrrw.com
