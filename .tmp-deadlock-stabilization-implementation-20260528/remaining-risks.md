# Remaining Risks

- Some non-critical best-effort playback paths outside this pass still include legacy catch-and-continue behavior.
- Existing metadata warnings in Next.js (`themeColor` in metadata export) remain outside the playback stabilization scope.
- Queue watchdog timeout thresholds may need runtime tuning under adverse network/device conditions.
- Recovery deferral loop uses bounded retries; extreme startup delays may still result in late seek application.
