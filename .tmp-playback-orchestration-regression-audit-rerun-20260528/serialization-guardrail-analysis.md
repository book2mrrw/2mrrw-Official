# Serialization Guardrail Analysis

## Guardrail design
- Serial queue is intended to enforce deterministic command ordering.
- Implemented via a single promise chain in `commandQueueRef`.

## Over-blocking finding
- Queue is globally serialized for nearly all commands, including recovery-critical commands (`PAUSE`, `RESUME`, `STOP`, `NEXT`, `PREV`).
- A single unresolved command blocks all subsequent serialized commands.
- No watchdog timeout, cancellation fallback, or queue circuit-breaker exists for hung command execution.

## Verdict
- **Serialization guardrails are over-blocking: YES**.
- This over-blocking is the primary amplifier for observed regressions.

## File-level failure
- `src/context/AudioContext.js` (`dispatchPlaybackCommand`, `commandQueueRef` chaining).
