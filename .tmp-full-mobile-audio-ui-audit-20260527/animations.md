# Animations audit

**Audit date:** 2026-05-27  
**Full raw matches:** `raw-animations-grep.txt` (562 lines) in audit folder

## Motion token layer

**File:** `src/styles/motion/tokens.css`

| Token | Value | Reduced motion |
|-------|-------|----------------|
| `--motion-duration-fast` | 0.18s | → 0.01ms |
| `--motion-duration-base` | 0.34s | → 0.01ms |
| `--motion-duration-slow` | 0.48s | → 0.01ms |
| `--motion-press-scale` | 0.97 | → 1 |
| `--motion-modal-backdrop` | base + ease-out | inherited |
| `--motion-modal-sheet` | slow + spring ease | inherited |

## CSS keyframe animations (`globals.css`)

| Name | Duration / easing | Properties animated | Reduced motion |
|------|-------------------|---------------------|----------------|
| `heroTitleGlow` | 2.5s ease-in-out infinite | `text-shadow` | **Yes** — disabled (58–61) |
| `songTitleTurquoisePulse` | 3.2s ease-in-out infinite | `text-shadow` | **Yes** (83–89) |
| `livingScrollDrift` | 14–16s ease-in-out | transform on lyrics lines | **No** dedicated rule |
| `eq-sc` | 0.65s alternate | `scaleY` on EQ bars | **No** |
| `cp` (cart-pulse) | 2.6s ease-in-out | `filter` drop-shadow | **No** |
| `col-glow` | (see globals ~4255+) | filter/glow on collector | partial |

**Jank risk:** `text-shadow` and `filter` animations are not compositor-friendly on low-end mobile.

## Framer Motion (`page.js` and components)

| Location | Pattern | Duration / spring |
|----------|---------|-------------------|
| `page.js` 66–76 | `SPRING_SOFT`, `OVERLAY_FADE`, `SHEET_UP`, `MODAL_CENTER` | stiffness 280–380, damping 32–36; fade 0.22s |
| Mobile cart FAB | `layout` + `animate={{ bottom }}` | spring |
| Tab content | `AnimatePresence` + `motion.div` | tab transitions |
| Modals | `ImmersivePreviewModal` uses CSS transitions on transform, not framer for sheet |

## `ImmersivePreviewModal` JS-driven motion

| Element | Driver | Timing |
|---------|--------|--------|
| Sheet enter/exit | CSS `transform: translateY` | 0.44s cubic-bezier(.22,1,.36,1) open; 0.34s close |
| Backdrop | `background`, `backdrop-filter` | 0.35s ease |
| Cover image fade | inline `transition: opacity .7s` | Scene component |
| Waveform bars | `setTimeout` 70–125ms | `scaleY` inline style, 0.08s CSS transition |
| `useBeat` | timeout chain | 110ms + 380–500ms random |
| Scrub fill | `transition: width .1s linear` | ScrubBar |
| Album mini progress | `transition: width .4s linear` | bottom bar |

**Reduced motion:** modal CSS does not gate sheet slide on `prefers-reduced-motion` (unlike `hero-title-glow`).

## `GlobalAudioPlayerBar` / player

| Animation | File | Notes |
|-----------|------|-------|
| CS hold opacity RAF | `GlobalAudioPlayerBar.js` 409–430 | `requestAnimationFrame` over `HOLD_FADE_MS` (300ms) |
| Skip button scale | `globals.css` 2554–2555 | `transform: scale(0.96)` on `:active` |
| Scrub handle | 2643–2650 | opacity + scale on drag |
| Gift icon spin | inline `giftIconSpin 4s` | referenced in bar |
| `DOUBLE_TAP_MS` | 300ms delay before single-tap | not CSS — gesture timing |

## Player constants (`src/lib/player/constants.js`)

```
PLAYER_SPRING: stiffness 320, damping 34
PLAYER_SPRING_EXIT: stiffness 380, damping 36
HOLD_FADE_MS: 300
RELEASE_FADE_MS: 200
EXPAND_SWIPE_CLOSE_MS: 220
```

## `prefers-reduced-motion` coverage

| Has handling | Missing handling |
|--------------|------------------|
| `hero-title-glow`, `song-title-turquoise-glow` | Immersive modal sheet slide |
| `tokens.css` duration collapse | `useBeat` / waveform timeouts |
| Some globals player rules | framer-motion tab transitions in `page.js` |
| | `eq-sc`, `cart-pulse`, living scroll |

## CSS vs JS driven (summary)

- **CSS:** modal shell, scrub width, hover/active states, typography glows.
- **JS:** waveform fake spectrum, beat pulse on controls, CS hold crossfade, framer page transitions, audio first-listen volume swell (AudioContext `setInterval`).
