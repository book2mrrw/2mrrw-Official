# Deadlock Root Cause Fixed

- **Unbounded readiness wait** was causing command stalls when media readiness events never arrived.
  - Fixed by bounding `waitAudioSrcReady()` and surfacing typed readiness errors.
- **Serialized command queue starvation** could occur when one command hung indefinitely.
  - Fixed with per-command watchdog timeout, stale-command cleanup, and queue release fallback.
- **Emergency controls blocked behind unhealthy queue** could leave playback unrecoverable.
  - Fixed by explicit `STOP`/`PAUSE` bypass path that does not wait on unhealthy serial flow.
- **Recovery seek racing source readiness** could seek before stable queue/source initialization.
  - Fixed by deferred recovery seek sequencing in `AudioPhase10Bridge`.
