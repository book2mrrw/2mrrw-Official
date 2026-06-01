# Phase 5.1.5 — Recovery Callback Validation

**Date:** 2026-05-30  
**Promoted baseline:** `bac9eb7` / `foundation-stable-v3`

## Recovery workflow dry-run

```bash
npm run recover:foundation -- --dry-run
```

**Result:** PASS — workflow completes without mutations.

Steps validated:
1. Git checkout target (`0264124` via anchor / `frontend-stable-foundation`)
2. Lockfile restore (dry-run)
3. `npm ci` (dry-run)
4. Env validation (warn on missing PostHog keys — non-blocking)
5. Guardrails + smoke (dry-run)
6. Build (dry-run)
7. Deploy prep (skipped)

## Subsystem path validation (no code changes)

Static presence checks at promoted baseline confirm recoverable surfaces:

| Subsystem | Critical paths | Status |
|-----------|----------------|--------|
| **Playback** | `src/context/AudioContext.js`, `src/components/GlobalAudioPlayerBar` (via layout), `src/app/api/**/stream*` routes | ✅ Present |
| **Entitlements** | `src/context/AuthContext.js`, `src/app/api/account/state` | ✅ Present |
| **Queue** | `src/media/preloader/useQueuePreloader.js`, `src/media/imagePipeline/priorityQueue.js` | ✅ Present |
| **Storefront** | `src/app/page.js`, subscribe/success/gift routes, Stripe providers in `layout.js` | ✅ Present |
| **Audiovisual** | Cinematic shell `page.js`, `data-cinematic-video` guardrails, vault/media hooks | ✅ Present |

## Smoke test critical path coverage

`test:foundation` confirms at promoted HEAD:

- `src/app/page.js` — cinematic storefront shell
- `src/app/layout.js` — AuthProvider → AudioProvider → StripeProvider
- `src/context/AuthContext.js` — entitlement hydration
- `src/context/AudioContext.js` — global playback
- Supabase client/server + middleware
- Recovery scripts (`recover-foundation.mjs`, `verify-foundation.mjs`)

## Functional behavior assertion

- **No application code modified** in this phase
- Platform tree at `bac9eb7` includes Phase 4.8 playback fast-path (`23f77e4`) and prior unified playback pipeline
- Recovery promotion is metadata + pin discipline only; runtime behavior identical to pre-sync HEAD platform state (`e8402d8` platform code + recovery doc commit)

## Callback verdict

**PASS** — Recovery can restore playback, entitlement, queue, storefront, and audiovisual subsystems from promoted baseline via standard recovery commands.

## Recommended operator follow-up

1. `npm run recover:stable -- --force` — align local `frontend-stable-foundation` to anchor (local only)
2. Push tags when team approves remote promotion
3. Run full `npm run verify:foundation` (without `--quick`) before next production deploy
