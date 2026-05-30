# Risks and Scalability

## Architectural Risks

1. Policy logic is not single-sourced; growth will amplify drift incidents.
2. Legacy fallback branches increase cognitive and test surface.
3. Cross-device entitlement propagation is pull-based; stale access windows likely at scale.
4. Client local playlist/library state can misrepresent authoritative access.
5. Collector entitlement combines multiple models (table rows, flags, slug heuristics).
6. Stream eligibility and UI eligibility can diverge under timing or stale payloads.
7. Entitlement state shape is broad and loosely normalized (`permissions`, booleans, ownership arrays, sources).
8. Many callsites perform entitlement-triggered refreshes manually, making completeness hard to guarantee.

## Scalability Pressure Points

- More entitlement types will multiply duplicate decision branches.
- More devices/sessions per user will make eventual consistency more visible.
- New catalog classes (bundles, vault tiers, timed unlocks) will likely require central policy engine abstraction.

## Consolidation Recommendations (Read-Only)

- Create backend entitlement evaluator returning explicit per-slug access facets:
  - `canStream`, `previewOnly`, `canAddToLibrary`, `canAddToPlaylist`, `showPrice`, `entitlementReason`
- Return evaluator output directly in account-state/catalog payloads.
- Treat frontend as display-only for entitlement outcomes.
- Introduce `entitlements_version` + timestamp and invalidate frontend state when changed.
- Normalize collector/subscriber/vault/admin into one contract and one status taxonomy.
- Keep `/api/library/stream` as hard authority, but share exact policy function with account-state endpoint.
