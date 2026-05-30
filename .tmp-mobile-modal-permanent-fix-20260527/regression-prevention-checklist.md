# Regression Prevention Checklist

## Code patterns

1. **Never index `[0]` on user display fields** without a fallback chain:  
   `(name?.trim() || email?.split("@")[0] || "?")[0]`
2. **Reuse `accountDisplayName` / `accountDisplayInitial`** anywhere account UI shows name or avatar (nav + tab + cart sidebar).
3. **New modals on `page.js`** must wrap content in `ModalErrorBoundary` with `stackId`, `onClose`, and `resetKey`.
4. **Modal entry components** should validate `slug` or `id` before rendering hook-heavy trees (wrapper pattern if guard is before hooks).

## Review gates

- [ ] PR touches `page.js` account tab → grep for `.name[0]` and unsafe `currentUser.name` display.
- [ ] PR adds modal → confirm boundary + `registerModal` / `unregisterModal` pairing.
- [ ] PR changes `ImmersivePreviewModal` → run mobile single + album smoke on Safari.
- [ ] `npm run build` in CI before merge to `main`.

## Monitoring

- Watch `boundary_caught` logs with `boundary: "ModalErrorBoundary"` after release.
- Spike in `error.js` full-page errors on `/` should drop for account/modal paths.

## Tests to add later (optional)

- Unit: `accountDisplayInitial` helper with `""`, `undefined`, email-only user.
- Component: `ImmersivePreviewModal` returns null without slug/id.
- E2E: More → Account on mobile viewport with fixture user (no name).
