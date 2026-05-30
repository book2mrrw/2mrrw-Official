# 13 — Animation GPU (Blur, backdrop-filter, Compositing)

## backdrop-filter usage (repaint-heavy on Safari)

**globals.css** — extensive blur stack:
- L194–195: `backdrop-filter: blur(8px)` (nav/shell)
- L644–645: `blur(10px)`
- L1092–1093: `blur(12px)`
- L1139–1140: `blur(16px)`
- L1855–1856: `blur(28px) saturate(1.15)` — heavy
- L2195: `blur(40px)`

**Comment in globals.css L197:** "avoid animating backdrop-filter in parallel (repaint recursion)" — awareness present.

## Animated backdrop-filter (high risk)

**ImmersivePreviewModal.js:**
- L568–570: transitions `backdrop-filter` between blur(7px) and blur(0px)
- L661–662, L899–900, L942: blur(12px) on controls

Animating backdrop-filter forces full-layer recomposite each frame.

## filter: blur on video/images

| Location | Filter | Size |
|----------|--------|------|
| `AmbientPlaybackBackground.js` L22 | blur(120px) + saturate | full viewport |
| `globals.css` L475 | blur(72px) | decorative |
| `page.js` hero L1787 | blur(0–2px) animated on scroll | full hero |
| `globals.css` L946,968 | blur(28–32px) | atmosphere |

**AmbientPlaybackBackground** applies blur(120px) to **playing video element** — extremely GPU-intensive.

## framer-motion

**page.js:** SPRING_SOFT animations on sheets, modals, hero opacity/scale  
**Transform animations** (opacity, scale, y) — compositor-friendly when isolated  
**Layout animations** — less common; mostly transform-based

## mix-blend-mode / opacity stacks

Hero gradients layered over video (page.js L1792–1793) — multiple full-bleed layers.

## Findings

1. **blur(120px) on video** in AmbientPlaybackBackground — top GPU risk during playback.
2. **Animated backdrop-filter in modals** — jank during open/close on mobile Safari.
3. **globals.css documents blur recursion risk** — ImmersivePreviewModal still animates backdrop-filter.
4. **Hero scroll blur** — small blur values but tied to scroll setState (CPU + GPU).

## Validation checklist

- [ ] Safari Layers panel: promote/demote counts with modal open
- [ ] FPS meter: modal open animation on iPhone
- [ ] Disable ambient blur — A/B FPS during playback
