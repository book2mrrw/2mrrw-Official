# Remaining Risks

- Command queue serialization is implemented inside `AudioContext`; very deep async branches in internal helpers still require ongoing discipline to preserve determinism.
- Some non-critical silent catches remain elsewhere in the app outside touched playback-critical paths.
- Mobile/browser media-session edge cases (platform-specific) should be validated on physical iOS Safari and Android Chrome devices after deploy.
