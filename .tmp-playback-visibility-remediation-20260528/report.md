# Playback Visibility Remediation (2026-05-28)

Implemented a targeted lifecycle fix for playback visibility where successful playback could reach `playbackState: "playing"` while `hasStarted` remained `false`.

## What was fixed

- Added a normalization guard in `AudioContext` state patching so successful states (`ready` / `playing` or `isPlaying: true`) auto-promote `hasStarted: true`.
- Added structured diagnostics (`PLAYBACK_VISIBILITY_INVARIANT_RECOVERED`) when a `playing + hasStarted:false` state is detected and corrected.
- Updated same-track replay/resume and interruption recovery paths to explicitly set `hasStarted: true` when returning to `playing`.
- Updated preview fallback and stream retry-success paths to set `hasStarted: true` when playback succeeds.
- Audited and aligned player visibility gates to support lifecycle-visible states (`loading`, `ready`, `playing`, `preview_fallback`) without changing UI design.

## Scope confirmation

- No orchestration redesign.
- No serialization model changes.
- No media engine bridge rewrite.
- No queue engine rewrite.
