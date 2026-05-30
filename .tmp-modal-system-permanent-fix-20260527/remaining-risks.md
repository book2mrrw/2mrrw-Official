# Remaining risks

1. **`setTimeout(onClose, 340)` in modal close animation** — Intentional UX timing for slide-out; not a retry hack. If `onClose` fires after unmount edge cases appear, consider `onTransitionEnd` later (out of scope).

2. **Album modal vs tracklist sheet** — Two album UX paths (`AlbumModal` vs `AlbumTracklistSheet`) remain by design; QA should verify both for same release.

3. **Control system release detail** — `getControlSystemReleaseDetail` still async; modal renders before detail arrives (expected). Failures do not throw into boundary.

4. **Palette extraction** — `useCoverPalette` falls back to default palette on image/video decode failure (does not throw).

5. **Deep links** — `page.js` URL hash handlers call same `open*Modal` helpers; retest `?single=` / feature / album query params after deploy.
