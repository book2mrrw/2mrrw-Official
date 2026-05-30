# Minimal Remediation Steps (Surgical)

1. In `playTrackInternal`, ensure all successful play paths set `hasStarted: true`.
   - Specifically in `isSameTrack` success path, set `hasStarted: true` before/with final `playing` patch.

2. Optional hardening:
   - In final success patch (`playbackState: "playing"`), also set `hasStarted: true` defensively.

3. Keep visibility contracts aligned:
   - `GlobalAudioPlayerBar` and `page.js` may continue gating on `hasStarted`; once lifecycle is fixed, they should render consistently.

4. Add one diagnostic guard:
   - Emit warning if `isPlaying || playbackState === "playing"` while `hasStarted` is false for more than one tick.

