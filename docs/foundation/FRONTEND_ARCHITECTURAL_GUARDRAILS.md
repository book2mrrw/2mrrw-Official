# Frontend Architectural Guardrails

Rules to protect the official foundation during iteration. **Violations require explicit user approval for UI impact.**

## Sacred surfaces (do not redesign)

| Surface | File(s) | Protected behavior |
|---------|---------|-------------------|
| Cinematic shell | `src/app/page.js` | Layout, navigation, modal flows, section order |
| Motion | `page.js` + framer-motion | `AnimatePresence`, layout animations, `useReducedMotion` |
| Video | `ReleaseArtwork`, hero backgrounds | `data-cinematic-video`, muted autoplay, fallback to still |
| Root providers | `layout.js` | Auth → Audio → Stripe ordering |
| Global audio | `AudioContext`, `GlobalAudioPlayerBar` | Persistent player, playback API hooks |

## Allowed changes (without UI redesign approval)

- Bug fixes with **no visible layout change**
- API route / `src/lib/*` hardening
- New leaf components imported into existing slots
- Entitlement correctness via backend + `AuthContext` only
- Docs, pins, guardrail scripts, tests
- ESLint rule tweaks that do not require page.js refactors

## Forbidden without explicit approval

- Rewriting `page.js` structure or navigation model
- Removing framer-motion or replacing with CSS-only redesign
- Bumping `next`, `react`, `react-dom`, `framer-motion`, `@supabase/*`, `@stripe/*`
- Client-side `permissions` / vault / subscription overrides
- `dangerouslySetInnerHTML` for user content
- New local/public-only production media paths (use Supabase signed delivery per platform architecture)
- Disabling middleware session refresh

## Dependency guardrails

- All `package.json` versions **exact** (no `^` / `~`)
- Run `npm ci` in CI and recovery — not open-ended `npm install` on production recovery
- Lockfile must commit with any intentional pin change

## Authorization guardrails

```
Stripe webhook / checkout success
  → Supabase tables
  → /api/account/state
  → AuthContext.applyAccountState
  → UI reflects permissions
```

Never:

```javascript
// ANTI-PATTERN
setPermissions({ vault: true });
localStorage.setItem("entitlement", "vault");
```

## Performance guardrails

- Prefer `videoPreload="metadata"` for grid tiles; avoid eager preload storms
- Debounce sync refetches (`useSyncEngine` default 250ms)
- Do not add blocking sync loops on scroll/mousemove
- Lazy-load heavy modals only if visual parity is proven
- Keep `page.js` extractions **leaf-level** — no new parent wrappers that shift layout

## Automated enforcement

```bash
npm run check:frontend-guardrails
```

Scans for:

- Unpinned dependencies
- Missing foundation docs
- Missing root providers
- Missing `/api/account/state` in AuthContext
- Removed cinematic markers in `page.js`

## Review checklist (PR / self-review)

- [ ] `npm run check:frontend-guardrails` passes
- [ ] `npm run test:foundation` passes
- [ ] `npm run lint` and `npm run build` pass
- [ ] No `page.js` diff unless task is UI-approved
- [ ] No dependency range bumps
- [ ] Visual check: hero, modals, audio bar, subscribe page

## Cursor agent rule

`.cursor/rules/frontend-foundation.mdc` — always applied alongside `platform-architecture.mdc`.
