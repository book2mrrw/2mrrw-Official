# 11 Stability Score and Risks

## Rubric (100 points)
- 25 pts: Public endpoint reachability/redirect correctness
- 25 pts: Cross-origin CORS behavior on critical cross-app endpoints
- 20 pts: Stream API guard behavior consistency (unauth/auth branches)
- 15 pts: Env/runtime dependency clarity and alignment
- 15 pts: Observability completeness (probe + console coverage)

## Score (current pass)
- Reachability/redirect: **24/25** (www reachable; apex -> www redirect confirmed)
- CORS behavior: **23/25** (Control endpoints good on tested origins)
- Stream guard behavior: **14/20** (401 unauthenticated confirmed; authenticated success/failure branches not directly captured)
- Env/runtime clarity: **12/15** (name inventory complete; cross-env consistency unknown without dashboard validation)
- Observability completeness: **8/15** (non-auth probe evidence strong; full authenticated console capture not completed)

## Production stability score: **81/100**

## Current-state risk inventory (evidence-based)
1. **Session-dependent stream behavior remains partially unverified**  
   - Authenticated success/403/409 branches not directly captured in this pass (`src/app/api/library/stream/route.js:43`, `:75`+; `src/context/AudioContext.js:770`-`:782`).
2. **r2.dev configuration dependency remains hard-linked in runtime paths**  
   - Active references in both repos (`10-r2dev-dependency-audit.md`).
3. **Apex callers can hit redirect hops for API paths**  
   - `https://2mrrw.com/api/account/state` probe returns 307 to www.
