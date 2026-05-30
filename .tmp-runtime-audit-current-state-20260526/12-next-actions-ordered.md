# 12 Next Actions (Ordered)

1. **Manual authenticated probe pass**  
   Capture `/api/library/stream` responses for entitled/non-entitled/concurrent-session states to close 403/409 evidence gaps.  
   Evidence gap source: `06-failed-request-inventory.md`, `07-playback-pipeline-audit.md`.

2. **Manual browser console capture (authenticated)**  
   Validate client-visible errors/warnings during stream upgrade and conflict handling in real session.  
   Code points: `src/context/AudioContext.js:992`, `:1027`, `:770`-`:782`; `src/app/api/library/stream/route.js:121`.

3. **Environment name-alignment check across deployed contexts**  
   Verify that required names in `08-env-audit.md` are consistently present in production/preview for both repos.

4. **Origin canonicalization hygiene check**  
   Confirm all runtime callers use `www` canonical origin for storefront API access to avoid redirect hops observed in probes.

5. **r2.dev dependency tracking**  
   Keep active-vs-legacy map from `10-r2dev-dependency-audit.md` as a baseline for future migration verification.
