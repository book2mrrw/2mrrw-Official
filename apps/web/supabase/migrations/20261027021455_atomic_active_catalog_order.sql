-- Track identity remains (album_slug, slug). Display order is unique among
-- active tracks only; retained removed recordings do not reserve live numbers.
-- A generated nullable key permits a deferrable constraint without extensions
-- or temporary renumbering. The ON CONFLICT identity arbiter stays immediate.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.catalog_tracks ADD COLUMN active_track_number integer
 GENERATED ALWAYS AS (CASE WHEN removed_from_release_at IS NULL THEN track_number END) STORED;
ALTER TABLE public.catalog_tracks ADD CONSTRAINT catalog_tracks_active_number_key
 UNIQUE(album_slug,active_track_number) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE public.catalog_tracks DROP CONSTRAINT catalog_tracks_album_slug_track_number_key;

CREATE OR REPLACE FUNCTION public.commit_release_publication(p_release_ref_id uuid,p_expected_revision jsonb,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.releases; oldp public.products; p public.products; item jsonb; ct public.catalog_tracks; tr public.tracks; update_r public.releases; groups jsonb; oldcredits jsonb; mergedmeta jsonb;
BEGIN
 SELECT * INTO STRICT r FROM public.releases WHERE id=p_release_ref_id AND deleted_at IS NULL FOR UPDATE;
 IF r.status NOT IN ('draft','scheduled','published') THEN RAISE EXCEPTION 'This release state cannot be published' USING ERRCODE='22023';END IF;
 SELECT * INTO oldp FROM public.products WHERE release_id=r.id AND deleted_at IS NULL FOR UPDATE;
 PERFORM id FROM public.tracks WHERE release_id=r.id AND removed_from_release_at IS NULL ORDER BY id FOR UPDATE;
 PERFORM id FROM public.catalog_tracks WHERE product_id=oldp.id OR album_slug=oldp.slug ORDER BY id FOR UPDATE;
 PERFORM public._credit_assert_revision(p_expected_revision,public._credit_revision(r.id));
 p=jsonb_populate_record(NULL::public.products,p_payload->'product');
 IF p.release_id IS DISTINCT FROM r.id OR p.content_kind IS DISTINCT FROM r.content_kind OR p.slug IS NULL OR btrim(p.title)='' THEN RAISE EXCEPTION 'Invalid publication target' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.products WHERE slug=p.slug AND (release_id IS DISTINCT FROM r.id OR deleted_at IS NOT NULL)) THEN RAISE EXCEPTION 'Catalog slug belongs to another release' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p_payload->'recordings') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'recordings')=0 THEN RAISE EXCEPTION 'A published release needs a recording' USING ERRCODE='22023';END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_payload->'recordings'))<>jsonb_array_length(p_payload->'recordings') THEN RAISE EXCEPTION 'Duplicate recording target' USING ERRCODE='22023';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'recordings') LOOP
   SELECT * INTO tr FROM public.tracks WHERE id=(item->>'id')::uuid AND release_id=r.id AND removed_from_release_at IS NULL;
   IF tr.id IS NULL OR tr.upload_status<>'ready' OR tr.audio_r2_key IS NULL THEN RAISE EXCEPTION 'Recording is not ready or does not belong to this release' USING ERRCODE='22023';END IF;
 END LOOP;
 IF p_payload?'credit_groups' THEN PERFORM public._set_credit_groups('release',r.id,p_payload->'credit_groups');END IF;
 groups=public._credit_group_payload('release',r.id,COALESCE(oldp.credits,p.credits));
 oldcredits=public._merge_credit_projection(COALESCE(p.credits,oldp.credits),groups);
 mergedmeta=COALESCE(oldp.metadata,'{}'::jsonb)||COALESCE(p.metadata,'{}'::jsonb);
 IF jsonb_typeof(oldp.metadata->'artist')='object' AND jsonb_typeof(p.metadata->'artist')='string' THEN mergedmeta=jsonb_set(mergedmeta,'{artist}',oldp.metadata->'artist'||jsonb_build_object('name',p.metadata->'artist'));END IF;
 INSERT INTO public.products(slug,title,display_title,content_kind,product_type,release_type,release_date,price_cents,active,release_id,storage_path,artwork_path,preview_path,video_path,cover_url,image_path,credits,metadata,gifting_enabled)
 VALUES(p.slug,p.title,p.display_title,p.content_kind,p.product_type,p.release_type,p.release_date,p.price_cents,p.active,r.id,p.storage_path,p.artwork_path,p.preview_path,p.video_path,p.cover_url,p.image_path,oldcredits,mergedmeta,COALESCE(oldp.gifting_enabled,p.gifting_enabled,false))
 ON CONFLICT(slug) DO UPDATE SET title=EXCLUDED.title,display_title=EXCLUDED.display_title,content_kind=EXCLUDED.content_kind,product_type=EXCLUDED.product_type,release_type=EXCLUDED.release_type,release_date=EXCLUDED.release_date,price_cents=EXCLUDED.price_cents,active=EXCLUDED.active,storage_path=EXCLUDED.storage_path,artwork_path=EXCLUDED.artwork_path,preview_path=EXCLUDED.preview_path,video_path=EXCLUDED.video_path,cover_url=EXCLUDED.cover_url,image_path=EXCLUDED.image_path,credits=EXCLUDED.credits,metadata=EXCLUDED.metadata,updated_at=clock_timestamp()
 RETURNING * INTO p;
 -- Defer only active order uniqueness, never the stable slug identity arbiter.
 SET CONSTRAINTS public.catalog_tracks_active_number_key DEFERRED;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'catalog_tracks','[]'::jsonb)) LOOP
   ct=jsonb_populate_record(NULL::public.catalog_tracks,item);
   IF ct.album_slug IS DISTINCT FROM p.slug THEN RAISE EXCEPTION 'Catalog album identity conflict' USING ERRCODE='22023';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.tracks WHERE id=ct.track_id AND release_id=r.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Catalog recording target does not belong to this release' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM public.catalog_tracks WHERE album_slug=ct.album_slug AND slug=ct.slug AND (product_id IS DISTINCT FROM p.id OR track_id IS DISTINCT FROM ct.track_id OR removed_from_release_at IS NOT NULL)) THEN RAISE EXCEPTION 'Catalog recording identity conflict' USING ERRCODE='22023';END IF;
   INSERT INTO public.catalog_tracks(slug,title,display_title,album_slug,track_number,position,product_id,track_id,storage_path,preview_path,lyrics,credits,featured_artists,metadata)
   VALUES(ct.slug,ct.title,ct.display_title,p.slug,ct.track_number,ct.position,p.id,ct.track_id,ct.storage_path,ct.preview_path,ct.lyrics,COALESCE(ct.credits,'{}'::jsonb),COALESCE(ct.featured_artists,'{}'::text[]),COALESCE(ct.metadata,'{}'::jsonb))
   ON CONFLICT(album_slug,slug) DO UPDATE SET title=EXCLUDED.title,display_title=EXCLUDED.display_title,track_number=EXCLUDED.track_number,position=EXCLUDED.position,storage_path=EXCLUDED.storage_path,preview_path=EXCLUDED.preview_path,lyrics=EXCLUDED.lyrics,credits=EXCLUDED.credits,featured_artists=EXCLUDED.featured_artists,metadata=public.catalog_tracks.metadata||EXCLUDED.metadata,updated_at=clock_timestamp();
 END LOOP;
 -- Force validation inside this function so duplicate final numbers roll back
 -- the entire publication and are reported through its existing error contract.
 SET CONSTRAINTS public.catalog_tracks_active_number_key IMMEDIATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'recordings') LOOP
   UPDATE public.tracks SET audio_r2_key=CASE WHEN item?'audio_r2_key' THEN item->>'audio_r2_key' ELSE audio_r2_key END,master_r2_key=CASE WHEN item?'master_r2_key' THEN item->>'master_r2_key' ELSE master_r2_key END,title=CASE WHEN item?'title' THEN item->>'title' ELSE title END,position=CASE WHEN item?'position' THEN (item->>'position')::integer ELSE position END,updated_at=clock_timestamp() WHERE id=(item->>'id')::uuid;
   PERFORM public._project_recording_credits('track',(item->>'id')::uuid,item,groups);
   -- Existing canonical recording allocations always outrank old client projections.
   IF NOT(item?'credit_groups') AND EXISTS(SELECT 1 FROM public.credit_groups WHERE track_id=(item->>'id')::uuid) THEN
     SELECT * INTO tr FROM public.tracks WHERE id=(item->>'id')::uuid;
     PERFORM public._project_recording_credits('track',tr.id,jsonb_build_object('credit_groups',public._credit_group_payload('track',tr.id,tr.draft_data->'public_credits')),groups);
   END IF;
 END LOOP;
 IF p_payload->'classifications' IS NOT NULL AND jsonb_typeof(p_payload->'classifications')='array' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'classifications') e WHERE NOT EXISTS(SELECT 1 FROM public.genre_taxonomy WHERE id=(e.value->>'taxonomy_id')::uuid AND active)) THEN RAISE EXCEPTION 'Invalid genre classification' USING ERRCODE='22023';END IF;
   DELETE FROM public.release_genre_classifications WHERE release_id=r.id;
   INSERT INTO public.release_genre_classifications(release_id,taxonomy_id,role,sort_order) SELECT r.id,(value->>'taxonomy_id')::uuid,value->>'role',(value->>'sort_order')::integer FROM jsonb_array_elements(p_payload->'classifications');
 END IF;
 update_r=jsonb_populate_record(r,p_payload->'release');
 IF update_r.status NOT IN ('published','scheduled') OR update_r.release_type IS DISTINCT FROM r.release_type OR update_r.slug IS DISTINCT FROM p.slug THEN RAISE EXCEPTION 'Invalid publication lifecycle' USING ERRCODE='22023';END IF;
 IF update_r.status='scheduled' AND (update_r.available_at IS NULL OR update_r.available_at<=clock_timestamp()) THEN RAISE EXCEPTION 'Scheduled publication must have a future release time' USING ERRCODE='22023';END IF;
 IF update_r.preorder_enabled AND (update_r.preorder_starts_at IS NULL OR update_r.preorder_price_cents IS NULL OR update_r.preorder_price_cents<0) THEN RAISE EXCEPTION 'Preorder configuration is incomplete' USING ERRCODE='22023';END IF;
 IF update_r.early_access_enabled AND (NOT update_r.preorder_enabled OR update_r.early_access_starts_at IS NULL) THEN RAISE EXCEPTION 'Early access configuration is incomplete' USING ERRCODE='22023';END IF;
 IF update_r.release_timezone IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=update_r.release_timezone) THEN RAISE EXCEPTION 'Invalid release timezone' USING ERRCODE='22023';END IF;
 UPDATE public.releases SET title=update_r.title,slug=update_r.slug,status=update_r.status,cover_art_r2_key=update_r.cover_art_r2_key,release_date=update_r.release_date,storefront_visible=update_r.storefront_visible,scheduled_at=update_r.scheduled_at,available_at=update_r.available_at,release_timezone=update_r.release_timezone,upcoming_visible=update_r.upcoming_visible,preview_before_release=update_r.preview_before_release,preorder_enabled=update_r.preorder_enabled,preorder_starts_at=update_r.preorder_starts_at,preorder_price_cents=update_r.preorder_price_cents,early_access_enabled=update_r.early_access_enabled,early_access_starts_at=update_r.early_access_starts_at,early_access_scope=update_r.early_access_scope,early_access_audiences=update_r.early_access_audiences,published_at=update_r.published_at,upc=update_r.upc,executive_producer=update_r.executive_producer,mixing_engineer=update_r.mixing_engineer,mastering_engineer=update_r.mastering_engineer,publishing_credits=update_r.publishing_credits,copyright_year=update_r.copyright_year,p_line=update_r.p_line,c_line=update_r.c_line,metadata=COALESCE(metadata,'{}'::jsonb)||COALESCE(update_r.metadata,'{}'::jsonb),updated_at=clock_timestamp() WHERE id=r.id;
 DELETE FROM public.release_drafts WHERE release_id=r.id;
 RETURN jsonb_build_object('product_id',p.id,'slug',p.slug,'status',update_r.status,'revision',public._credit_revision(r.id));
EXCEPTION WHEN no_data_found OR invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR check_violation OR unique_violation OR foreign_key_violation THEN RAISE EXCEPTION 'Publication validation failed; no catalog or credit changes were committed' USING ERRCODE='22023';
END; $$;

REVOKE ALL ON FUNCTION public.commit_release_publication(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_release_publication(uuid,jsonb,jsonb) TO service_role;
-- Removal uses durable recording IDs too: canonical tracks have no slug column.
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

  -- Same release -> product -> canonical tracks -> catalog lock order as publication.
  perform t.id from public.tracks t where t.release_id=v_release_id order by t.id for update;
  perform ct.id from public.catalog_tracks ct
   where ct.product_id=v_product_id or (ct.product_id is null and ct.album_slug=v_product_slug)
   order by ct.id for update;

  select t.id into v_track_id from public.tracks t
   where t.id=p_track_id and t.release_id=v_release_id;
  if v_track_id is null then
    select ct.id, t.id into v_catalog_track_id, v_track_id
     from public.catalog_tracks ct
     left join public.tracks t on t.id=ct.track_id and t.release_id=v_release_id
     where ct.id=p_track_id
       and (ct.product_id=v_product_id or (ct.product_id is null and ct.album_slug=v_product_slug));
  else
    select ct.id into v_catalog_track_id from public.catalog_tracks ct
     where ct.track_id=v_track_id
       and (ct.product_id=v_product_id or (ct.product_id is null and ct.album_slug=v_product_slug));
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


NOTIFY pgrst,'reload schema';
COMMIT;
