# Feature Isolation

Modular boundaries for AI and human development. **Goal:** change one capability without destabilizing the cinematic foundation.

Recovery and verify remain centralized — see [`../foundation/FRONTEND_RECOVERY_PROTOCOL.md`](../foundation/FRONTEND_RECOVERY_PROTOCOL.md) and `npm run verify:foundation`.

## Isolation principles

1. **Bounded files** — each module lists primary touch surfaces; stay inside unless scope expands.
2. **Leaf extraction** — prefer new files under `src/components/`, `src/lib/`, `src/hooks/` over `page.js` surgery.
3. **API boundary** — feature logic that affects entitlements lives in `/api/*` + Supabase, not client overrides.
4. **No cross-module drive-by edits** — fixing Vault must not refactor Checkout in the same pass unless explicitly scoped.

## Feature modules

### Vault Engine

| Layer | Paths |
|-------|-------|
| UI | `src/components/vault/VaultUnlockedRoom.jsx` |
| Data | `src/app/api/public/vault/route.js`, `src/lib/control-system/*` vault helpers |
| Hooks | `src/hooks/media/*`, vault-related hooks in page |
| Page integration | `page.js` — **slot only**; inject props, do not redesign surrounding layout |

**Scope examples:** vault pricing display, section gating, unlock messaging.  
**Out of scope:** hero, cart, subscribe page, global nav.

### Mobile Modal / Mobile Shell

| Layer | Paths |
|-------|-------|
| Primary | `page.js` regions tagged `{/* ── MOBILE UI ── */}`, `isMobile` branches, mobile cart drawer |
| Related | `NotificationCenterPanel.js` (`isMobile` layout props) |

**Scope examples:** bottom sheet behavior, touch padding, mobile checkout button stack.  
**Rule:** mobile-only tasks must not alter desktop layout — see [`MOBILE_FIRST_DEVELOPMENT.md`](MOBILE_FIRST_DEVELOPMENT.md).

### GLYPHS / Brand typography

| Layer | Paths |
|-------|-------|
| Primary | Hero `2MRRW` treatment, letter-spacing, pulse animation in `page.js` |
| Reference | [`DESIGN_LANGUAGE_PRESERVATION.md`](DESIGN_LANGUAGE_PRESERVATION.md) |

**Scope examples:** glyph animation tuning, subscriber badge typography.  
**Out of scope:** color system-wide retheme, nav structure changes.

### Subscribe flow

| Layer | Paths |
|-------|-------|
| Primary | `src/app/subscribe/page.js` |
| API | subscription session routes under `src/app/api/` |

**Out of scope:** in-page cart modal (unless user links flows explicitly).

### Cart + Checkout

| Layer | Paths |
|-------|-------|
| Cart state | `page.js` cart hooks and drawers |
| Checkout UI | `src/components/payments/CheckoutForm.js`, checkout modal region in `page.js` |
| Server | `src/app/api/checkout/*`, Stripe webhook handlers |

**Isolation:** payment intent creation and fulfillment stay server-side; UI only reflects confirmed state.

### Auth + account state

| Layer | Paths |
|-------|-------|
| Client | `src/context/AuthContext.js` |
| Server | `/api/account/state`, guest session, library routes |
| Middleware | `middleware.js`, `src/lib/supabase/middleware.js` |

**Never isolate by faking permissions in UI** — always sync from API.

### Playback / audio

| Layer | Paths |
|-------|-------|
| Global | `AudioContext`, `GlobalAudioPlayerBar.js` |
| Modal | `ModalAudioPlayer.js` |
| APIs | control-system playback routes |

### Cinematic / Hero (foundation shell)

| Layer | Paths |
|-------|-------|
| Primary | `src/app/page.js` — hero, backgrounds, `ReleaseArtwork`, `data-cinematic-video` |

**Highest protection.** Work here only with explicit UI approval. Prefer [`VISUAL_CHECKPOINT_WORKFLOW.md`](VISUAL_CHECKPOINT_WORKFLOW.md) before and after.

### Sync engine

| Layer | Paths |
|-------|-------|
| Hooks | `src/hooks/sync/*` |

Safe for debounce/timing hardening without visual change.

### Notifications (launch)

| Layer | Paths |
|-------|-------|
| UI | `src/components/account/NotificationCenterPanel.js` |

## Cross-module dependencies

```mermaid
flowchart LR
  subgraph protected [Protected shell]
    Page[page.js shell]
    Hero[Hero / GLYPHS]
    Nav[Navigation]
  end
  subgraph features [Isolated features]
    Vault[Vault Engine]
    Mobile[Mobile Modal]
    Cart[Cart / Checkout]
    Audio[Playback]
  end
  subgraph backend [Backend truth]
    API[/api/account/state]
    SB[(Supabase)]
  end
  Vault --> Page
  Mobile --> Page
  Cart --> Page
  Audio --> Page
  API --> SB
  Page --> API
```

## When isolation fails

1. Run `node scripts/check-scoped-changes.mjs` to see protected-path drift.
2. Use selective restore for the regressed module — [`SELECTIVE_RESTORATION_WORKFLOW.md`](SELECTIVE_RESTORATION_WORKFLOW.md).
3. Escalate to `npm run recover:foundation` only if multiple modules or dependencies are corrupted.
