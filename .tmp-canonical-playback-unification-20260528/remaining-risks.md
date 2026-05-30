# Remaining Risks

- Full elimination of all silent catches in `AudioContext` is still pending; several remain in non-critical best-effort branches.
- Signed URL HEAD validation depends on upstream CORS/header availability; if upstream policies regress, strict validation will surface explicit errors.
- Playback entry points still exist across multiple UI modules (by design), but now converge through canonical track normalization + shared AudioContext pipeline.
