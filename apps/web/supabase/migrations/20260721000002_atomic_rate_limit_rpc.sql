-- Atomic rate limit increment via INSERT ON CONFLICT DO UPDATE.
-- Returns the post-increment count and whether the request is within the limit.
-- Eliminates the SELECT → UPDATE race in the application layer.

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_key         text,
  p_route_key   text,
  p_id_hash     text,
  p_window_start timestamptz,
  p_expires_at  timestamptz,
  p_limit       int
)
RETURNS TABLE(new_count int, allowed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO public.api_rate_limits (key, route_key, identifier_hash, window_start, expires_at, count)
  VALUES (p_key, p_route_key, p_id_hash, p_window_start, p_expires_at, 1)
  ON CONFLICT (key) DO UPDATE
    SET count = api_rate_limits.count + 1
  RETURNING api_rate_limits.count INTO v_count;

  RETURN QUERY SELECT v_count, v_count <= p_limit;
END;
$$;
