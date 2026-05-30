# Remaining Risks — Phase 4.6

## Medium — requires live measurement

### Progress subscription edge cases
- **Risk:** Components still reading stale `currentTime` if they use deprecated context field directly.
- **Mitigation:** Removed from provider spread; migrated known consumers to `usePlaybackProgress()` / `getCurrentTime()`.
- **Residual:** Third-party or future code calling `useAudioPlayer().currentTime` gets `undefined`.
- **Action:** Grep for `.currentTime` from `useAudioPlayer` before deploy; add ESLint note if needed.

### Dynamic import first-open latency
- **Risk:** First modal/tab open may show brief Suspense null (no fallback spinner by design — matches DonateModal).
- **Mitigation:** Pattern already used for DonateModal.
- **Action:** Optional loading skeleton on first ImmersivePreviewModal open if users report delay.

## Low

### Hero preload=metadata
- **Risk:** Brief static poster before hero motion on slow networks.
- **Rollback:** Restore `preload="auto"`.

### Mobile hero pause when carousel active
- **Risk:** Hero motion stops while singles carousel videos play in view on mobile.
- **Intent:** Decoder budget per audit #6; hero resumes when carousel leaves view.

### Mobile ambient blur reduction
- **Risk:** Slightly less cinematic depth on mobile during playback.
- **Rollback:** Single line in `AmbientPlaybackBackground.js`.

### Shop/vault first-visit loading
- **Risk:** Printful products / exclusive catalog show loading state on first tab visit.
- **Mitigation:** Static fallbacks already exist for exclusive catalog.

## Out of scope (deferred from 4.5 audits)

| Item | Classification | Notes |
|------|----------------|-------|
| P2-1 Skip HEAD on stream JSON path | MEDIUM | `stream-client.js` — not in 4.6 scope |
| P2-4 Consolidate refreshLibrary + refreshAccountState | MEDIUM | Auth/page paired calls |
| P3-1 Subscribe Link vs hard nav | LOW | Playback continuity |
| Route-group lean layouts (auth routes) | MEDIUM | #8 in bottleneck report |
| Root provider stack split | MEDIUM | Larger architectural change |

## Not committed / not deployed

Changes are local only per user instruction. Recommend foundation smoke + Profiler validation on real iOS Safari before merge to `frontend-stable-foundation`.
