# 2MRRW Slice 4D — Continuity / Resume Authority Closure

Certification date: 2026-08-29
Audited starting commit: `e303320` (Slice 3 + addendum closure)

## 1. Executive verdict

Continuity is now Core-owned via a dedicated `ContinuityAuthority`, holding its own `AuthorityGate`/`CommitGate` pair exactly like Selection (Slice 3) and Transport (Slice 2). The governing principle — **RESTORE IS A PROPOSAL. RESTORE IS NEVER AUTHORITY.** — is enforced architecturally, not by convention: `ContinuityAuthority` has no write path to Selection or Transport truth of its own. Selection restoration is delegated to the already-canonical `SelectionAuthority.restoreSelection()` (never re-implemented, never bypassed); position restoration is validated but never seeks anything itself — the physical element remains the only thing that can confirm a seek actually happened. A persisted candidate is evidence of prior truth, never present truth: it passes through a versioned schema gate (`ContinuityCandidate`), then two independent staleness gates (Continuity's own `CoreEpoch` check, Selection's own `selectionVersionAtCapture` check) before anything commits.

A real defect was found and fixed during the audit: the recovery-event restore path's deferred seek (waits up to 5s for the audio engine to stabilize) previously called `seek(targetTime)` unconditionally, with no re-validation against what might have changed during that wait. It now re-validates media identity and CoreEpoch immediately before every seek attempt via `validateContinuityPositionRestore`.

## 2. Audited starting commit

`e303320` — the exact commit Slice 3's addendum certified closed, on the git worktree at `.auth-cover-repair` (branch `fix/account-gate-cover-regression`), the same canonical worktree used for Slices 2 and 3.

## 3. Pre-slice continuity classification (audit-before-code)

Per file, classified before any code was touched:

| File | Classification |
|---|---|
| `lib/playback/session-memory.js` | CLOSED_AND_PRESERVE — localStorage `2mrrw_sess_${userId}`, `{v:1, queue, queueIndex, shuffle, repeatMode, savedAt}`, 7-day TTL. `loadPlaybackSessionServerFirst`/`clearPlaybackSession` confirmed DEAD (unused exports). |
| `lib/playback/position-memory.js` | CLOSED_AND_PRESERVE — localStorage `2mrrw_pos_${userId}_${slug}`, per-track. A duplicate/dead same-named set exists in `lib/listening-history.js` (different mechanism, never imported) — left untouched. |
| `system/recovery/usePlaybackRecovery.js` | DEAD — its `restore()`/`onRestore` path is never invoked; `AudioPhase10Bridge.js` passes `onRestore: () => {}`. |
| `system/recovery/useSessionRecovery.js` | CLOSED_AND_PRESERVE — the REAL restore trigger. Fires once on mount, hydrates via `GET /api/catalog/hydrate`, dispatches `2mrrw:playback-recovery`. |
| `system/recovery/recoveryStore.js` | CLOSED_AND_PRESERVE — sessionStorage `2mrrw:recovery:playback`. |
| `components/system/AudioPhase10Bridge.js` | PARTIAL — the setQueue portion was already race-safe (Selection commits synchronously); the deferred-seek portion was LEGACY_AUTHORITY with a real staleness gap (see item 1). |
| `lib/playback/recovery-coordinator.js` | CLOSED_AND_PRESERVE — stall/audibility recovery, orthogonal to session/lifecycle continuity; out of this slice's domain boundary. |
| `lib/playback/PlaybackRecoveryCommands.js` | CLOSED_AND_PRESERVE — `recoverAudioHard`, `resumePlaybackTransport`, lock/bfcache helpers; heavily load-bearing, no defect found. |
| `lib/playback/usePlaybackEffects.js` Effect 3 | PARTIAL — session restore captured a Selection context but had no independent Continuity-level epoch gate or schema validation. |
| `lib/playback/usePlaybackEffects.js` Effect 9 | CLOSED_AND_PRESERVE — debounced session save already reads Core-projected `state.queue/queueIndex/shuffle/repeatMode`; correctly "Core canonical state → persistence" already. |
| `lib/playback/usePlaybackEffects.js` Effect 23 | CLOSED_AND_PRESERVE — visibilitychange/pageshow(`persisted`)/beforeunload/pagehide lifecycle handling; confirmed the codebase does not use the Page Lifecycle API's `freeze`/`resume` events. |
| `lib/playback/PlaybackHelperService.js` `computeLifecycleAudioTruthState()` | LEGACY_AUTHORITY — embeds the Phase 21C continuity-freeze state machine inline. Highest-risk unmigrated piece; explicitly deferred (item 22/38). |
| `lib/playback/media-session-artwork.js` | DEAD/PRESENTATION_ONLY — persist-only, read/clear never called. |
| `app/api/queue/route.js` | CLOSED_AND_PRESERVE — server mirror, `user_playback_queue` table, no position column. |
| `lib/playback/PlaybackStreamCommands.js` resumeAt resolution | CLOSED_AND_PRESERVE — already-correct 3-tier fallback (explicit param → position-memory → server `mediaProgress`), resolves fresh at play-time. |
| CoreEpoch | MISSING — zero references anywhere outside `playback-core/` before this slice. |
| ResumePolicy interpretation | MISSING (pre-existing, unrelated to Continuity persistence) — threaded through Core plumbing but never read by `playTrackInternal`; not a Continuity defect, not fixed here (item 45). |

No entitlement leakage was found in any continuity persistence path.

## 4. Pre-slice Continuity ownership graph

`localStorage/sessionStorage/server → useSessionRecovery.js (hydrate) → window event '2mrrw:playback-recovery' → AudioPhase10Bridge.js (direct dispatchPlaybackCommand("setQueue") + unconditional seek(targetTime)) → legacy Selection/Transport refs`

Independently: `usePlaybackEffects.js` Effect 3 loading local/server session data directly into `proposeSelection("restoreSelection", ...)`, with no Continuity-level staleness gate beyond Selection's own.

## 5. Post-slice Continuity ownership graph

`persisted payload → buildContinuityCandidate() (schema gate) → ContinuityAuthority.beginSelectionRestore()/proposeSelectionRestore()/validatePositionRestore() → delegates to SelectionAuthority.restoreSelection() (Selection's own canonical commit) → Continuity's own CommitGate (bookkeeping only, Domain.CONTINUITY) → continuity-port.js (neutral seam) → usePlaybackEffects.js Effect 3 / AudioPhase10Bridge.js`

Continuity never writes Selection or Transport state directly — it only ever calls the domain's own already-canonical authority method.

## 6. ContinuityCandidate schema

`{ schemaVersion, persistedAt, selection: {queue, queueIndex, nowPlayingIdentity, repeatMode, shuffle} | null, timeline: {position, duration} | null, mediaIdentity, source }`. Built by `buildContinuityCandidate()` — framework-independent, no localStorage/fetch/React. Fails closed on: non-object payloads, missing/non-integer `schemaVersion`, unknown NEWER version (never guesses at an unseen shape), out-of-bounds `queueIndex`, non-array `queue`, non-finite `position`. A `selection` key that is *present but malformed* rejects the whole candidate (a garbled `queue` is reason to distrust the rest of the payload, not reason to silently drop just that field) — this exact behavior was a bug found and fixed during test-writing (item 40).

## 7. Governing principle proof — restore is a proposal, never authority

Static test *"SLICE-4D Core is the sole canonical Continuity writer; restore is a proposal, never authority"* mechanically asserts: `ContinuityAuthority` calls `#commitGate.propose(...)` only with `domain: Domain.CONTINUITY`, never `Domain.SELECTION`/`Domain.TRANSPORT`; calls `#selectionAuthority.restoreSelection(` but no other Selection transition method; never calls `audio.play()`/`audio.pause()`/`.currentTime =`; and that `._applyCommit(` still appears in exactly one file (`commands/CommitGate.js`) across all of `playback-core`.

## 8. Selection restore delegation (never independent)

`ContinuityAuthority.proposeSelectionRestore()` validates its own `coreEpoch` gate, then calls `SelectionAuthority.restoreSelection({queue, queueIndex, repeatMode, shuffle}, selectionContext)` — Selection's own `selectionVersionAtCapture` staleness check runs unmodified and its rejection is never re-interpreted or retried. Certified by tests 1, 2, 4, 15, 19, and the 250+ op stress test.

## 9. Position restore validation (never fabricating physical time)

`validatePositionRestore()` mirrors the pre-existing legacy `clampRestorePosition` policy (`RESTORE_MIN_POSITION_SEC=5`, `RESTORE_NEAR_END_BUFFER_SEC=3`), duplicated rather than imported so Core stays legacy-independent. It never seeks, never touches `TransportTimeline` — it only returns a validated number (or a rejection) for the existing seek/resumeAt pipeline to act on. Certified by tests 3, 17, and two unnamed position tests (min-threshold, mid-track-clamped, never-mutates-Transport).

## 10. Background/foreground lifecycle hardening

No new lifecycle listeners were added — `usePlaybackEffects.js` Effect 23's existing visibilitychange/pageshow/pagehide handling is CLOSED_AND_PRESERVE and untouched. What Slice 4D certifies is that a restore captured before a background/foreground boundary behaves correctly on both sides of it: test 6 proves an ordinary background→foreground cycle (no CoreEpoch rotation, nothing else committed) still lets the restore commit; test 7 proves a bfcache/catastrophic-recovery boundary that *does* rotate `CoreEpoch` correctly denies the pre-boundary capture — the same guarantee proven for a full reload (test 8), now proven for the backgrounding case specifically.

## 11. Capability/entitlement revalidation before protected restore

Certified, not rebuilt: `SelectionAuthority`'s domain snapshot has no `isPlaying`/`playing` field at all (static-grepped, test 9/10) — restoring Selection is architecturally incapable of granting playback for a track the session isn't entitled to. The one legacy entry point a Continuity-driven restore calls afterward, `resumePlaybackTransport()`, was read in full: it always calls `isEntitledFullPlaybackTrack(track)` before resolving a real stream URL and always sets `isPlaying: false` — actually starting audio remains a separate, later, user- or stream-driven action through its own independently-entitlement-gated path (`playTrackInternal`). Static test *"SLICE-4D restore never grants protected playback; entitlement is always re-checked downstream"* pins both facts by source inspection, scoped precisely to `resumePlaybackTransport`'s own function body (not the whole file, since `recoverAudioHard` elsewhere in the same file legitimately sets `isPlaying: true` after confirmed audibility on a *non-restore* path).

## 12. CoreEpoch validation

Added in this slice (previously MISSING outside `playback-core/`). `ContinuityAuthority.captureContext()`/`beginSelectionRestore()` stamp `coreEpoch: this.#coreEpoch.current`; every mutating method (`proposeSelectionRestore`, `validatePositionRestore`) rejects with `CONTINUITY_EPOCH_MISMATCH` if the captured epoch no longer matches current. Proven against both a full Core replacement (test 8, Core A destroyed → Core B) and an in-place `_rotateCoreEpoch()` (tests 8's second half, "continuity-level epoch check fires...", 7).

## 13. Named race scenarios certified

1. Restore A → user selects B → late A restore denied, B remains canonical.
2. Restore queue → user replaces queue → late restore denied.
3. Restore position 30s → epoch rotates → late 30s position denied (not silently applied).
4. Two concurrent restore proposals race — only the first to commit wins, the second is stale.
5. `clearSnapshot` fired mid-restore does not resurrect the cleared candidate.
6. Background/foreground boundary, nothing else committed — restore still succeeds.
7. Background/foreground boundary, CoreEpoch rotates (bfcache/catastrophic recovery) — pre-hide capture denied.
8. Core A restore → Core A disposed → Core B → old Core A restore denied (full-reload equivalent); same-core epoch rotation denied.
9/10. Capability revalidation — a restored Selection snapshot never carries an `isPlaying`/`playing` field.
11/12. Corrupt queue and unknown schema version are both safely ignored, never thrown.
15. Reload/session-restore — coherent atomic Selection restore via Continuity.
17. Position near end rejected (matches legacy `clampRestorePosition` policy).
19. 120+ (130 executed) stale continuity candidates never commit; current live-queue authority unaffected throughout.

13 named scenarios, all PASS, 0 failures.

## 14. Stress test result

260 randomized operations (`RESTORE_SELECTION`, `SELECT`, `NEXT`, `PREVIOUS`, `QUEUE_REPLACE`, `POSITION_RESTORE`, `RELOAD_CANDIDATE`) against a deterministic xorshift32 seed; 60% of `RESTORE_SELECTION` iterations deliberately mutate live state after capture to force staleness, 30% of `RELOAD_CANDIDATE` iterations rotate `CoreEpoch`. After every single iteration: Selection's empty-invariant holds, `nowPlaying === queue[queueIndex]` whenever `queueIndex >= 0`, and `CoreEpoch` is always a non-empty string. 0 failures across 260 iterations.

## 15. Persistence write cadence bounds

Unchanged, CLOSED_AND_PRESERVE, not touched by this slice: Effect 9's debounced 400ms session save (`usePlaybackEffects.js`), `position-memory.js`'s per-track localStorage writes, `recoveryStore.js`'s sessionStorage writes. None of these write paths were modified — Slice 4D only hardens the *read/restore* side (candidate validation, staleness gating), consistent with the audit's finding that persistence-write cadence was never the risk; restore-time staleness was.

## 16. Production certification — Desktop Chrome / Safari Desktop / iOS Safari / Android Chrome

**NOT AUTOMATED — no Playwright harness exists in this repo.** `@playwright/test@^1.62.1` is an installed dependency, but there is no `playwright.config.js`, no e2e test directory, and no e2e npm script (confirmed by search before this slice began). Building a Playwright harness from scratch was judged out of scope for this closure — it is infrastructure work independent of the Continuity domain itself, and inventing a one-off ad hoc script would not meet the spec's own bar for a real, repeatable certification suite.

**Verdict: BLOCKED — MANUAL DEVICE CERTIFICATION**, all four targets (Desktop Chrome, Safari Desktop, iOS Safari, Android Chrome). Manual procedure to close this item:
1. Start playback on a multi-track queue, let position advance past 10s, background the tab/app (switch app or lock screen) for >30s, foreground it, confirm the same track/position is still current (no restart, no skip).
2. Force-quit and relaunch (or hard-reload) mid-track; confirm session restore lands on the same queue/track (position restore only if ≥5s in and not within 3s of the end, per item 9).
3. On iOS Safari specifically: trigger a bfcache restore (back-navigate into the tab after backgrounding) and confirm no stale seek fires (item 1's fixed defect) and no duplicate/garbled queue appears.
4. Repeat with an Entry-tier (preview-only) account on a track it does not own, confirming restore never begins full playback without the entitled stream resolving first (item 11).

## 17. Regression — Playback Core totals

`test:core-invariants` (invariants.test.js + transport-authority.test.js + selection-authority.test.js + continuity-authority.test.js): **250/250** — up from Slice 3's 219/219 baseline (+31 new Continuity-domain cases).

## 18. Regression — physical suite totals

**47/47** — unchanged from Slice 3's addendum total. No physical/DOM-event test was added or modified for Continuity; the domain has no physical media-event surface of its own (it only proposes into Selection, whose physical surface is Transport's, unchanged).

## 19. Regression — critical suite totals

- Auth/security: 247/247 (unchanged).
- Upload/HLS/media/storefront: 83/83 (unchanged).
- Release lifecycle: 23/23 (unchanged).
- Architecture contracts (signal-path-low-risk): **27/27** — up from 22/22 (+5 new Slice 4D static tests: production ownership, sole-canonical-writer, recovery-event RESTORE_SELECTION usage, page-load session-restore capture-before-fetch, entitlement-revalidation certification).
- Core + physical + critical aggregate: **677/677** (250 + 47 + 247 + 83 + 23 + 27).

## 20. Build result

`npm run build`: **PASS**, exit code 0. Next.js 16.2.4 (Turbopack) production compilation, `runAfterProductionCompile` completed, TypeScript check finished clean, all routes/pages generated, no errors.

## 21. Lint result

`npm run lint`: **PASS** — 0 errors, 241 warnings. Identical warning count to Slice 3's certified baseline; every warning is pre-existing (react-hooks/exhaustive-deps, next/image advisories) and none touch a file this slice created or modified — spot-checked by grepping the warning list against every Slice 4D file.

## 22. HLS preservation verdict

**PASS.** No HLS/upload/media file was touched. `test:admin-upload` (includes the HLS manifest/generation-cutover/video-contract suites): 83/83.

## 23. WebAudio preservation verdict

**PASS.** `WebAudioEngine.js` was not modified. Continuity has no interaction with the Web Audio processing graph — restoration only ever proposes Selection identity and validates a position number; the physical audio element/graph is untouched by this domain entirely.

## 24. Continuity Writer Matrix

[SLICE-4D-CONTINUITY-WRITER-MATRIX-2026-08-29.csv](./SLICE-4D-CONTINUITY-WRITER-MATRIX-2026-08-29.csv) — every file identified by the audit (item 3), classified FILE/SYMBOL/FIELD/READ-WRITE/OWNER/TARGET/ACTION.

## 25. Files created

Four: `lib/playback-core/continuity/ContinuityAuthority.js`, `lib/playback-core/continuity/continuity-candidate.js`, `lib/playback/continuity-port.js`, `lib/playback-core/__tests__/continuity-authority.test.js`. Plus this closure report and the writer-matrix CSV.

## 26. Files modified

Seven: `lib/playback-core/types/index.js`, `state/createDomainStores.js`, `core/PlaybackCore.js`, `production/wireProductionCore.js`; `lib/playback/usePlaybackEffects.js`; `components/system/AudioPhase10Bridge.js`; `lib/architecture/__tests__/signal-path-low-risk.test.js`.

## 27. OwnershipRegistry before/after

Before: `TRANSPORT=CORE`, `SELECTION=CORE`, `CONTINUITY=LEGACY`. After production initialization: `TRANSPORT=CORE`, `SELECTION=CORE`, `CONTINUITY=CORE`. `CAPABILITY`/`MEDIA_PREPARATION` unaffected (`LEGACY`) — confirmed by static test *"SLICE-4D production ownership is TRANSPORT=CORE, SELECTION=CORE, CONTINUITY=CORE"*, which also re-asserts `transferToLegacy` still does not exist on the registry.

## 28. Neutral port isolation

`lib/playback/continuity-port.js` imports no Core internals (mirrors `selection-port.js`/`transport-observation-port.js` exactly); fails closed (`CONTINUITY_AUTHORITY_UNAVAILABLE`) with no sink installed, never silently no-ops as if nothing was ever persisted. Protected legacy files (`session-memory.js`, `position-memory.js`, `usePlaybackRecovery.js`, `useSessionRecovery.js`, `recoveryStore.js`) statically confirmed to never import `playback-core` directly.

## 29. `usePlaybackEffects.js` Effect 3 rewiring

Replaced direct `captureSelectionContext` + `proposeSelection("restoreSelection", ...)` with `beginContinuitySelectionRestore` → `validateContinuityCandidate` → `proposeContinuitySelectionRestore`. The exact pre-existing behavior — `repeatMode` hardcoded to `"off"` on restore, `shuffle` genuinely restored — is preserved unchanged; this is a documented pre-existing asymmetry, not something this slice redesigns. `captureSelectionContext`'s now-unused import was removed.

## 30. `AudioPhase10Bridge.js` recovery-event rewiring

Replaced `dispatchPlaybackCommand("setQueue", ...).then(() => resumePlaybackTransport())` with the same `beginContinuitySelectionRestore` → `validateContinuityCandidate` → `proposeContinuitySelectionRestore` → `resumePlaybackTransport()` sequence Effect 3 now uses — unifying the two previously-divergent restore call shapes into one atomic transition. `dispatchPlaybackCommand`'s now-unused import and effect-dependency entry were removed.

## 31. The fixed deferred-seek defect

The recovery-event handler's failsafe/deferred seek (subscribes to `playbackStateMachine` for up to 5000ms waiting for the engine to reach a seekable state) previously called `seek(targetTime)` unconditionally once that wait resolved — with no re-check of what track was actually current by then. Fixed by wrapping every seek call site (both the immediate-engine-stable branch and the deferred/failsafe branch) in `attemptSeek()`, which calls `validateContinuityPositionRestore` against the live current media identity and CoreEpoch immediately before seeking. A user who selects something else entirely during that up-to-5s wait no longer gets a stale seek applied to whatever ends up playing instead.

## 32. Position-restore threshold behavior change (disclosed, not silent)

Applying `RESTORE_MIN_POSITION_SEC=5`/near-end validation to the recovery-event seek path — which previously had no minimum-position threshold at all — is a deliberate behavior unification, consistent with how Slice 3 documented similar cross-path unifications (item 39 of that closure). Restoring a stray 1–2 second position from the recovery-event path is now treated the same as it already was on every other restore path in the codebase (noise, not real progress).

## 33. Schema versioning

`CONTINUITY_SCHEMA_VERSION = 1`, duplicated (not imported) between `continuity-candidate.js` (Core-side) and `continuity-port.js` (legacy-side constant), matching the exact `identityOf()` duplication pattern Slice 3 already established at the Core/legacy boundary. `buildContinuityCandidate` fails closed on an unknown *newer* version (never guesses at a shape it has never seen) and has an explicit (currently empty) migration seam for a future *older* supported version.

## 34. Differential/behavior-preservation result

Everything on the happy path is byte-for-byte preserved: session-restore's repeat/shuffle asymmetry (item 29), the 3-tier resumeAt fallback in `PlaybackStreamCommands.js` (untouched), the recovery-event handler's existing `hasStartedRef.current || activeQueue.length > 0` skip guard (untouched, re-verified race-safe). The one intentional behavior change is item 32, disclosed above.

## 35. Remaining legacy Continuity writers

**0** for the paths this slice's boundary covers (session-restore, recovery-event restore, position-restore-before-seek). Static test mechanically confirms `_applyCommit(` appears only in `CommitGate.js`, and the five protected legacy files never import `playback-core`.

## 36. Deferred / explicitly out of scope

- `lib/playback/PlaybackHelperService.js`'s `computeLifecycleAudioTruthState()` (Phase 21C continuity-freeze state machine) — the highest-risk unmigrated continuity logic identified by the audit, left untouched because no test in this closure exposed a defect in it, and it governs stall/audibility-freeze policy rather than session/lifecycle restore — a different concern than this slice's declared boundary. Flagged for a future dedicated slice.
- `ResumePolicy` enum interpretation — confirmed still dormant (threaded through `IntentFactory`/`DesiredStateReducer`/`ConvergenceEngine`/`PlaybackCoreAdapter` but never read by `playTrackInternal`, which only honors `options.resumeAt`). Pre-existing, not a Continuity-authority defect, not fixed here — wiring it into the legacy play path is a separate initiative.
- `usePlaybackRecovery.js`'s dead `restore()`/`onRestore` path — confirmed dead, not rebuilt (per this slice's audit-before-code directive: "do not rebuild functionality merely because a spec describes it").
- `media-session-artwork.js` — confirmed dead/presentation-only, left untouched.
- No Capability Engine primitive was built or modified — Slice 5 territory, untouched per instruction.

## 37. Bug found and fixed — malformed `selection` payload silently dropped

`buildContinuityCandidate` originally silently dropped a malformed `selection.queue` (e.g. a non-array) instead of rejecting the whole candidate, discovered via a failing test while writing the schema-validation suite. Fixed: a `selection` key that is present but structurally malformed now rejects the entire candidate (`CONTINUITY_INVALID`); an *absent* `selection` key remains valid (`candidate.selection = null`) — a garbled queue is reason to distrust the rest of the payload, not reason to quietly proceed without it.

## 38. Bug found and fixed — untestable staleness in the stress/stale-candidate tests

The "120+ stale continuity candidates" test initially used a 1-item live queue, where `SelectionAuthority.next()` is its own detected no-op (unchanged state never bumps `selectionVersion`), making genuine staleness impossible to exercise. Fixed by using a 3-item live queue so every `next()` call genuinely advances state and genuinely invalidates the previously-captured context.

## 39. Commit created

One closure commit for this slice: `e98a249`, subject `feat(playback): harden continuity and resume authority`.

## 40. Blocker to Slice 4D closure

None for the domain this slice certifies. The one open item (16 — device certification) is explicitly permitted by the spec's own "BLOCKED — MANUAL DEVICE CERTIFICATION" framing rather than treated as a closure blocker, since it requires physical devices this environment does not have access to.

---

# SLICE 4D CLOSED

Do not begin Slice 5.
