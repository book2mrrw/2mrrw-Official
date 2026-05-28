# Verification Checklist

- [x] Build passes: `npm run build`
- [x] `AudioContext` normalizes `hasStarted` for `ready` / `playing` / `isPlaying:true`
- [x] Structured diagnostic added for recovered invariant violation
- [x] Same-track replay/resume path sets `hasStarted:true`
- [x] Stream retry success path sets `hasStarted:true`
- [x] Preview fallback success path sets `hasStarted:true`
- [x] Resume/recovery path sets `hasStarted:true`
- [x] Global player mount gate accepts lifecycle-visible states (`loading`, `ready`, `playing`, `preview_fallback`)
- [x] Page now-playing/ambient gates audited and aligned with lifecycle-visible states
