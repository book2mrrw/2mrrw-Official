-- Precise, permanent per-fan coordinates. Previously every city-dot on the
-- Global Analytics map was re-derived at render time from a ~166-entry
-- hardcoded CITY_COORDS table matched against free-text city/state/country —
-- anything outside that table silently collapsed onto its country's center
-- point, and the table could only grow by someone hand-editing it.
--
-- This moves resolution to write time (once per profile, cached forever here)
-- via a pluggable geocoder (src/lib/geo/geocode-profile.js): the curated table
-- stays as the free first tier, falling through to a real geocoding provider
-- when one is configured (MAPBOX_GEOCODING_TOKEN). Nullable and unbackfilled —
-- existing rows resolve via /api/admin/geo/backfill or their next
-- city/state/country write, and the map's existing centroid fallback covers
-- any row that never resolves, so nothing regresses for unresolved fans.
alter table public.profiles
  add column if not exists geo_lat numeric(9, 6),
  add column if not exists geo_lng numeric(9, 6),
  add column if not exists geo_source text,
  add column if not exists geo_resolved_at timestamptz;

create index if not exists profiles_geo_resolved_idx
  on public.profiles (geo_resolved_at)
  where geo_lat is not null;
