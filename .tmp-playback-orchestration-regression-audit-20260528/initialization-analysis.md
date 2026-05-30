# Initialization analysis

## Playback controller readiness

- Provider mounts hidden `<audio>` element in `src/context/AudioContext.js:2619-2627`.
- Gesture unlock and web-audio priming are registered in `600-647`.
- Web-audio graph init is defensive (`549-598`) and degrades to direct audio if unavailable.

## App-load race checks

- No blocking dependency found that would prevent initial command dispatch from UI handlers.
- `page.js` dispatches playback from open handlers (`1130`, `1161`, `1191`) and card handlers (`1027`, `1032`, `1046`).

## Regression location relative to init

- Initialization primitives are present and not the first failure.
- First observed fail-stop is orchestration layer command gating (`2137`) before any start-state patch occurs.

## Conclusion

Controller/hydration readiness is not the root failure; command execution invalidation prevents first-play bootstrap from reaching initialization side effects.
