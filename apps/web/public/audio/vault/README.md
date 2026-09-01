Vault cinematic audio assets live here.

Expected optional files:
- `lock-click.mp3`
- `hydraulic-release.mp3`
- `door-grind.mp3`
- `vault-thunk.mp3`
- `ambient-hum.mp3`
- `hover-heartbeat.mp3`

The Vault audio controller checks for these files before creating reusable `Audio` instances. If files are absent, it falls back to subtle Web Audio synthesis or no-ops silently when playback is blocked.
