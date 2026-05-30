# Verification checklist

## Automated

- [x] `npm run build` — success (Next.js 16.2.4)
- [x] Modal open flags only defined in `src/app/page.js` (no duplicate `previewModalOpen` elsewhere)

## Manual — Singles

- [ ] Tap single card → immersive modal opens, audio starts
- [ ] Tap "View More" → sheet opens (no "Try again")
- [ ] Close modal → playback pauses, scroll restored

## Manual — Features

- [ ] Tap feature card (not cart) → feature modal opens
- [ ] Open single then feature → single closes first
- [ ] Credits / view-more sheet on releases with producer metadata

## Manual — Albums

- [ ] Tap album card → V9 album modal + first track queues
- [ ] Tap second track in list → global player switches track
- [ ] Open album while single modal was open → single dismissed
- [ ] Album tracklist sheet (separate control) still works

## Manual — Account

- [ ] Account tab with user missing `name` → shows initial + email, no full-page error

## Manual — Regression

- [ ] Mobile Safari: open/close modal, no stuck body scroll
- [ ] Gift sheet + stripe checkout boundaries unchanged
