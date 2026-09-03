-- Peak concurrent "witnesses" (2mrrw's term for live viewers) for a broadcast.
-- Current count is never stored — it lives entirely in Supabase Realtime
-- Presence (see src/hooks/useLiveWitnessCount.js), which requires zero
-- per-viewer database rows. This column only ever tracks the high-water
-- mark, written by src/app/api/live/witness-peak/route.js whenever a
-- connected client observes a new local peak — never once per viewer.

alter table public.live_broadcasts
  add column if not exists peak_witnesses integer not null default 0;
