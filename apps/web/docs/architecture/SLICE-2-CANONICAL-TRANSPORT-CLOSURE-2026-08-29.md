# 2MRRW Slice 2 — Canonical Transport Authority Closure

Certification date: 2026-08-29  
Audited starting commit: `ef033c27203146574096a6bd2462ad226d8dc8d0`

## 1. Executive verdict

Playback Core is now the sole canonical Transport writer. Real media events enter Core as typed observations, pass independent commit-authority validation, and update independent status, timeline, and mode stores. Production UI consumes Core Transport. Selection remains legacy-owned and unmigrated.

## 2. Audited starting commit

The implementation started from `ef033c27203146574096a6bd2462ad226d8dc8d0`, the exact commit named by the precheck.

## 3. Pre-Slice Transport ownership graph

`UI -> Core intent/desired/effect authority -> legacy executor -> audio element -> legacy event handlers -> PlaybackStateMachine -> UI`

Commands were Core-governed, but physical Transport truth and UI state were legacy-owned.

## 4. Post-Slice Transport ownership graph

`UI -> Core intent/desired/effect authority -> legacy physical executor -> audio element -> neutral TransportObservation port -> Core TransportAuthority -> CommitGate -> Core DomainStores -> Core React/compatibility subscribers`

Selection takes a separate path and remains `PlaybackStateMachine -> Queue/NowPlaying/QueueIndex`.

## 5. Final Transport schema

| Field/group | Classification | Authority |
|---|---|---|
| status and derived booleans | CANONICAL_TRANSPORT | Core TransportStatus |
| network state, readiness, physical error/recovery | CANONICAL_TRANSPORT | Core TransportStatus |
| currentTime, duration, bufferedEnd | TRANSPORT_TIMELINE | Core presentation snapshot sourced from the physical element |
| volume, playbackRate | TRANSPORT_MODE | Core TransportMode; media/Web Audio remains executor |
| repeat, shuffle | SELECTION | Legacy queue-traversal policy until atomic Selection migration |
| DOM media events and readiness facts | PHYSICAL_OBSERVATION | Physical element; never canonical writers |
| scrub preview and compatibility booleans | PRESENTATION_ONLY | UI/adapters derived from Core |
| currentTrack, queue, queueIndex | SELECTION | Legacy |
| saved/resume position | CONTINUITY | Existing continuity machinery |
| entitlement/stream availability | CAPABILITY | Existing capability system |
| old PSM Transport-shaped patches | LEGACY_DUPLICATE | Demoted to observation proposals and never persisted as Transport |

## 6. TransportStatus schema

The coherent status enum is `IDLE`, `LOADING`, `BUFFERING`, `PLAYING`, `PAUSED`, `SEEKING`, `ENDED`, `ERROR`, `RECOVERING`, and `DEGRADED`. The store also carries error, end reason, network state, readiness, media identity, desired revision, source observation, observation sequence, and update time. `playing`, `paused`, `loading`, `buffering`, `seeking`, `ended`, `recovering`, and `degraded` are derived coherently from the enum rather than independently authored booleans.

## 7. TransportTimeline schema

`position`, `duration`, `bufferedEnd`, `mediaIdentity`, `desiredRevision`, `observationSequence`, `observedAt`, and `presentedAt`. The media element supplies the clock; Core publishes an immutable throttled presentation snapshot.

## 8. TransportMode schema

`volume`, `playbackRate`, `observationSequence`, and `updatedAt`. Repeat and shuffle are explicitly excluded because they control Selection traversal and must move with Queue/NowPlaying/QueueIndex.

## 9. Updated Transport Writer Matrix

The complete matrix is [SLICE-2-TRANSPORT-WRITER-MATRIX-2026-08-29.csv](./SLICE-2-TRANSPORT-WRITER-MATRIX-2026-08-29.csv). It accounts for every writer and consumer identified by the precheck plus the new Core authority path.

## 10. Exact legacy writers removed or demoted

`PlaybackStateMachine.updateContext` strips all migrated Transport keys before persistence. PlaybackHelperService, PlaybackEventHandlers, PlaybackStreamCommands, PlaybackTransportCommands, PlaybackRecoveryCommands, recovery-coordinator, usePlaybackEffects, and legacy public API execution paths are now physical executors, observation producers, compatibility producers, or Selection owners. None can reach a Core DomainStore directly.

## 11. Exact Core commit paths

Status: `reportTransportObservation -> installed sink -> TransportAuthority.observe -> CommitGate.propose -> transportStatus DomainStore`.  
Timeline: `reportTransportTimeline -> TransportAuthority.observeTimeline -> throttled flush -> CommitGate -> transportTimeline`.  
Mode: `reportTransportMode -> TransportAuthority.observeMode -> CommitGate -> transportMode`.

`CommitGate.js` remains the only production source file calling `DomainStore._applyCommit`.

## 12. Physical observation contract

The neutral vocabulary includes execution loading/result, play, playing, pause, waiting, stalled, can-play, seeking, seeked, ended, physical error, recovery started/completed/failed, and legacy compatibility projection. The neutral port imports neither Core internals nor a media engine. Production wiring injects exactly one sink; absence of the sink fails closed with `TRANSPORT_AUTHORITY_UNAVAILABLE`.

## 13. Observation correlation and authority strategy

Every observation context carries CoreEpoch, desiredRevision, sourceIntentId, media identity where available, request ID where available, source, and capture time. Core rejects epoch, revision, intent, or media mismatches. A valid physical effect does not grant commit authority; commit authority revalidates independently at observation time.

## 14. Play event handling

DOM `play` produces `PHYSICAL_PLAY` and can establish loading, not PLAYING. Canonical PLAYING requires correlated `playing` evidence or the existing iOS audibility watchdog's advancing physical clock evidence.

## 15. Pause event handling

User/emergency pause first advances desired authority. The physical pause effect receives a consume-once captured context. A superseded pause is rejected; an unintentional current pause while playback is still desired becomes RECOVERING rather than silently rewriting intent.

## 16. Waiting and stalled handling

The existing 500 ms anti-flicker filter remains at the observation edge. Current waiting/stalled facts can commit BUFFERING. Playing clears buffering. Stale timers carry their originally captured context and cannot overwrite a newer desired revision.

## 17. Seeking and seeked handling

Pointer/scrub preview remains presentation-only. Only a committed Core seek establishes a position target. Current physical seeking can then commit SEEKING; seeked must match the target tolerance before selecting the post-seek status. Timeline comes from the physical element.

## 18. Ended handling

Current physical ended commits canonical ENDED. It does not select another track. Existing legacy Selection logic may request NEXT, preserving the domain boundary until Slice 3.

## 19. Error and recovery handling

Current physical errors commit ERROR. Recovery execution reports RECOVERING, recovered, failed, or degraded observations through the captured Core context. Recovery coordination remains execution machinery and cannot write canonical Transport directly.

## 20. Async completion commit protection

Promise completion is only an observation/result. Old play, resume, retry, and recovery completions are rejected when CoreEpoch, desiredRevision, sourceIntentId, or media identity no longer matches. Tests prove old play after PAUSE, old resume after PAUSE, and old recovery after a newer PLAY cannot commit.

## 21. Core Transport store activation

The existing independent DomainStores are active in production with deterministic frozen initial snapshots, CommitGate-only writes, independent subscriptions, diagnostics, and no React ownership. Status, timeline, and mode remain separate stores.

## 22. Production Core subscriber inventory

- AudioProvider: direct Core TransportStatus subscription.
- `usePlaybackProgress`: direct Core TransportTimeline subscription.
- `usePlaybackTransport`: direct Core TransportStatus subscription.
- `usePlaybackIdentity`: legacy Selection identity joined with Core `playing` as separate domains.
- GlobalAudioPlayerBar: direct Core status subscription for orchestration display.
- PlaybackHelperService compatibility subscriptions: direct canonical status/timeline port subscriptions.
- GlobalMediaController: Core timeline read.

Production Core Transport subscribers are greater than zero.

## 23. Legacy consumer migration inventory

AudioContext, GlobalAudioPlayerBar, PlaybackChromeIsland consumers through `useAudioPlayer`, useMediaEngine, player progress, buffering, and recovery/error surfaces now receive Core Transport or a Core-derived compatibility projection. Element/bridge/audibility fallback selection in useMediaEngine was removed.

## 24. Compatibility projections retained

Legacy public shapes such as `isPlaying`, `playbackState`, `isBuffering`, `playbackNetworkState`, `currentTime`, and `duration` remain available, but are derived from Core snapshots. They are API compatibility projections, not writable authority. Selection identity remains a separate stable legacy external-store snapshot.

## 25. OwnershipRegistry before and after

Before: `TRANSPORT=LEGACY`, `SELECTION=LEGACY`.  
After production initialization: `TRANSPORT=CORE`, `SELECTION=LEGACY`.

The registry exposes no transfer-to-legacy operation.

## 26. Proof TRANSPORT=CORE

`wireProductionCore.buildWiredCore` transfers only `Domain.TRANSPORT` after engine/effect wiring and before observation sink installation completes. Runtime ownership and static architecture tests pass. TransportAuthority can commit only via CommitGate, and CommitGate refuses non-Core-owned domains.

## 27. Proof SELECTION=LEGACY

Production wiring never transfers `Domain.SELECTION`. Runtime ownership tests assert it remains legacy. NowPlaying, Queue, and QueueIndex are not written to Core stores by this slice. Requested media identity remains an execution target, not Selection ownership.

## 28. Timeline authority proof

Event handlers read `audio.currentTime`, `audio.duration`, and the physical buffered range. TransportAuthority never increments a synthetic position and never writes to the element clock. Seek execution still writes the physical element; Core only observes and presents its result.

## 29. React timeline cadence before and after

Before: the presentation channel could publish at requestAnimationFrame cadence, approximately 60–62.5 Hz.  
Measured test: 120 physical observations at 16 ms intervals (62.5 Hz) produced 8 Core presentation commits over 1.92 seconds (4.17 Hz), so React timeline subscribers received at most the deliberate ~4 Hz presentation cadence. The physical clock itself was not throttled.

## 30. Stale observation race results

All required play/pause/buffering/seek/error/recovery races pass. A dedicated nine-event matrix proves valid and stale handling for play, playing, pause, waiting, stalled, seeking, seeked, ended, and error. Stale observations leave the prior snapshot reference unchanged.

## 31. 100+ interleaving stress result

The stress test submits 120 interleaved play/pause/resume contexts. Exactly one newest observation is accepted; 119 obsolete contexts cannot commit. Final status is PLAYING from the newest authority.

## 32. Slice 1D regression totals

Physical suite: 39/39. This includes 12 Slice 1D effect-authority cases, 18 Hardening-B cases, 8 differential cases, and 1 DOM forwarding case. Emergency PAUSE, iOS synchronous unlock, stale audibility denial, and Selection scope containment remain green.

## 33. Full Playback Core totals

Playback Core invariant suite: 178/178. This includes all preexisting invariants, desired-state convergence, effect authority, ownership, the new Transport authority races, nine physical observation authority cases, 120-way stress, and timeline cadence.

## 34. Critical suite totals

- Auth/security: 247/247.
- Upload/HLS/media/storefront: 83/83.
- Release lifecycle: 23/23.
- Architecture contracts: 20/20.
- Core + physical + critical aggregate: 590/590.

## 35. Build result

`npm run build`: PASS. Next.js 16.2.4 production compilation, TypeScript, page-data collection, and all 66 static-page generations completed. Existing metadata deprecation/configuration warnings remain outside Slice 2.

## 36. Lint result

`npm run lint`: PASS with 0 errors and 245 warnings. The warnings are existing application-wide React hook, image, and related advisory debt; Slice 2 introduces no lint errors. They are reported rather than suppressed.

## 37. HLS preservation verdict

PASS. No HLS master, variant, key, encryption, ABR, segment, prewarm, R2 delivery, or buffer-gate architecture was changed. HLS/upload/media contract tests are 83/83.

## 38. WebAudio preservation verdict

PASS. The persistent Web Audio graph/topology was not rebuilt. WebAudioEngine only gained generic `seeking` forwarding. It imports no Playback Core internals and remains a physical executor/observation producer.

## 39. Files created

Seven files: TransportAuthority, neutral transport-observation port, production React Transport hook boundary, Transport authority tests, DOM transport event test, this closure report, and the writer matrix.

## 40. Files modified

Twenty-two existing files: package scripts; production player/context/media consumers; architecture tests; audio event contract/engine; Core authority, convergence, assembly, desired-state documentation, exports, production wiring, stores, and types; playback handlers/helpers/commands/effects; PSM; and visual/interactive authority documentation.

## 41. Commits created

One final closure commit is created for this slice with subject `feat(playback): consolidate canonical transport authority`. No partial dual-authority checkpoint is classified as closure.

## 42. Remaining legacy Transport canonical writers

`0`. Legacy Transport-shaped calls terminate at the observation/filter boundary and cannot persist migrated fields. The architecture suite mechanically verifies the single DomainStore write boundary and PSM stripping.

## 43. Remaining mixed Transport consumers

`0`. Production components may join legacy Selection with Core Transport because those are different domains, but no component consumes Core and legacy versions of the same Transport field.

## 44. Blocker to Slice 2 closure

None. Every absolute closure condition passes. No migration is required. Slice 3 has not begun.

SLICE 2 CLOSED
