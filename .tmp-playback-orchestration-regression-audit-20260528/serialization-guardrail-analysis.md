# Serialization guardrail analysis

## Guardrails introduced in refactor

- Serial queue: `commandQueueRef` chained at `src/context/AudioContext.js:2208-2210`
- Request IDs: `commandRequestIdRef` assigned at `2180-2182`
- Active command pointer: `activeCommandRef` set/cleared in `2185`, `2202-2204`
- Stale check: `2137`

## Over-restriction finding

- The stale check is keyed to mutable `activeCommandRef`, not to immutable command identity in queue context.
- Non-serial paths (notably `seek`, `2231`) can alter active pointer and over-restrict later queued work.
- This creates false stale drops for first-play and rapid play/resume/next interactions.

## Rapid interaction impact

- `play -> seek -> play` can race active pointer updates with queued serial operations.
- `play -> resume/recover` on visibility recovery also reuses same active pointer mechanics.
- Risk manifests as dropped command resolution (`false`) rather than explicit failure, making regression appear as silent no-op.
