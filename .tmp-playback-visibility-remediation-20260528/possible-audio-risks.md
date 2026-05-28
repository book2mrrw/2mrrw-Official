# Possible Audio Risks

- Invariant correction runs inside `patchState`; if future patches intentionally depend on `hasStarted:false` while `ready/playing`, those assumptions will now be normalized.
- Additional diagnostic emission (`PLAYBACK_VISIBILITY_INVARIANT_RECOVERED`) may increase warning volume if upstream callers continue producing invalid state combinations.
- Page-level `nowPlaying`/ambient visibility now permits `loading` and `ready` states; this is intentional for lifecycle continuity but could expose artwork earlier in transitions.
- No queue orchestration changes were made; existing queue race behavior remains outside this fix scope.
