-- Logical deletion is distinct from archive/unpublish. Keep recordings, files,
-- credits and commerce history. Only the MFA-guarded service API invokes the RPC.
begin;
set local lock_timeout = '5s';

alter table public.releases add column if not exists deleted_at timestamptz;
alter table public.products add column if not exists deleted_at timestamptz;

create table public.release_deletions (
  slug text primary key,
  release_id uuid,
  product_id uuid,
  deleted_at timestamptz not null default now(),
  deleted_by uuid not null,
  prior_status text,
  release_type text
);
alter table public.release_deletions enable row level security;
revoke all on public.release_deletions from public, anon, authenticated, service_role;
grant select, insert on public.release_deletions to service_role;

create function public.release_is_deleted(p_slug text) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select exists(select 1 from public.release_deletions where slug = p_slug) $$;
revoke all on function public.release_is_deleted(text) from public;
grant execute on function public.release_is_deleted(text) to anon, authenticated, service_role;

-- Restrictive policies also constrain pre-existing permissive admin policies.
create policy releases_exclude_deleted on public.releases as restrictive
  for select to anon, authenticated using (deleted_at is null);
create policy products_exclude_deleted on public.products as restrictive
  for select to anon, authenticated using (deleted_at is null);
create function public.product_is_deleted(p_product_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select exists(select 1 from public.products where id = p_product_id and deleted_at is not null) $$;
revoke all on function public.product_is_deleted(uuid) from public;
grant execute on function public.product_is_deleted(uuid) to anon, authenticated, service_role;
create policy catalog_tracks_exclude_deleted on public.catalog_tracks as restrictive
  for select to anon, authenticated using (
    not public.release_is_deleted(album_slug) and not public.product_is_deleted(product_id));
create function public.track_release_is_deleted(p_release_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public
as $$ select exists(select 1 from public.releases where id = p_release_id and deleted_at is not null) $$;
revoke all on function public.track_release_is_deleted(uuid) from public;
grant execute on function public.track_release_is_deleted(uuid) to anon, authenticated, service_role;
create policy tracks_exclude_deleted on public.tracks as restrictive
  for select to anon, authenticated using (not public.track_release_is_deleted(release_id));
create policy release_drafts_exclude_deleted on public.release_drafts as restrictive
  for select to anon, authenticated using (not public.track_release_is_deleted(release_id));

create function public.guard_release_deletion() returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_deleted_at timestamptz;
begin
  if tg_op = 'DELETE' then
    if old.deleted_at is not null then
      raise exception 'Deleted release records must be retained' using errcode = '55000';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is not null then
    if new.slug is distinct from old.slug or new.deleted_at is distinct from old.deleted_at then
      raise exception 'Release deletion is immutable' using errcode = '55000';
    end if;
  end if;
  select deleted_at into v_deleted_at from public.release_deletions where slug = new.slug;
  if v_deleted_at is not null then
    if tg_table_name = 'products' then
      if new.active then
        raise exception 'Deleted releases cannot be reactivated' using errcode = '55000';
      end if;
    else
      if new.status <> 'archived' or new.storefront_visible then
        raise exception 'Deleted releases cannot be republished' using errcode = '55000';
      end if;
    end if;
    new.deleted_at := v_deleted_at;
  elsif new.deleted_at is not null then
    raise exception 'Use delete_release for release deletion' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_release_deletion() from public, anon, authenticated;
create trigger releases_deletion_guard before insert or update or delete on public.releases
  for each row execute function public.guard_release_deletion();
create trigger products_deletion_guard before insert or update or delete on public.products
  for each row execute function public.guard_release_deletion();

create function public.delete_release(p_id uuid, p_actor_id uuid,
  p_draft_only boolean default false, p_source text default 'auto') returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_release public.releases%rowtype;
  v_product public.products%rowtype;
  v_slug text;
  v_deleted_at timestamptz;
  v_prior_status text;
  v_type text;
begin
  -- Never accept a listener UUID supplied as actor by a compromised caller.
  if not exists(select 1 from public.admin_principals where user_id = p_actor_id)
     and not exists(select 1 from auth.users where id = p_actor_id and raw_app_meta_data->>'role' = 'admin') then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  if p_source not in ('auto','releases','catalog') or p_source is null then
    raise exception 'Invalid release source' using errcode = '22023';
  end if;
  if p_source <> 'catalog' then
    select * into v_release from public.releases where id = p_id for update;
  end if;
  if v_release.id is null and p_source <> 'releases' then
    select * into v_product from public.products where id = p_id;
    if v_product.release_id is not null then
      select * into v_release from public.releases where id = v_product.release_id for update;
    end if;
  end if;
  if v_release.id is null and v_product.id is null then
    return jsonb_build_object('ok', false, 'code', 'release_not_found');
  end if;
  if p_draft_only and (v_release.id is null or
      (v_release.deleted_at is null and v_release.status <> 'draft')) then
    return jsonb_build_object('ok', false, 'code', 'release_no_longer_draft');
  end if;
  v_slug := coalesce(v_release.slug, v_product.slug);
  if v_slug is null then
    raise exception 'Release identity is missing' using errcode = '23514';
  end if;
  if v_release.id is null and v_product.product_type not in ('single','feature','album') then
    return jsonb_build_object('ok', false, 'code', 'unsupported_release');
  end if;
  -- Lock every projection in deterministic order, including legacy slug mirrors.
  perform id from public.products
    where release_id = v_release.id or slug = v_slug or id = v_product.id
    order by id for update;
  v_prior_status := coalesce(v_release.status, case when v_product.active then 'published' else 'draft' end);
  v_type := coalesce(v_release.release_type, v_product.release_type, v_product.product_type);
  insert into public.release_deletions(slug,release_id,product_id,deleted_by,prior_status,release_type)
    values(v_slug,v_release.id,v_product.id,p_actor_id,v_prior_status,v_type)
    on conflict(slug) do nothing;
  select deleted_at into v_deleted_at from public.release_deletions where slug = v_slug;
  -- A linked commerce row may have an older alias. Tombstone each identity so
  -- neither its public URL nor a later sync can escape the shared lifecycle.
  insert into public.release_deletions(slug,release_id,product_id,deleted_by,deleted_at,prior_status,release_type)
    select p.slug,v_release.id,p.id,p_actor_id,v_deleted_at,v_prior_status,v_type
      from public.products p
      where p.release_id = v_release.id or p.slug = v_slug or p.id = v_product.id
    on conflict(slug) do nothing;
  if v_release.id is not null then
    update public.releases set deleted_at = v_deleted_at, status = 'archived',
      storefront_visible = false, upcoming_visible = false, unavailable_at = v_deleted_at
      where id = v_release.id and deleted_at is null;
    -- Cancel the obsolete physical-cleanup workflow; this lifecycle retains assets.
    delete from public.draft_deletion_jobs where release_id = v_release.id;
  end if;
  update public.products set deleted_at = v_deleted_at, active = false
    where (release_id = v_release.id or slug = v_slug or id = v_product.id) and deleted_at is null;
  return jsonb_build_object('ok',true,'slug',v_slug,'release_type',v_type,
    'deleted_at',v_deleted_at,'semantics','soft_delete','assets_retained',true,
    'deleted_slugs',(select jsonb_agg(slug) from public.release_deletions
      where slug = v_slug or (release_id = v_release.id and v_release.id is not null)));
end;
$$;
revoke all on function public.delete_release(uuid,uuid,boolean,text) from public, anon, authenticated;
grant execute on function public.delete_release(uuid,uuid,boolean,text) to service_role;
notify pgrst, 'reload schema';
commit;
