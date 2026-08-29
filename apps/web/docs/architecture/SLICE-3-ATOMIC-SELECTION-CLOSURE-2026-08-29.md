# 2MRRW Slice 3 — Atomic Selection Domain Migration Closure

Certification date: 2026-08-29
Audited starting commit: `15bf2adbb465781c7e900740f8fc93cfaf3b72b1` (Slice 2 closure)

## 1. Executive verdict

Playback Core is now the sole canonical Selection writer. NowPlaying, Queue, and QueueIndex commit atomically through one Selection DomainStore via SelectionAuthority, a dedicated authority with its own AuthorityGate/CommitGate pair so an unrelated Selection action can never supersede an in-flight Transport intent (or vice versa). Legacy queue/track command services now propose named transitions through a neutral port instead of mutating shared refs. Production UI consumes Core Selection, directly in one place (AudioContext.js) and transparently through PlaybackStateMachine's compatibility projection everywhere else. A confirmed pre-existing bug (an unbound `advanceShuffleOrder` reference inside `onEnded`, which would throw `ReferenceError` the first time a track ended naturally under shuffle) was eliminated by construction, not patched around.

## 2. Audited starting commit

`15bf2adbb465781c7e900740f8fc93cfaf3b72b1` — the exact commit Slice 2 certified closed, on the git worktree at `.auth-cover-repair` (branch `fix/account-gate-cover-regression`). This is the furthest-progressed line of playback-architecture work; a sibling worktree/branch (`f0-dr-preview`) was found to be stale (missing this entire Transport migration) and was left untouched.

## 3. Pre-Slice Selection ownership graph

`UI -> usePlaybackPublicApi/PlaybackQueueCommands (direct queueRef/queueIndexRef/shuffledOrderRef mutation) -> patchState -> PlaybackStateMachine.context (canonical) -> React consumers`

Three independent inline implementations of "advance to next valid track" existed (manual NEXT, onEnded's auto-advance, onError's auto-skip), one of them unreachable without throwing.

## 4. Post-Slice Selection ownership graph

`UI -> usePlaybackPublicApi (chokepoint) -> selection-port.js (neutral seam) -> SelectionAuthority -> dedicated CommitGate -> Selection DomainStore -> PlaybackStateMachine projection + direct Core subscribers -> React consumers`

`PlaybackEventHandlers.onEnded`/`onError` request NEXT through the same seam; Transport observations (Slice 2, unchanged) never choose media.

## 5. Final Selection schema

| Field | Classification | Authority |
|---|---|---|
| nowPlaying, queue, queueIndex | SELECTION (identity) | Core SelectionAuthority — commit atomically |
| repeatMode, shuffle | SELECTION (traversal policy) | Core SelectionAuthority — migrates with the triple per Slice 2's own deferral comment |
| shuffleOrder, shufflePosition | SELECTION (internal traversal state) | Core-internal only; no legacy ref, no public compatibility shape |
| selectionVersion, updatedAt | SELECTION (bookkeeping) | Core SelectionAuthority |
| currentTrack/currentTrackId representation fields (src, access flags, CS variant) | PRESENTATION (same identity) | Legacy execution services propose refreshes; SelectionAuthority validates identity match |
| source, error, accessDenied, streamRetryable, streamConflict, hasStarted, csMode, csTrack, spaceMode, bassMode, atmosphereLevel, sleep/UI fields | UNMIGRATED (unchanged) | PlaybackStateMachine.context, as before |
| Transport status/timeline/mode | CANONICAL_TRANSPORT (Slice 2, unchanged) | Core TransportAuthority |

## 6. Empty Selection invariant

`{ nowPlaying: null, queue: [], queueIndex: -1 }`, with `shuffleOrder: null, shufflePosition: 0, repeatMode: "off", shuffle: false`. Enforced by `SelectionAuthority` construction (`isEmptySnapshot`) and used consistently everywhere — no code path can produce `queue: []` with `queueIndex !== -1`.

## 7. Stable media identity used

`entry?.id ?? entry?.trackId ?? entry?.slug ?? null` — the same three-key precedence already used by `TransportAuthority`, `DesiredStateReducer`, and `PhysicalStateProbe`. Not conflated with `DesiredStateStore.requestedMediaIdentity` (see item 34); duplicated as a small local `identityOf()` inside `SelectionAuthority.js` rather than importing it from legacy, preserving Core's zero-legacy-dependency property that every other Core file already holds.

## 8. SelectionVersion semantics

`selectionVersion` is a monotonic counter on the Selection snapshot, incremented only when an identity-changing transition (setQueueAndSelect, selectIndex, selectMedia, next, previous, insertItem, removeItem, reorderQueue, replaceQueue, clearQueue, restoreSelection, setTraversalPolicy) actually changes the triple or traversal policy. Representation-only transitions (`updateNowPlayingRepresentation`, `updateQueueRepresentation`) never bump it — refreshing a track's resolved `src` is not a new Selection. Distinct from `DomainStore`'s own internal `.version` (which increments on every commit including representation refreshes) and from `desiredRevision` (Transport's own counter).

## 9. QueueVersion decision

Not created. `CommitRejectionReason.QUEUE_VERSION_MISMATCH` already exists as a locked, distinct future contract for Deck B media-preparation/prediction correlation (per its own doc comment). Conflating it with `selectionVersion` would blur two genuinely different concerns (canonical Selection identity vs. preload-generation correlation). The seam is left open: nothing in Slice 3 blocks a future `queueVersion`/`predictionGeneration` field being added to a preparation-side store.

## 10. Updated Selection Writer Matrix

[SLICE-3-SELECTION-WRITER-MATRIX-2026-08-29.csv](./SLICE-3-SELECTION-WRITER-MATRIX-2026-08-29.csv) — every file identified by the precheck's inventory (55 files individually audited by an Explore pass, cross-checked by hand for every writer), classified FILE/SYMBOL/FIELD/READ-WRITE/OWNER/TARGET/ACTION.

## 11. Exact legacy Selection writers removed/demoted

`PlaybackQueueCommands.js`'s `setQueueInternal`/`playNextInternal`/`playPreviousInternal`/`playQueueInternal` (rewritten to propose transitions); `advanceShuffleOrder` (deleted — logic moved into `SelectionAuthority.next()`/`previous()`); `usePlaybackPublicApi.js`'s `enqueueTrack`/`removeFromQueue`/`moveInQueue`/`setRepeatMode`/`setShuffle` (rewritten); `PlaybackTransportCommands.js`'s `stopInternal` direct `queueRef`/`queueIndexRef` zeroing (removed — `resetContext()` now owns the canonical clear); `usePlaybackEffects.js` Effect 3 (session restore) and Effect 5 (entitlements); `PlaybackEventHandlers.js`'s `onEnded`/`onError` inline traversal (deleted, including the confirmed unbound-reference bug). `PlaybackStreamCommands.js`, `PlaybackCSCommands.js`, `PlaybackRecoveryCommands.js` needed no changes — every write in those three files is a same-identity representation refresh, auto-routed by `PlaybackStateMachine.updateContext()`'s key-splitting (mirroring exactly how Slice 2 already splits Transport keys).

## 12. SelectionAuthority implementation

`apps/web/src/lib/playback-core/selection/SelectionAuthority.js` (new). Holds its own `AuthorityGate` + `CommitGate` pair (constructed in `PlaybackCore.create()`, sharing the production `stores`/`ownershipRegistry`/`logger`) so Selection's commit-envelope bureaucracy is completely independent of Transport's. Twelve identity-changing transitions plus two representation-only transitions (`updateNowPlayingRepresentation`, `updateQueueRepresentation`). `next()`/`previous()` accept an injected `isPlayable(entry)` predicate so Core stays media-agnostic; the legacy port wrapper supplies `(entry) => Boolean(entry?.src)`.

## 13. Commit validation rules

Identity-changing transitions validate a captured context's `coreEpoch` and `selectionVersionAtCapture` against current values (rejecting `SELECTION_EPOCH_MISMATCH`/`SELECTION_VERSION_STALE`). Structural validation per transition: array/integer checks, index bounds, empty-state invariant, "cannot remove/reorder the currently-selected item" (matches legacy's existing silent no-op, now a defined rejection), duplicate-identity-safe (index-addressed, never identity-search-addressed once an index is known). Representation transitions validate identity match instead of version match (see item 34) plus `coreEpoch`.

## 14. OwnershipRegistry before/after

Before: `TRANSPORT=CORE`, `SELECTION=LEGACY`.
After production initialization: `TRANSPORT=CORE`, `SELECTION=CORE`. `CAPABILITY`/`CONTINUITY`/`MEDIA_PREPARATION` unaffected (`LEGACY`). The registry's default map and its `transferToLegacy`-does-not-exist guarantee are both unchanged and re-verified by test.

## 15. Proof SELECTION=CORE

`wireProductionCore.buildWiredCore()` calls `core._transferDomainToCore(Domain.SELECTION)` immediately after the Transport transfer, then installs the Selection sink. `signal-path-low-risk.test.js`'s "SLICE-3 production ownership is TRANSPORT=CORE and SELECTION=CORE" statically asserts the transfer call exists; `selection-authority.test.js`'s ownership tests prove a domain left `LEGACY` structurally cannot commit (`DOMAIN_NOT_OWNED_BY_CORE`).

## 16. Proof TRANSPORT=CORE unchanged

`wireProductionCore.js`'s Transport wiring (transfer call, observation sink installation, `TransportAuthority` construction) is untouched. All 39/39 Slice 1D physical tests and the full Slice 2 signal-path assertions still pass (see items 40/41).

## 17. Production Selection subscriber inventory

- `AudioContext.js`: direct `useProductionSelection()` subscription, joined into `state` (mirrors the existing `canonicalTransport` join pattern exactly) — feeds `currentTrack`/`currentTrackId`/`queue`/`queueIndex`/`repeatMode`/`shuffle` to every `useAudioPlayer()` consumer.
- `PlaybackStateMachine`: subscribes to `subscribeCanonicalSelection` lazily (on first `subscribeContext`/`subscribeIdentity` call — see item 51 for why not eagerly) and re-projects into its own `usePlaybackContext()`/`usePlaybackIdentity()` compatibility channels.

Production Core Selection subscribers are greater than zero via two independent, genuine paths.

## 18. Legacy consumer migration inventory

Zero production components read Selection from anywhere legacy-owned. ~40 read-only consumer files identified by inventory (GlobalAudioPlayerBar, QueuePanel, ImmersivePreviewModal, AlbumTracklistSheet, MyMusicTab, HomeClient, ReleaseCardPlayButton, MusicTabCatalogPanels, AudioPhase10Bridge, PlaybackChromeIsland, CompactDockPlayer, FloatingMainPlayer) needed **zero code changes** — they consume `state.queue`/`state.currentTrack`/etc. via `useAudioPlayer()`, which is now transparently Core-derived.

## 19. Compatibility projections retained

`currentTrack`, `currentTrackId`, `queue`, `queueIndex`, `repeatMode`, `shuffle` remain available via `usePlaybackContext()`/`usePlaybackIdentity()`/`getContext()`, all derived from **one** Core Selection snapshot (`coreSelectionProjection()`), never three separate compatibility stores.

## 20. Direct track tap behavior

A standalone tap (`ReleaseCardPlayButton`, catalog rows) calls the existing `playQueue([track], 0)` public API, which proposes `setQueueAndSelect` before issuing the PLAY intent — queue, index, and NowPlaying commit in one transaction, never currentTrack-first-then-queue.

## 21. Album/playlist start behavior

`playQueueInternal`/`requestAuthoritativePlay`'s chokepoint call `setQueueAndSelect(fullAlbumArray, tappedIndex)` once; the atomic snapshot proof test (`4. album queue select middle item`) asserts exactly one commit for a 4-track album tapped at index 2.

## 22. NEXT behavior

`SelectionAuthority.next()` computes the target (respecting repeat/shuffle/skip-invalid) and commits atomically; `playNextInternal`/`onEnded`/`onError` all call it and then issue Transport execution with `alreadySelected: true`. Manual NEXT at the end of a non-repeating queue is a defined no-op (matches legacy); `autoAdvance` NEXT at the same boundary commits a silent wrap to track 1 and reports `endOfQueue: true` so the caller can decide not to start playback (matches legacy's exact UX).

## 23. PREVIOUS behavior

The existing `currentTime > 3s → seek to 0` short-circuit remains entirely in `playPreviousInternal`, unchanged, and never touches Selection. Only the actual previous-item case calls `SelectionAuthority.previous()`, which preserves legacy's specific asymmetry: PREVIOUS at the first track restarts track 1 (not a no-op), while NEXT at the last track (non-repeat, manual) *is* a no-op — an existing, intentional UX asymmetry, preserved exactly.

## 24. Repeat behavior

Migrated into Selection (`repeatMode` field of the Selection snapshot), consistent with `createDomainStores.js`'s own pre-existing comment deferring this exact decision to "when NowPlaying + Queue + QueueIndex migrate atomically." `SelectionAuthority` does not special-case `"one"` — restarting the current track is a Transport/seek concern the caller (`onEnded`) still owns, unchanged from legacy.

## 25. Shuffle behavior

Audited actual implementation: **B** — the queue stays stable; traversal uses a shuffled index-order mapping (`shuffleOrder`/`shufflePosition`), never a queue reorder. Migrated in full, including a real bug found and fixed during migration (item 37).

## 26. Queue insert behavior

`insertItem(entry, {atIndex, playNext})`. Empty queue → becomes the selection (matches legacy `enqueueTrack`). Non-empty → generalized to support inserting at any index (including before current, shifting `queueIndex` correctly) — legacy only ever exercised "insert after current" or "append," but the spec's own test plan requires "insert before current" as certified behavior, so the general case is implemented and tested, not just the two legacy call shapes.

## 27. Queue remove behavior

`removeItem(index)`. Before current → decrements index, same NowPlaying. Current item → **rejected** (`SELECTION_INVALID`), matching legacy's existing silent no-op exactly, now a defined, testable outcome instead of a silent return. Last item (not current) → shrinks the queue only.

## 28. Queue reorder behavior

`reorderQueue(fromIndex, toIndex)`. Rejects moving the currently-selected item itself (matches legacy). NowPlaying's identity is preserved across the move; `queueIndex` is recomputed with the exact same shift rule legacy already used (`from<playing<=to → playing-1`, mirrored for the reverse direction).

## 29. Duplicate track identity handling

Audited: the product queue **can** legally contain the same track twice (no dedup anywhere in the legacy code). `SelectionAuthority` never re-derives NowPlaying by identity search once an index is known — every identity-changing transition works in `(queue, index)` space, so `[A, B, A]` with `queueIndex=2` unambiguously means the second occurrence, verified by test.

## 30. ENDED → Selection transition

Slice 2's `PHYSICAL_ENDED → Core TransportAuthority ENDED` is unchanged. `onEnded` (legacy) requests Selection NEXT (`autoAdvance: true`) through the port after Transport-side bookkeeping; `SelectionAuthority` computes and commits the new snapshot; Transport does not choose media, matching the required conceptual flow exactly.

## 31. Session restore Selection behavior

`usePlaybackEffects.js` Effect 3 captures a `SelectionAuthority` context **before** its async local/server fetch, then proposes `restoreSelection` with that captured context once data resolves. Bootstrap-only in practice (Core starts at `selectionVersion: 0`); no resume-timing or background-lifecycle logic was touched.

## 32. Stale restore race

If the user selects anything between the fetch starting and resolving, `selectionVersionAtCapture` no longer matches at proposal time and the restore is rejected (`SELECTION_VERSION_STALE`) — the user's newer choice is never overwritten. Certified by test #20 and by the 250+ op stress test (which deliberately reuses stale captured contexts for ~70% of its RESTORE operations).

## 33. Mutable ref disposition

`queueRef`/`queueIndexRef`/`repeatModeRef`/`shuffleRef` remain, but strictly as read-only projections mirrored from Core via the pre-existing "SM Context Subscriber" effect (unchanged, zero code edits — it already read from `PlaybackStateMachine`'s snapshot, which is now itself Core-projected). `shuffledOrderRef`/`shufflePositionRef` were **deleted** — shuffle traversal state has no legacy mirror at all; it is Core-internal only. No code anywhere writes a Selection-shaped ref and later syncs Core from it — the direction is exclusively Core → ref.

## 34. Preload/deck Selection boundary

Preload code (`scheduleNextTrackPreload`, `useQueuePreloader`, `ProjectVideoPreloader`) only reads the (now Core-projected) `queueRef`/`queueIndexRef`/`state.queue` — none of it calls any `SelectionAuthority` transition. `DesiredStateReducer`'s `requestedMediaIdentity`/`requestedMediaEntry` (Slice 1C, unchanged/locked) is the **execution-target context** used for in-flight stale-work protection on the Transport side; `SelectionAuthority`'s `nowPlaying` is the **canonical selected media**. They are deliberately not conflated: `requestAuthoritativePlay` derives the Transport PLAY intent's `trackId`/`queueEntries`/`queueIndex` directly from the just-committed (or already-committed) Selection snapshot, so the two stay correlated without becoming the same store. Strengthening this further (e.g. a shared representation identity) is explicitly left to a future Media Identity slice.

## 35. Crossfade Selection boundary

No crossfade/Slice 11-12 handoff architecture was implemented or touched. Existing crossfade-adjacent code paths (deck preload, CS-mode hold-preview) remain physical-execution machinery; the only two Selection-authority calls they could ever need (a same-identity representation refresh) already exist for CS-mode via `updateNowPlayingRepresentation`, auto-routed, zero code change.

## 36. Atomic snapshot proof

`DomainStore` (Slice 0/1, unchanged) already guarantees deep-frozen, `structuredClone`'d, single-reference snapshots with independent per-domain subscription. `SelectionAuthority` commits exactly one `{nowPlaying, queue, queueIndex, repeatMode, shuffle, shuffleOrder, shufflePosition, selectionVersion, updatedAt}` object per transition — there is structurally no way to commit `queue` without `queueIndex`, since both are written in the same call to `CommitGate.propose()`. Test #26 asserts every observed subscriber snapshot satisfies `nowPlaying === queue[queueIndex]`.

## 37. Stale Selection race results

All required races pass: PLAY A → PLAY B (test #21), NEXT → PREVIOUS (test #22), a generalized stale-captured-context denial across every identity-changing transition (test #24), CoreEpoch rotation invalidating a captured context. **Bug found and fixed during migration**: the legacy shuffle algorithm (`advanceShuffleOrder`) only prevented an immediate repeat when the randomly-shuffled order happened to place the current track at position 0 — it did nothing for any other position, so a naive port of it failed test #10 (4 unique indices visited instead of 5) roughly half the time depending on the random draw. Root-caused and fixed by deterministically pinning position 0 to the current track when building a fresh shuffle order (`buildShuffleOrder`), rather than checking-and-swapping after the fact. Classified as an **INTENDED CORRECTION** (see item 39), not a regression — the legacy bug was silent (queue-length dependent, never surfaced as a crash) and is now fixed at the root.

## 38. 250+ operation stress result

260 randomized operations (SELECT/NEXT/PREVIOUS/REPLACE_QUEUE/REMOVE/INSERT/CLEAR/RESTORE) against a deterministic xorshift32 seed, ~70% of RESTORE attempts deliberately reusing a stale captured context. After every single operation (accepted or rejected): `queueIndex` is a valid integer in range, the empty invariant holds exactly, `nowPlaying === queue[queueIndex]` whenever `queueIndex >= 0`, `selectionVersion` is monotonically non-decreasing, and a rejected proposal leaves the snapshot reference byte-for-byte (`===`) unchanged. 0 failures.

## 39. Differential test result

- Shuffle retry-after-invalid-entry: legacy fell back to **linear** stepping (ignoring shuffle order) when the shuffle-picked candidate was unplayable; Core retries within the **same** shuffle order. **INTENDED CORRECTION** — a queue containing literally unplayable placeholder entries is an existing edge case; staying within shuffle order for retries is more correct and does not change the happy-path (valid-queue) behavior at all.
- `onError` auto-skip: legacy never wrapped on `repeatMode==="all"` (a third, independent, more restrictive traversal implementation); Core routes it through the same `SelectionAuthority.next()` used by `onEnded` and manual NEXT, so it now wraps consistently under repeat-all. **INTENDED CORRECTION** — documented, not silently introduced; unifies three previously-divergent "skip to next" implementations into one tested path.
- Legacy's `advanceShuffleOrder` immediate-repeat guard (item 37). **INTENDED CORRECTION.**
- Everything else (single/album selection, replace+select, insert/remove/reorder positions and index-shift arithmetic, PREVIOUS's `>3s` short-circuit and first-track-restarts semantics, empty-state shape, stopAfterEachTrack/sleep-timer special cases in `onEnded`) is byte-for-byte behavior-preserving.

## 40. Slice 1D regression totals

Physical suite: **39/39** (12 Slice 1D effect-authority cases, 18 Hardening-B cases, 8 differential cases, 1 DOM forwarding case) — identical count to Slice 2's certified total, zero regressions.

## 41. Slice 2 regression totals

`transport-authority.test.js`: **11/11**. Signal-path Transport assertions (SLICE-2 Core is the sole canonical Transport writer / physical media events are injected observations / production UI consumes Core Transport / production ownership / timeline throttling): **5/5**, all still green with zero edits to their assertions.

## 42. Playback Core totals

`test:core-invariants` (invariants.test.js + transport-authority.test.js + selection-authority.test.js): **219/219** — up from Slice 2's 178/178 baseline (+41 new Selection-domain cases: ownership, all 30 required test-plan items, representation transitions, and the 260-op stress test), plus one pre-existing `StoreKey` enumeration test updated in place for the 8→7 store-key consolidation.

## 43. Critical suite totals

- Auth/security: 247/247.
- Upload/HLS/media/storefront: 83/83.
- Release lifecycle: 23/23.
- Architecture contracts (signal-path-low-risk): 21/21 (added one new Slice 3 test, renamed/flipped one Slice 2→3 ownership test in place).
- Core + physical + critical aggregate: **632/632** (219 + 39 + 247 + 83 + 23 + 21).

## 44. Build result

`npm run build`: **PASS**, exit code 0. Next.js production compilation, all routes/pages generated, no errors.

## 45. Lint result

`npm run lint`: **PASS** — 0 errors, 241 warnings. The warnings are pre-existing, application-wide React-hooks/exhaustive-deps and image-optimization advisories (the same categories present before this slice); Slice 3 introduces zero new lint errors and zero new warning categories. Spot-checked every file this slice touched — all flagged lines are the established "refs excluded from dependency arrays" pattern already used throughout the codebase.

## 46. HLS preservation verdict

**PASS.** No HLS/upload/media file was touched. `test:admin-upload` (which includes the HLS manifest/generation-cutover/video-contract suites): 83/83.

## 47. WebAudio preservation verdict

**PASS.** `WebAudioEngine.js` was not modified. The persistent Web Audio graph/topology is untouched — Slice 3 has no interaction with the audio-processing chain at all (Selection is a logical-identity concern, entirely upstream of WebAudio).

## 48. Files created

Four: `lib/playback-core/selection/SelectionAuthority.js`, `lib/playback/selection-port.js`, `lib/playback-core/production/useProductionSelection.js`, `lib/playback-core/__tests__/selection-authority.test.js`. Plus this closure report and the writer-matrix CSV.

## 49. Files modified

Sixteen: `lib/playback-core/types/index.js`, `state/createDomainStores.js`, `core/PlaybackCore.js`, `production/wireProductionCore.js`, `adapters/ReactPlaybackAdapter.js`; `media/PlaybackStateMachine.js`; `lib/playback/PlaybackQueueCommands.js`, `PlaybackTransportCommands.js`, `PlaybackEventHandlers.js`, `usePlaybackPublicApi.js`, `usePlaybackEffects.js`, `usePlaybackRefs.js`, `usePlaybackDelegates.js`; `context/AudioContext.js`; `lib/playback-core/__tests__/invariants.test.js`; `lib/architecture/__tests__/signal-path-low-risk.test.js`.

## 50. Commits created

One closure commit for this slice, subject `feat(playback): migrate atomic selection domain to core`.

## 51. Remaining legacy Selection writers

**0.** Every previously-identified direct writer (`PlaybackQueueCommands.js`, `usePlaybackPublicApi.js`, `PlaybackTransportCommands.js`, `usePlaybackEffects.js`, `PlaybackEventHandlers.js`) now proposes through `SelectionAuthority`; `PlaybackStreamCommands.js`/`PlaybackCSCommands.js`/`PlaybackRecoveryCommands.js` write only same-identity representation patches, structurally rejected by `SelectionAuthority` if the identity ever mismatched. Static test ("SLICE-3 Core is the sole canonical Selection writer") mechanically confirms `CommitGate.js` is the only file under `playback-core` calling `_applyCommit`, and that the five protected legacy files never import `playback-core` at all.

**Note on a real timing bug found and fixed during this slice:** the initial implementation subscribed `PlaybackStateMachine` to Core Selection **eagerly, in its constructor** — but `playbackStateMachine` is a module-load-time singleton, constructed before `getProductionPlaybackCore()` ever wires and installs the Selection sink (that happens inside a hook body, during `AudioProvider`'s render). An eager subscription would have permanently bound to "no sink installed," silently dropping every future Selection commit's reactive notification (imperative reads via `getContext()` would still have been correct, since those recompute fresh every call — only the *reactive* channel would have gone stale). Fixed by making the bridge subscription lazy and idempotent, established on the first real `subscribeContext()`/`subscribeIdentity()` call — which `useSyncExternalStore`'s internal subscribe (a layout effect) guarantees happens only after `AudioProvider` has already rendered and wired Core once. Caught by re-deriving the production render/effect ordering by hand, not by a failing test (no test in this repo exercises PSM's singleton construction against a not-yet-wired Core) — documented here as a known blind spot for a future slice's test coverage.

## 52. Remaining mixed Selection consumers

**0.** No component consumes Core `queue` alongside legacy `queueIndex` or any equivalent split — the triple is served from exactly one Core-derived source (either `AudioContext.js`'s direct join or `PlaybackStateMachine`'s compatibility projection, both reading the same underlying Selection snapshot) everywhere it is read.

## 53. Blocker to Slice 3 closure

None. Every absolute closure condition passes.

# SLICE 3 CLOSED

Do not begin Slice 4.
