-- Current Releases -> storefront projection authority.
-- Related release/product/track writes commit together; partial HTTP 207-style
-- success is no longer possible for the supported editor fields.

CREATE OR REPLACE FUNCTION public.commit_current_release_edit(
  p_release_ref_id uuid,
  p_title text,
  p_title_set boolean,
  p_price_cents integer,
  p_price_set boolean,
  p_genre text,
  p_genre_set boolean,
  p_release_date date,
  p_release_date_set boolean,
  p_track_lyrics jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_release public.releases;
  v_product public.products;
  v_item jsonb;
  v_rows integer;
BEGIN
  SELECT * INTO v_release FROM public.releases
   WHERE id = p_release_ref_id FOR UPDATE;

  IF FOUND THEN
    IF p_title_set THEN
      UPDATE public.releases SET title = p_title WHERE id = v_release.id;
    END IF;
    IF p_release_date_set THEN
      UPDATE public.releases SET release_date = p_release_date WHERE id = v_release.id;
    END IF;

    SELECT * INTO v_product FROM public.products
     WHERE release_id = v_release.id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.products
         SET title = CASE WHEN p_title_set THEN p_title ELSE title END,
             display_title = CASE WHEN p_title_set THEN p_title ELSE display_title END,
             price_cents = CASE WHEN p_price_set THEN p_price_cents ELSE price_cents END,
             release_date = CASE WHEN p_release_date_set THEN p_release_date ELSE release_date END,
             metadata = CASE WHEN p_genre_set
               THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('genre', p_genre)
               ELSE metadata END,
             updated_at = now()
       WHERE id = v_product.id;
    ELSIF v_release.status <> 'draft' THEN
      RAISE EXCEPTION 'published release has no storefront product projection';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_track_lyrics, '[]'::jsonb)) LOOP
      UPDATE public.tracks
         SET lyrics = COALESCE(v_item->>'lyrics', '')
       WHERE id = (v_item->>'id')::uuid
         AND release_id = v_release.id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN RAISE EXCEPTION 'track lyric target does not belong to release'; END IF;
    END LOOP;

    RETURN jsonb_build_object(
      'source', 'releases', 'slug', v_release.slug,
      'releaseType', v_release.release_type, 'status', v_release.status
    );
  END IF;

  SELECT * INTO v_product FROM public.products
   WHERE id = p_release_ref_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release not found'; END IF;

  UPDATE public.products
     SET title = CASE WHEN p_title_set THEN p_title ELSE title END,
         display_title = CASE WHEN p_title_set THEN p_title ELSE display_title END,
         price_cents = CASE WHEN p_price_set THEN p_price_cents ELSE price_cents END,
         release_date = CASE WHEN p_release_date_set THEN p_release_date ELSE release_date END,
         metadata = COALESCE(metadata, '{}'::jsonb)
           || CASE WHEN p_genre_set THEN jsonb_build_object('genre', p_genre) ELSE '{}'::jsonb END
           || CASE WHEN p_release_date_set THEN jsonb_build_object('release_date', p_release_date) ELSE '{}'::jsonb END,
         updated_at = now()
   WHERE id = v_product.id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_track_lyrics, '[]'::jsonb)) LOOP
    UPDATE public.catalog_tracks
       SET metadata = COALESCE(metadata, '{}'::jsonb) ||
         jsonb_build_object('lyrics', COALESCE(v_item->>'lyrics', ''))
     WHERE id = (v_item->>'id')::uuid
       AND product_id = v_product.id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'catalog track lyric target does not belong to product'; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'source', 'catalog', 'slug', v_product.slug,
    'releaseType', COALESCE(v_product.release_type, v_product.product_type),
    'status', CASE WHEN v_product.active THEN 'published' ELSE 'draft' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_release_visual_asset(
  p_release_ref_id uuid,
  p_asset_type text,
  p_object_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_release public.releases;
  v_product public.products;
  v_parent text;
BEGIN
  IF p_asset_type NOT IN ('cover', 'cover-video') THEN
    RAISE EXCEPTION 'unsupported visual asset type';
  END IF;
  v_parent := regexp_replace(p_object_key, '[^/]+$', '');

  SELECT * INTO v_release FROM public.releases
   WHERE id = p_release_ref_id FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_product FROM public.products
     WHERE release_id = v_release.id FOR UPDATE;

    IF p_asset_type = 'cover' THEN
      UPDATE public.releases SET cover_art_r2_key = p_object_key WHERE id = v_release.id;
      IF v_product.id IS NOT NULL THEN
        UPDATE public.products
           SET image_path = v_parent,
               cover_url = p_object_key,
               metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                 'cover_art_r2_key', p_object_key,
                 'artwork_revision', p_object_key
               ),
               updated_at = now()
         WHERE id = v_product.id;
      END IF;
    ELSE
      UPDATE public.releases
         SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'animated_cover_r2_key', p_object_key,
           'motion_revision', p_object_key
         )
       WHERE id = v_release.id;
      IF v_product.id IS NOT NULL THEN
        UPDATE public.products
           SET video_path = v_parent,
               metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                 'animated_cover_r2_key', p_object_key,
                 'motion_revision', p_object_key
               ),
               updated_at = now()
         WHERE id = v_product.id;
      END IF;
    END IF;
    RETURN jsonb_build_object(
      'source', 'releases', 'slug', v_release.slug,
      'releaseType', v_release.release_type, 'status', v_release.status,
      'assetRevision', p_object_key
    );
  END IF;

  SELECT * INTO v_product FROM public.products
   WHERE id = p_release_ref_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release not found'; END IF;
  IF p_asset_type = 'cover' THEN
    UPDATE public.products
       SET image_path = v_parent,
           cover_url = p_object_key,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'cover_art_r2_key', p_object_key,
             'artwork_revision', p_object_key
           ),
           updated_at = now()
     WHERE id = v_product.id;
  ELSE
    UPDATE public.products
       SET video_path = v_parent,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
             'animated_cover_r2_key', p_object_key,
             'motion_revision', p_object_key
           ),
           updated_at = now()
     WHERE id = v_product.id;
  END IF;
  RETURN jsonb_build_object(
    'source', 'catalog', 'slug', v_product.slug,
    'releaseType', COALESCE(v_product.release_type, v_product.product_type),
    'status', CASE WHEN v_product.active THEN 'published' ELSE 'draft' END,
    'assetRevision', p_object_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commit_current_release_edit(uuid, text, boolean, integer, boolean, text, boolean, date, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.promote_release_visual_asset(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_current_release_edit(uuid, text, boolean, integer, boolean, text, boolean, date, boolean, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_release_visual_asset(uuid, text, text) TO service_role;

