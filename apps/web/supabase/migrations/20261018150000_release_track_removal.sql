-- Release-scoped track removal. Keep track/catalog rows and their media/history
-- so purchased access, master revisions, track visuals, and HLS records survive.
begin;

alter table public.tracks
  add column if not exists removed_from_release_at timestamptz;

alter table public.catalog_tracks
  add column if not exists removed_from_release_at timestamptz;

create index if not exists tracks_active_release_position_idx
  on public.tracks (release_id, position)
  where removed_from_release_at is null;

create index if not exists catalog_tracks_active_product_position_idx
  on public.catalog_tracks (product_id, position)
  where removed_from_release_at is null and product_id is not null;

create or replace function public.remove_release_track(
  p_release_or_product_id uuid,
  p_track_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_release_id uuid;
  v_product_id uuid;
  v_release_slug text;
  v_product_slug text;
  v_release_type text;
  v_product_type text;
  v_status text;
  v_product_active boolean := false;
  v_track_id uuid;
  v_track_slug text;
  v_catalog_track_id uuid;
  v_removed_at timestamptz := now();
  v_remaining bigint;
begin
  select r.id, r.slug, r.release_type, r.status
    into v_release_id, v_release_slug, v_release_type, v_status
    from public.releases r
   where r.id = p_release_or_product_id
   for update;

  if v_release_id is not null then
    select p.id, p.slug, p.product_type, p.active
      into v_product_id, v_product_slug, v_product_type, v_product_active
      from public.products p
     where p.release_id = v_release_id
     limit 1
     for update;
  else
    -- Read the relationship first, then lock in the same release→product
    -- order used by release-ID requests. This prevents opposing lock order
    -- deadlocks when two authorized admin requests race on the same release.
    select p.id, p.slug, p.release_id, p.product_type, p.release_type, p.active
      into v_product_id, v_product_slug, v_release_id, v_product_type, v_release_type, v_product_active
      from public.products p
     where p.id = p_release_or_product_id;

    if v_product_id is not null and v_release_id is not null then
      select r.slug, r.release_type, r.status
        into v_release_slug, v_release_type, v_status
        from public.releases r
       where r.id = v_release_id
       for update;
    end if;

    if v_product_id is not null then
      select p.slug, p.product_type, p.release_type, p.active
        into v_product_slug, v_product_type, v_release_type, v_product_active
        from public.products p
       where p.id = v_product_id
       for update;
    end if;
  end if;

  if v_release_id is null and v_product_id is null then
    return jsonb_build_object('ok', false, 'code', 'release_not_found');
  end if;

  select t.id, t.slug
    into v_track_id, v_track_slug
    from public.tracks t
   where t.id = p_track_id
     and t.release_id = v_release_id
   for update;

  if v_track_id is null then
    select ct.id, ct.slug
      into v_catalog_track_id, v_track_slug
      from public.catalog_tracks ct
     where ct.id = p_track_id
       and (
         ct.product_id = v_product_id
         or (ct.product_id is null and ct.album_slug = v_product_slug)
       )
     for update;
  else
    select ct.id
      into v_catalog_track_id
      from public.catalog_tracks ct
     where ct.slug = v_track_slug
       and (
         ct.product_id = v_product_id
         or (ct.product_id is null and ct.album_slug = v_product_slug)
       )
     limit 1
     for update;
  end if;

  if v_track_id is null and v_catalog_track_id is null then
    return jsonb_build_object('ok', false, 'code', 'track_not_in_release');
  end if;

  if v_status in ('published', 'scheduled') or v_product_active then
    if (v_release_type is not null and lower(v_release_type) not in ('album', 'albums', 'ep', 'mixtape', 'mixtapes-and-eps'))
       or (v_release_type is null and lower(coalesce(v_product_type, '')) not in ('album', 'albums', 'ep', 'mixtape')) then
      return jsonb_build_object('ok', false, 'code', 'multi_track_release_required');
    end if;

    select count(*) into v_remaining
      from public.catalog_tracks ct
     where (ct.product_id = v_product_id or (ct.product_id is null and ct.album_slug = v_product_slug))
       and ct.removed_from_release_at is null
       and ct.id is distinct from v_catalog_track_id;

    if v_remaining = 0 then
      select count(*) into v_remaining
        from public.tracks t
       where t.release_id = v_release_id
         and t.removed_from_release_at is null
         and t.id is distinct from v_track_id;
    end if;

    if v_remaining = 0 then
      return jsonb_build_object('ok', false, 'code', 'last_track');
    end if;
  end if;

  if v_track_id is not null then
    update public.tracks
       set removed_from_release_at = v_removed_at,
           updated_at = v_removed_at
     where id = v_track_id;
  end if;

  if v_catalog_track_id is not null then
    update public.catalog_tracks
       set removed_from_release_at = v_removed_at,
           updated_at = v_removed_at
     where id = v_catalog_track_id;
  end if;

  if v_release_id is not null then
    with ordered as (
      select id, row_number() over (order by position, id)::integer as next_position
        from public.tracks
       where release_id = v_release_id
         and removed_from_release_at is null
    )
    update public.tracks t
       set position = ordered.next_position,
           updated_at = v_removed_at
      from ordered
     where t.id = ordered.id
       and t.position is distinct from ordered.next_position;
  end if;

  if v_product_id is not null then
    with ordered as (
      select id, row_number() over (order by position, id)::integer as next_position
        from public.catalog_tracks
       where (product_id = v_product_id or (product_id is null and album_slug = v_product_slug))
         and removed_from_release_at is null
    )
    update public.catalog_tracks ct
       set position = ordered.next_position,
           updated_at = v_removed_at
      from ordered
     where ct.id = ordered.id
       and ct.position is distinct from ordered.next_position;
  end if;

  return jsonb_build_object(
    'ok', true,
    'track_id', coalesce(v_track_id, v_catalog_track_id),
    'removed_at', v_removed_at
  );
end;
$$;

revoke all on function public.remove_release_track(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remove_release_track(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
commit;
