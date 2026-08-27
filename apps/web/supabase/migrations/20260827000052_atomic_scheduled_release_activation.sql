-- Instant-publication audit follow-up: releases.status and products.active
-- were two independently-writable fields, updated by two separate requests
-- from the scheduled-publish cron with no shared transaction. A failure of
-- the second write (logged as a warning only) could leave a release
-- permanently split-brained: releases.status='published' while
-- products.active stays false, or the reverse on any future divergent path.
-- This RPC makes the cross-table transition atomic and idempotent — safe to
-- call repeatedly (a release already activated, or not yet due, is a no-op).

begin;

set local lock_timeout = '5s';

create or replace function public.activate_scheduled_release(
  p_release_id uuid,
  p_now timestamptz default now()
) returns table (activated boolean, release_id uuid, slug text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
begin
  update public.releases
    set status = 'published',
        storefront_visible = true,
        published_at = coalesce(published_at, p_now)
    where id = p_release_id
      and status = 'scheduled'
      and available_at is not null
      and available_at <= p_now
    returning slug into v_slug;

  if v_slug is null then
    -- Not due, already activated, or not in a scheduled state — safe no-op.
    return query select false, p_release_id, null::text;
    return;
  end if;

  update public.products
    set active = true
    where release_id = p_release_id;

  return query select true, p_release_id, v_slug;
end;
$$;

revoke all on function public.activate_scheduled_release(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.activate_scheduled_release(uuid, timestamptz) to service_role;

commit;
