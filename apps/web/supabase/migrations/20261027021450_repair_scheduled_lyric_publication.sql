-- Qualify table columns against the RETURNS TABLE output variables.
-- Preserve the atomic, exactly-one-product transition and refuse tombstones.
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
  v_product_count integer;
begin
  update public.releases as r
    set status = 'published',
        storefront_visible = true,
        published_at = coalesce(r.published_at, p_now),
        updated_at = clock_timestamp()
    where r.id = p_release_id
      and r.deleted_at is null
      and r.status = 'scheduled'
      and r.available_at is not null
      and r.available_at <= p_now
    returning r.slug into v_slug;

  if v_slug is null then
    -- Not due, already activated, or not in a scheduled state — safe no-op.
    return query select false, p_release_id, null::text;
    return;
  end if;

  update public.products as p
    set active = true, updated_at = clock_timestamp()
    where p.release_id = p_release_id and p.deleted_at is null;
  get diagnostics v_product_count = row_count;

  if v_product_count <> 1 then
    -- Zero rows: no product exists for this release — the split-brain case
    -- this function exists to prevent. More than one: release_id is not
    -- actually unique on products in the schema, and this function's
    -- guarantee depends on it being so in practice; either way, committing a
    -- status flip without a confirmed 1:1 product transition is unsafe.
    -- Raising here rolls back the releases update above in the same
    -- transaction — the release stays 'scheduled' and the next cron tick
    -- retries it, rather than silently going live with no active product.
    raise exception
      'activate_scheduled_release: release % expected exactly one products row, found %',
      p_release_id, v_product_count;
  end if;

  return query select true, p_release_id, v_slug;
end;
$$;

revoke all on function public.activate_scheduled_release(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.activate_scheduled_release(uuid, timestamptz) to service_role;

commit;
