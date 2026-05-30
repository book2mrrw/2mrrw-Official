# Verification checklist

## Automated

- [x] `npm run build`

## Manual (production)

- [ ] Home → Features → **I Don't Believe You** ▶ — audio within 2s (guest: preview; subscriber: full)
- [ ] Home → Features → **2 Heavy** ▶ — same
- [ ] Tap feature card → modal opens and playback starts
- [ ] Network: guest preview `GET /api/media/preview?folder=previews/features/i-dont-believe-you/` → 302 WAV
- [ ] Network: entitled `GET /api/library/stream?slug=i-dont-believe-you&redirect=1` → 302 (not 403 JSON)
