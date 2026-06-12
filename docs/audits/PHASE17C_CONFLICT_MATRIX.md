# Phase 17C — Conflict Matrix

**Date:** 2026-06-01  
**Purpose:** What could break, regress, or remount when consolidating production render architecture.

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🔴 | High regression risk — test required |
| 🟡 | Medium — verify on device |
| 🟢 | Low — structural only / memo bail expected |

---

## Matrix: change × surface

| Change | Hero / MP4 | Home tab mount | Countdown UI | Mini player | Modals / preview | Music tab | Stripe checkout | Mobile nav highlight |
|--------|------------|----------------|--------------|-------------|------------------|-----------|-----------------|----------------------|
| Remove page-wide `LiveCountdownProvider` | 🟢 | 🟢 | 🟡 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| Provider on `HomeStorefront` only | 🟢 | 🟢 | 🟡 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| Provider on live tab only | 🟢 | 🟢 | 🟡 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| `CatalogSurfaceProvider` | 🟢 | 🟡 | 🟢 | 🟢 | 🟡 lookup | 🟡 singles | 🟢 | 🟢 |
| `HeroIsland` wrapper | 🟡 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| Catalog loading off `Page` | 🟢 | 🟡 skeleton | 🟢 | 🟢 | 🟢 | 🟡 | 🟢 | 🟢 |
| 17A persistence retained | 🟢 | 🔴 tab return | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| IO `homeNavSyncEpoch` | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟡 vault/cards/shows |

---

## Remount triggers (post-17C intended)

| Event | Should remount `HomeStorefront`? | Should remount `HeroSection`? |
|-------|----------------------------------|-------------------------------|
| Tab away from home | **No** (display:none) | No |
| Tab back home | **No** | No |
| Catalog page fetch | No (memo + context) | **No** (PlaybackChromeIsland memo) |
| Playback `isPlaying` tick | No | **No** |
| Entitlement snapshot | No (island) | **No** |
| `isMobile` resize | No | **Yes** (intentional) |
| Live countdown 1 Hz | Countdown leaves only | **No** |
| `Page` auth/cart update | Possible props | **No** if hero props stable |

---

## Regression scenarios (test plan hooks)

1. **Home → Music → Home** — no video restart flash; scroll restored.  
2. **Play track on home** — mini player + ambient; hero unchanged.  
3. **Live tab** — countdown digits update; no console provider error.  
4. **Load more catalog** — skeleton/row updates; hero static.  
5. **Immersive preview** — access + gift from islands.  
6. **Checkout** — `clientSecret` modal opens/completes.  
7. **Mobile** — scroll vault/cards/shows; bottom nav highlight updates.

---

## Conflicts with project guardrails

| Guardrail | 17C compliance |
|-----------|----------------|
| No `page.js` cinematic redesign | ✅ structural only |
| No `AudioContext` edits | ✅ |
| No Stripe logic edits | ✅ |
| Entitlements from API only | ✅ islands unchanged |
| No dependency bumps | ✅ |

---

## Rollback

- Revert single commit `Phase 17C: production-grade render architecture consolidation`  
- Recovery tag: `frontend-checkpoint-20260601-1427` / `npm run recover:foundation`
