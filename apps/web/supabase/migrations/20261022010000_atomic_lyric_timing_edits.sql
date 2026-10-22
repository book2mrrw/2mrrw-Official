-- Additive lyric-only transaction for canonical recordings and legacy single products.
-- No content backfill, schema column changes, or alteration of prior credit RPCs.
BEGIN;
CREATE OR REPLACE FUNCTION public.commit_release_lyric_edit(p_release_ref_id uuid,p_expected_revision jsonb,p_lyrics jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.releases;p public.products;item jsonb;groups jsonb;
BEGIN
 SELECT * INTO r FROM public.releases WHERE id=p_release_ref_id AND deleted_at IS NULL FOR UPDATE;
 IF r.id IS NOT NULL THEN
  SELECT * INTO p FROM public.products WHERE release_id=r.id AND deleted_at IS NULL FOR UPDATE;
  PERFORM id FROM public.tracks WHERE release_id=r.id AND removed_from_release_at IS NULL ORDER BY id FOR UPDATE;
 ELSE
  SELECT * INTO p FROM public.products WHERE id=p_release_ref_id AND deleted_at IS NULL FOR UPDATE;
  IF p.id IS NULL OR p.release_id IS NOT NULL THEN RAISE EXCEPTION 'Use the canonical release identity' USING ERRCODE='22023';END IF;
  PERFORM id FROM public.catalog_tracks WHERE product_id=p.id AND removed_from_release_at IS NULL ORDER BY id FOR UPDATE;
 END IF;
 PERFORM public._credit_assert_revision(p_expected_revision,public._credit_revision(p_release_ref_id));
 IF jsonb_typeof(p_lyrics) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lyrics)>200 THEN RAISE EXCEPTION 'Invalid lyric recording list' USING ERRCODE='22023';END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_lyrics))<>jsonb_array_length(p_lyrics) THEN RAISE EXCEPTION 'Duplicate lyric recording' USING ERRCODE='22023';END IF;
 groups=public._credit_group_payload(CASE WHEN r.id IS NULL THEN 'product' ELSE 'release' END,p_release_ref_id,p.credits);
 FOR item IN SELECT value FROM jsonb_array_elements(p_lyrics) LOOP
  IF jsonb_typeof(item->'lyrics') IS DISTINCT FROM 'string' OR length(item->>'lyrics')>250000 OR item->>'lyrics' LIKE '[2mrrw-draft:%' THEN RAISE EXCEPTION 'Apply or remove unfinished lyric timing before saving' USING ERRCODE='22023';END IF;
  IF r.id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM public.tracks WHERE id=(item->>'id')::uuid AND release_id=r.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Recording does not belong to this release' USING ERRCODE='22023';END IF;
   PERFORM public._project_recording_credits('track',(item->>'id')::uuid,jsonb_build_object('lyrics',item->'lyrics'),groups);
  ELSIF (item->>'id')::uuid=p.id AND p.product_type IN ('single','feature') AND NOT EXISTS(SELECT 1 FROM public.catalog_tracks WHERE product_id=p.id AND removed_from_release_at IS NULL) THEN
   UPDATE public.products SET metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{lyrics}',item->'lyrics'),updated_at=clock_timestamp() WHERE id=p.id;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.catalog_tracks WHERE id=(item->>'id')::uuid AND product_id=p.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Recording does not belong to this product' USING ERRCODE='22023';END IF;
   PERFORM public._project_recording_credits('catalog_track',(item->>'id')::uuid,jsonb_build_object('lyrics',item->'lyrics'),groups);
  END IF;
 END LOOP;
 RETURN jsonb_build_object('revision',public._credit_revision(p_release_ref_id),'slug',COALESCE(r.slug,p.slug),'status',COALESCE(r.status,CASE WHEN p.active THEN 'published' ELSE 'draft' END),'release_type',COALESCE(r.release_type,p.release_type));
EXCEPTION WHEN invalid_text_representation OR check_violation THEN RAISE EXCEPTION 'Invalid lyric recording data; no edits were saved' USING ERRCODE='22023';
END;$$;
REVOKE ALL ON FUNCTION public.commit_release_lyric_edit(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_release_lyric_edit(uuid,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
