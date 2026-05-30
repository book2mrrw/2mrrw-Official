# 14 — Layout Stability (CLS Risks)

## Methodology

Static analysis of conditional renders, async data, image/video dimensions. No live CLS measurement.

## Low CLS strengths

- Hero video: fixed `height: mobileHeroHeight` container (page.js L1779)
- Singles cards: explicit `aspectRatio: "1/1"` on video (LatestSinglesStyleRow.js L114)
- CoverArt empty state: explicit width/height props (CoverArt.js L52–64)
- Skeleton components exist: `TrackCardSkeleton`, `ArtworkSkeleton`, etc.

## CLS risk areas

| Risk | File | Mechanism |
|------|------|-----------|
| Catalog load swap | page.js L1847–1849 | Inline singles → API singles swap |
| Auth placeholder → app | AppAuthRoot.js L36–38 | Full viewport placeholder removal |
| GlobalAudioPlayerBar appear | layout.js L48 | Bar mounts when playback starts — bottom inset shift |
| Font loading | globals.css / external fonts | No explicit size-adjust audited |
| Modal open | ImmersivePreviewModal | Body scroll lock may shift layout |
| Tab content height change | page.js | Different tab heights without min-height |
| Printful products load | page.js shop tab | Product grid pop-in |

## Mobile nav safe area

Sheets use `max(32px, env(safe-area-inset-bottom))` — good for home indicator; may cause small shift if safe area computed late.

## Image without dimensions

Some dynamic catalog covers use percentage width without explicit height before load — mitigated by aspect-ratio on card containers.

## Video poster flash

Singles use poster + video — potential flash when video replaces poster if sizes differ.

## Findings

1. **GlobalAudioPlayerBar** — likely CLS when first play starts (verify live).
2. **Catalog API swap** — skeleton present during load (good) but content height may differ from skeleton.
3. **Auth boot placeholder** — intentional; causes one large layout shift at hydration.
4. **No `font-display: optional` audit** on DM Mono / display fonts in modals.

## Validation checklist

- [ ] Lighthouse CLS on mobile production URL
- [ ] Record layout shift sources with `layout-shift` PerformanceObserver
- [ ] First play → measure bottom nav/bar shift
