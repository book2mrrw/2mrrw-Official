-- Companion to 20261021010000; verified source schema snapshot is in docs/credits.
-- Storage copies and encoding jobs may be prepared before this transaction.
-- Public catalog, recording metadata, private allocations and lifecycle commit together.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_release_publication_revision(p_release_ref_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public._credit_revision(p_release_ref_id); $$;

CREATE OR REPLACE FUNCTION public.commit_release_publication(p_release_ref_id uuid,p_expected_revision jsonb,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.releases; oldp public.products; p public.products; item jsonb; ct public.catalog_tracks; tr public.tracks; update_r public.releases; groups jsonb; oldcredits jsonb; mergedmeta jsonb;
BEGIN
 SELECT * INTO STRICT r FROM public.releases WHERE id=p_release_ref_id AND deleted_at IS NULL FOR UPDATE;
 IF r.status NOT IN ('draft','scheduled','published') THEN RAISE EXCEPTION 'This release state cannot be published' USING ERRCODE='22023';END IF;
 SELECT * INTO oldp FROM public.products WHERE release_id=r.id AND deleted_at IS NULL FOR UPDATE;
 PERFORM id FROM public.tracks WHERE release_id=r.id AND removed_from_release_at IS NULL ORDER BY id FOR UPDATE;
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
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'catalog_tracks','[]'::jsonb)) LOOP
   ct=jsonb_populate_record(NULL::public.catalog_tracks,item);
   IF NOT EXISTS(SELECT 1 FROM public.tracks WHERE id=ct.track_id AND release_id=r.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Catalog recording target does not belong to this release' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM public.catalog_tracks WHERE album_slug=ct.album_slug AND slug=ct.slug AND (product_id IS DISTINCT FROM p.id OR track_id IS DISTINCT FROM ct.track_id OR removed_from_release_at IS NOT NULL)) THEN RAISE EXCEPTION 'Catalog recording identity conflict' USING ERRCODE='22023';END IF;
   INSERT INTO public.catalog_tracks(slug,title,display_title,album_slug,track_number,position,product_id,track_id,storage_path,preview_path,lyrics,credits,featured_artists,metadata)
   VALUES(ct.slug,ct.title,ct.display_title,p.slug,ct.track_number,ct.position,p.id,ct.track_id,ct.storage_path,ct.preview_path,ct.lyrics,COALESCE(ct.credits,'{}'::jsonb),COALESCE(ct.featured_artists,'{}'::text[]),COALESCE(ct.metadata,'{}'::jsonb))
   ON CONFLICT(album_slug,slug) DO UPDATE SET title=EXCLUDED.title,display_title=EXCLUDED.display_title,track_number=EXCLUDED.track_number,position=EXCLUDED.position,storage_path=EXCLUDED.storage_path,preview_path=EXCLUDED.preview_path,lyrics=EXCLUDED.lyrics,credits=EXCLUDED.credits,featured_artists=EXCLUDED.featured_artists,metadata=public.catalog_tracks.metadata||EXCLUDED.metadata,updated_at=clock_timestamp();
 END LOOP;
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

CREATE OR REPLACE FUNCTION public.save_release_credit_draft(p_release_id uuid,p_expected_saved_at timestamptz,p_payload jsonb,p_step_index integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.releases;d public.release_drafts;merged jsonb;datum jsonb;saved timestamptz=clock_timestamp();requested text;
BEGIN
 SELECT * INTO STRICT r FROM public.releases WHERE id=p_release_id AND deleted_at IS NULL FOR UPDATE;
 IF r.status<>'draft' THEN RAISE EXCEPTION 'Published releases cannot be overwritten as drafts' USING ERRCODE='40001';END IF;
 SELECT * INTO d FROM public.release_drafts WHERE release_id=r.id ORDER BY saved_at DESC NULLS LAST,id DESC LIMIT 1 FOR UPDATE;
 IF p_expected_saved_at IS DISTINCT FROM d.saved_at THEN RAISE EXCEPTION 'Draft changed in another editor; reload before saving' USING ERRCODE='40001';END IF;
 IF jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Draft payload must be an object' USING ERRCODE='22023';END IF;
 merged=COALESCE(d.draft_payload,'{}'::jsonb)||p_payload;
 datum=COALESCE(d.draft_payload->'data','{}'::jsonb)||COALESCE(p_payload->'data','{}'::jsonb);
 merged=jsonb_set(merged,'{data}',datum);
 requested=COALESCE(datum->>'release_type',r.release_type);
 IF requested NOT IN ('single','feature','album','ep','mixtape') THEN RAISE EXCEPTION 'Invalid release type' USING ERRCODE='22023';END IF;
 IF (requested IN ('album','ep','mixtape')) IS DISTINCT FROM (r.release_type IN ('album','ep','mixtape')) AND EXISTS(SELECT 1 FROM public.tracks WHERE release_id=r.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Remove uploaded tracks before changing media family' USING ERRCODE='22023';END IF;
 IF d.id IS NULL THEN INSERT INTO public.release_drafts(release_id,draft_payload,step_index,saved_at,updated_at) VALUES(r.id,merged,p_step_index,saved,saved);
 ELSE UPDATE public.release_drafts SET draft_payload=merged,step_index=p_step_index,saved_at=saved,updated_at=saved WHERE id=d.id;END IF;
 UPDATE public.releases SET release_type=requested,release_date=CASE WHEN datum?'release_date' THEN NULLIF(datum->>'release_date','')::date ELSE release_date END,cover_art_r2_key=COALESCE(NULLIF(datum->>'cover_key',''),cover_art_r2_key),metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('draft_title',datum->>'title','draft_step_index',p_step_index,'draft_genre_id',datum->>'genre_id','draft_subgenre_ids',COALESCE(datum->'subgenre_ids','[]'::jsonb),'draft_secondary_genre_ids',COALESCE(datum->'secondary_genre_ids','[]'::jsonb),'draft_price',datum->>'price')||CASE WHEN datum?'cover_video_key' THEN jsonb_build_object('animated_cover_r2_key',datum->'cover_video_key') ELSE '{}'::jsonb END,updated_at=clock_timestamp() WHERE id=r.id;
 RETURN jsonb_build_object('saved_at',saved);
END; $$;
REVOKE ALL ON FUNCTION public.get_release_publication_revision(uuid),public.commit_release_publication(uuid,jsonb,jsonb),public.save_release_credit_draft(uuid,timestamptz,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_release_publication_revision(uuid),public.commit_release_publication(uuid,jsonb,jsonb),public.save_release_credit_draft(uuid,timestamptz,jsonb,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
