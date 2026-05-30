# Minimal fix plan (surgical)

1. Remove or narrow stale guard at `src/context/AudioContext.js:2137`
   - Execute queued command unconditionally once `run()` has bound that command.
   - If stale behavior is needed, compare against immutable queue token local to `run`, not shared mutable ref.

2. Keep serialization; decouple non-serial commands from active play token
   - Do not let non-serial `seek` overwrite play command validity tracking.
   - Maintain diagnostics logging unchanged.

3. Preserve existing API surface
   - No UI handler rewrites.
   - No playback architecture rewrite.
   - No state model redesign.

4. Add targeted assertions/tests (or temporary diagnostics)
   - Verify first `PLAY_TRACK`/`PLAY_QUEUE` always enters `playTrackInternal`.
   - Verify `hasStarted` and `currentTrack` set on first play.
   - Verify `play + rapid seek + next` does not drop transport commands.

5. Smoke verify
   - Singles/Features/Albums one-tap start.
   - Global player bar appears after first play.
   - Rapid play/resume/next interactions remain responsive.
