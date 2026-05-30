# Validation Checklist — Phase 4.6

## Build & CI

- [x] `npm run build` — exit 0 (Next.js 16.2.4, Turbopack, ~9.4s)
- [x] No new linter errors on touched files
- [ ] `npm run test:foundation` — not run this session (recommend before deploy)
- [ ] `npm run check:frontend-guardrails` — not run this session

## A1 — Playback progress isolation

- [ ] React Profiler: record 10s playback on `/` — Page commits target <5 (was ~600)
- [ ] React Profiler: GlobalAudioPlayerBar still updates scrubber smoothly
- [ ] Scrubber drag/seek — position syncs correctly
- [ ] MediaSession lock screen position updates (throttled 1s — unchanged)
- [ ] Preview hard-cap at 30s still ends correctly
- [ ] Queue auto-advance on track end
- [ ] CS mode hold preview seek restore
- [ ] Background tab recovery (`usePlaybackRecovery`) saves live position every 5s

## A2 — Page render isolation

- [ ] Play track on home — hero/catalog do not flicker during progress
- [ ] Desktop + mobile mini-player progress bar animates
- [ ] Mini-player play/pause/dismiss works

## A3 — Scroll parallax

- [ ] Mobile 375px: fling scroll home — hero compresses, text fades, no jank
- [ ] Desktop: hero height static at 380px
- [ ] No React commit storm in Performance panel during scroll

## B1/B2 — Code splitting

- [ ] Network tab cold load `/` — ImmersivePreviewModal chunk NOT loaded until modal open
- [ ] Non-admin: CollectorCardAdminPanel chunk absent until account tab (admin only)
- [ ] Open preview modal — chunk loads, modal renders correctly
- [ ] Vault tab — VaultUnlockedRoom lazy chunk loads

## B3 — Deferred fetches

- [ ] Cold load home — no `/api/printful/products` request
- [ ] Cold load home — no `/api/catalog/exclusive-drops` request
- [ ] Switch to Shop — printful fetch fires, products render
- [ ] Switch to Vault — exclusive-drops fetch fires

## C1 — Hero MP4

- [ ] Hero video plays after metadata load
- [ ] Lighthouse LCP — compare to baseline (target −200–800 ms)

## C2 — Video budget

- [ ] Mobile: scroll singles carousel — max 2 carousel videos playing
- [ ] Mobile: carousel in view — hero video pauses; resumes when carousel leaves view
- [ ] Audiovisual section autoplay unchanged (not modified)

## C3 — Ambient blur

- [ ] Mobile 375px: play track with cover — ambient background visible, softer blur
- [ ] Desktop: blur(120px) preserved
- [ ] Scroll FPS while playing — compare to baseline

## Regression smoke

- [ ] Tap play on single — audio starts, no console errors
- [ ] Subscribe button hard nav — still works (unchanged)
- [ ] Gift sheet, donate modal, stripe checkout — open correctly after lazy load
- [ ] iOS Safari background audio + lock screen

## Mobile-first (375px)

- [ ] Browser MCP / real device pass — pending manual QA
- [ ] Safe areas on mini-player + mobile nav unchanged
