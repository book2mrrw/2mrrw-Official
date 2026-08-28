# Signal Path Implementation Matrix

Date: 2026-08-27
Baseline commit: `c97fc01d`
Purpose: live implementation control document. This is not the final closure report.

## Baseline

- Playback Core owns logical intent/state authority through `PlaybackCore`, `AuthorityGate`, `CommitGate`, `DesiredStateStore`, and `ConvergenceEngine`.
- The serial legacy command path and production adapter remain intact.
- Physical audible mutations are not yet governed by one epoch-aware effect boundary; Slice 1D remains open.
- Baseline: Playback Core 142/142, physical playback 26/26, auth/security 203/203, upload 15/15, lifecycle 23/23, build PASS, lint 0 errors.
- CI previously ran only the build. `.github/workflows/web.yml` now gates lint and the complete critical architecture suite.

## Ownership baseline

| Domain | Current owner | Source of truth | Gap |
|---|---|---|---|
| Playback intent | Playback Core `CommandGateway` / `AuthorityGate` | latest registered intent | Preserve |
| Desired playback state | `DesiredStateStore` | monotonic desired revision | Preserve |
| Legacy physical playback | playback command services + audio engines | detached global media element/WebAudio graph | Add effect authority and core epoch |
| Queue | legacy `AudioContext` command services | queue refs/state | Formal transfer still open |
| Recovery | `recovery-coordinator` | coordinator state and command generation | Bind to core epoch |
| Capability | server account-state/entitlement authority | Supabase + generation-stamped Redis | Formal snapshot contract still open |
| Catalog publication | Supabase release/product projections | database + ISR invalidation | Formal projection/version contract still open |
| Decorative video | `VideoResourceManager` plus persistent storefront manager | browser registry | Unify resource pressure authority |

## Finding control matrix

`CLOSED` below means implemented in the current phase and protected by tests. `OPEN` means verified work remains; it is not a final-audit status.

| Finding | Verified current state / action | Status |
|---|---|---|
| BOOT-01 | `middleware.js` now validates only protected human requests and enforces the centralized fail-closed route policy. | CLOSED |
| BOOT-02 | Page requests were already parallel; `catalog-db.js` N+1 track reads replaced with one set-based query. | CLOSED |
| BOOT-03 | `AppAuthRoot` remains hydration-only; protected SSR is admitted only after verified server authority. | CLOSED |
| BOOT-04 | Consumer access is account-gated in middleware and protected Server Components; anonymous access is an explicit allowlist. | CLOSED |
| BOOT-05 | Google Fonts CSS `@import` remains in `globals.css`. | OPEN |
| BOOT-06 | `globals.css` remains over 4,000 lines; incremental scoping required. | OPEN |
| BOOT-07 | Root Stripe provider removed; one payment-scoped cached loader introduced. | CLOSED |
| BOOT-08 | Some admin surfaces are dynamic, but admin code remains embedded in `HomeClient`. | OPEN |
| NAV-01 | Collector Cards navigation now uses `router.push`. | CLOSED |
| NAV-02 | Subscribe exit now uses `router.push`. | CLOSED |
| NAV-03 | No canonical version-aware release-detail cache yet. | OPEN |
| NAV-04 | Album idempotence exists; single/feature parity still requires browser proof and consolidation. | OPEN |
| NAV-05 | `DeepLinkRedirect` still performs the client bounce. | OPEN |
| NAV-06 | Coupled to BOOT-01 middleware redesign. | OPEN |
| NAV-07 | Route loading boundaries remain incomplete. | OPEN |
| NAV-08 | OWN IT query behavior still requires caller/consumer closure. | OPEN |
| NAV-09 | Some home state is persistent; route-owned tab/cart/scroll contract remains incomplete. | OPEN |
| CAT-01 | SSR catalog is supplied, but duplicate client endpoint paths still require consolidation. | OPEN |
| CAT-02 | Exclusive-drop consumers still require one read authority. | OPEN |
| CAT-03 | Multi-track catalog loading is set-based and query-count bounded. | CLOSED |
| CAT-04 | Dormant control-system client remains and needs removal or bounded batching. | OPEN |
| CAT-05 | Redis/KV conventions remain fragmented. | OPEN |
| CAT-06 | Account-state product scan still requires targeted entitlement resolution proof. | OPEN |
| ART-01 | Browser fetch priority is not consistently wired to actual images. | OPEN |
| ART-02 | Shadow image priority pipeline remains only partially connected to browser fetching. | OPEN |
| ART-03 | Mobile transfer-size evidence and derivative policy not yet captured. | OPEN |
| ART-04 | Placeholder/fade behavior is inconsistent. | OPEN |
| ART-05 | Store/catalog autoplay video is not fully governed by one resource path. | OPEN |
| ART-06 | Intentional persistent Hero/Latest behavior preserved; cost instrumentation remains. | OPEN |
| ART-07 | Video budget does not yet consume audible/network-pressure signals. | OPEN |
| ART-08 | Preview modal registration with resource authority remains incomplete. | OPEN |
| ART-09 | Unsafe dormant `ArtworkSkeleton` video path remains. | OPEN |
| AUD-01 | Direct R2 path exists conceptually; production CORS/browser/security evidence remains measurement-gated. | OPEN |
| AUD-02 | Playback bookkeeping placement requires branch-by-branch verification. | OPEN |
| AUD-03 | Module prewarm exists; representation/manifest prediction authority does not. | OPEN |
| AUD-04 | Process-local signed resolution cache preserved; hit-rate telemetry remains. | OPEN |
| AUD-05 | HEAD/content-type verification preserved by design; production measurement remains. | OPEN |
| AUD-06 | Durable playback-key fallback preserved; cold-path telemetry remains. | OPEN |
| AUD-07 | Proxy Range auth/rate limiting preserved; direct-delivery resolution remains coupled to AUD-01. | OPEN |
| REND-01 | Global player still consumes broad/high-frequency playback state. | OPEN |
| REND-02 | Mini player/cover memoization boundaries require measurement and isolation. | OPEN |
| REND-03 | `AuthContext` remains broad despite capability version hardening. | OPEN |
| REND-04 | Render-prop callback identity issues remain. | OPEN |
| REND-05 | Music panel persistence/resource cooperation remains incomplete. | OPEN |
| REND-06 | CS mode control subscription remains broad. | OPEN |
| SYS-01 | Same single payment-scoped Stripe loader as BOOT-07. | CLOSED |
| SYS-02 | Telemetry facade already dynamically imports PostHog; root bootstrap still imports adapter directly and needs final consolidation. | OPEN |
| SYS-03 | Coupled to BOOT-08 admin extraction. | OPEN |
| SYS-04 | Production build baseline captured; chunk attribution/bundle budget automation remains. | OPEN |
| SYS-05 | Admin upload Blob URLs now revoke on replacement/unmount; offline and lyric URLs already had cleanup. | CLOSED |
| SYS-06 | Login remains a client-only page; server shell/island separation remains. | OPEN |
| SYS-07 | `three`, `howler`, and type packages still require dependency graph proof before removal. | OPEN |

## Phase gate

The next high-risk phase may begin only after the complete architecture-critical test command and production build pass. Slice 1D must add an effect authority alongside—not instead of—the existing intent authority, and must preserve synchronous iOS unlock behavior.
