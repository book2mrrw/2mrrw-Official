# Phase 5.2 Stage 7 — Mobile Validation Checklist

**Date:** 2026-05-30  
**Viewport target:** 375×812 (iPhone-class)  
**Phase 5.2 client impact:** **None** — `AudioContext.js`, `GlobalAudioPlayerBar`, and cinematic shell unchanged

---

## Automated / static validation

| Check | Result | Notes |
|-------|--------|-------|
| Foundation smoke (mobile-critical files present) | **PASS** | `AudioContext.js`, `layout.js`, `page.js` intact |
| Client playback code modified | **PASS (none)** | No Phase 5.2 diff in client playback |
| Hybrid flags client-exposed | **PASS (none)** | Server-side env only; no `NEXT_PUBLIC_` hybrid vars |
| Build compiles mobile routes | **PASS** | All app routes build successfully |

---

## Manual mobile checklist (375px / iOS Safari)

| # | Scenario | Expected | Status |
|---|----------|----------|--------|
| 1 | Guest preview tap (hour-glass) | Preview plays; no entitlement prompt | **PENDING** — requires device/browser; flags OFF = unchanged behavior |
| 2 | Entitled stream tap (redirect=1 path) | Audio starts; lock screen metadata | **PENDING** — needs fan session on staging post-deploy |
| 3 | Background / lock screen controls | Play/pause/skip work | **PENDING** — inherit from foundation; no client changes |
| 4 | App switch / Dynamic Island | Playback continues | **PENDING** |
| 5 | Bluetooth output | No second audio element | **PENDING** |
| 6 | Safe area / 44×44 targets | Unchanged cinematic shell | **PASS (by inspection)** — no UI files in Phase 5.2 diff |
| 7 | Reduced motion | `useReducedMotion` preserved | **PASS (by inspection)** — not touched |
| 8 | Stream-first with flags ON (staging) | Faster start vs master; fallback invisible | **PENDING** — post-canary only |

---

## Browser automation attempt

Stage 7 did not run live 375px browser automation against production — Phase 5.2 code is **not deployed** to www.2mrrw.com. Mobile validation for hybrid stream path requires:

1. Deploy Phase 5.2 to staging
2. Apply DB migration + optional backfill
3. Enable flags on staging only
4. Manual iOS Safari pass with entitled account

---

## Regression status summary

| Category | Status |
|----------|--------|
| Mobile UI/layout | **PASS** — no Phase 5.2 UI changes |
| Mobile playback (flags OFF) | **PASS (inherited)** — client unchanged; foundation anchor intact |
| Mobile playback (flags ON) | **PENDING** — operator staging canary |
| Collector mobile flows | **PASS (inherited)** — no collector route changes |

---

## Recommendation

Treat mobile as **PASS for Phase 5.2 implementation sign-off** (no client diff). Schedule **PENDING** items as part of operator staging canary before production flag enablement.
