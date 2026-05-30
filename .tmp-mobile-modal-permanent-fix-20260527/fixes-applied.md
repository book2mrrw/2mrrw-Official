# Fixes Applied

**Commit:** `db88530` — `fix(modal): permanent mobile modal and account tab crash fixes`

## Files changed (4)

| File | Changes |
|------|---------|
| `src/app/page.js` | Safe account display helpers; account tab uses `accountDisplayInitial` / `accountDisplayName`; circle byline fallback; `ModalErrorBoundary` around preview/feature/album modals |
| `src/components/preview/ImmersivePreviewModal.js` | Slug/id guard on default export; `AlbumModal` wrapper + `AlbumModalView`; safe `buildTheme`; empty track list UI; track list sync effect |
| `src/system/errors/ModalErrorBoundary.js` | Recoverable `ModalErrorFallback` with Try again / Close; dev-only `console.error` once; no auto-dismiss-only toast |
| `src/system/errors/FallbackRenderer.js` | New `ModalErrorFallback` component |

## Account tab

- Avatar initial: `((accountDisplayName \|\| "?")[0] \|\| "?").toUpperCase()` with name → email → `"Member"` chain.
- Display name and email guarded (`email \|\| "—"`).
- Circle post counts match `accountCircleByline` (email when name empty).

## Modals

- `ImmersivePreviewModal`: early `null` if missing `slug` and `id`.
- `AlbumModal`: wrapper returns `null` without hooks violation; inner view handles empty tracks.
- `page.js`: each immersive modal wrapped in `ModalErrorBoundary` with `stackId`, `onClose`, `resetKey`.

## Error handling

- Modal errors no longer require `NEXT_PUBLIC_DEBUG`.
- Production: `clientLog` telemetry + optional dev console once.
- User can retry (reset boundary) or close (calls `onClose`, clears modal stack).

## Intentionally unchanged

- V9 visual design (layout, motion, palette extraction).
- `resolveTrackAccess` / admin entitlements.
- Hero, navigation, `AuthContext`, global audio engine behavior.
