-- Nine analytics functions, the rate-limit counter and the shared HLS job
-- claim are SECURITY DEFINER and were executable by PUBLIC — so by anon and
-- authenticated through PostgREST (/rest/v1/rpc/<name>) with the public anon
-- key every page ships. None of them checks its caller: anyone could read
-- revenue, subscription, funnel, attribution, cohort and listening statistics,
-- inflate any client's rate-limit window, or claim (and so stall) transcode
-- jobs. Found 2026-11-19 while restricting the video lanes' database login.
--
-- Every caller is server-side with the service role
-- (src/app/api/admin/analytics/*, src/lib/server/rate-limit.js, the
-- transcode workers), so execution is restricted to service_role. All
-- overloads by name; trigger functions are untouched (not callable).

BEGIN;

DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname = ANY (ARRAY[
         'get_attribution_breakdown', 'get_cohort_retention', 'get_funnel_stats',
         'get_listening_time_patterns', 'get_play_stats', 'get_regional_listening_patterns',
         'get_release_revenue_stats', 'get_subscription_stats', 'get_track_play_stats',
         'increment_rate_limit', 'hls_claim_next_job'
       ])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END;
$$;

COMMIT;
