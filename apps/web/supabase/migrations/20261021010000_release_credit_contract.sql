-- Verified against frontend project qvfbgkbgczyqrglvgyqr on 2026-10-21.
-- Additive: no backfill, no invented contributors/allocations/identifiers.
-- Financial release_collaborators rows and semantics are unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS public.credit_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_id uuid REFERENCES public.releases(id) ON DELETE CASCADE,
 product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
 track_id uuid REFERENCES public.tracks(id) ON DELETE CASCADE,
 catalog_track_id uuid REFERENCES public.catalog_tracks(id) ON DELETE CASCADE,
 category text NOT NULL CHECK (category IN ('songwriter','producer','featured_artist')),
 state text NOT NULL DEFAULT 'legacy' CHECK (state IN ('legacy','draft','complete','not_applicable')),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (num_nonnulls(release_id,product_id,track_id,catalog_track_id)=1),
 CHECK (category='producer' OR state<>'not_applicable')
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_groups_release_category ON public.credit_groups(release_id,category) WHERE release_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_groups_product_category ON public.credit_groups(product_id,category) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_groups_track_category ON public.credit_groups(track_id,category) WHERE track_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_groups_catalog_category ON public.credit_groups(catalog_track_id,category) WHERE catalog_track_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.credit_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.credit_groups(id) ON DELETE CASCADE,
 contributor_id uuid REFERENCES public.collaborators(id) ON DELETE RESTRICT,
 display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
 position integer NOT NULL CHECK (position>=0),
 percentage_hundredths integer CHECK (percentage_hundredths BETWEEN 0 AND 10000),
 UNIQUE(group_id,position)
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_assignments_identity ON public.credit_assignments(group_id,contributor_id) WHERE contributor_id IS NOT NULL;
ALTER TABLE public.credit_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.credit_groups, public.credit_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.credit_groups, public.credit_assignments TO service_role;
-- Directory mutation is available only through the authenticated server route.
REVOKE ALL ON public.collaborators FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT ON public.collaborators TO service_role;
COMMENT ON TABLE public.credit_groups IS 'Private editorial credit allocations. No payout or royalty calculation is implied. Legacy public credit JSON remains preserved.';

CREATE OR REPLACE FUNCTION public.credit_storage_capabilities() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('version',1,'private_allocations',true,'service_role_only',true);
$$;

CREATE OR REPLACE FUNCTION public.get_release_credit_edit_state(p_release_ref_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH targets AS (
   SELECT 'release'::text AS scope,r.id AS target_id,g.* FROM public.releases r JOIN public.credit_groups g ON g.release_id=r.id WHERE r.id=p_release_ref_id
   UNION ALL SELECT 'release',p.id,g.* FROM public.products p JOIN public.credit_groups g ON g.product_id=p.id WHERE p.id=p_release_ref_id AND p.release_id IS NULL
   UNION ALL SELECT 'recording',t.id,g.* FROM public.tracks t JOIN public.credit_groups g ON g.track_id=t.id WHERE t.release_id=p_release_ref_id AND t.removed_from_release_at IS NULL
   UNION ALL SELECT 'recording',t.id,g.* FROM public.catalog_tracks t JOIN public.credit_groups g ON g.catalog_track_id=t.id WHERE t.product_id=p_release_ref_id AND t.removed_from_release_at IS NULL
 ), categories AS (
   SELECT t.scope,t.target_id,t.category,t.revision,
     jsonb_build_object('state',t.state,'entries',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'contributor_id',a.contributor_id,'percentage',CASE WHEN a.percentage_hundredths IS NULL THEN '' ELSE to_char(a.percentage_hundredths::numeric/100,'FM990.00') END) ORDER BY a.position) FROM public.credit_assignments a WHERE a.group_id=t.id),'[]'::jsonb)) AS value
   FROM targets t
 ), bundles AS (
   SELECT scope,target_id,jsonb_object_agg(category,value) AS groups,jsonb_object_agg(category,revision) AS revision FROM categories GROUP BY scope,target_id
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('scope',scope,'target_id',target_id,'id',target_id,'revision',revision,'groups',groups) ORDER BY scope,target_id),'[]'::jsonb) FROM bundles;
$$;

CREATE OR REPLACE FUNCTION public._credit_revision(p_ref uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.releases; p public.products; ts jsonb; cs jsonb;
BEGIN
 SELECT * INTO r FROM public.releases WHERE id=p_ref;
 IF r.id IS NOT NULL THEN
   SELECT * INTO p FROM public.products WHERE release_id=r.id AND deleted_at IS NULL;
   SELECT COALESCE(jsonb_object_agg(id::text,updated_at),'{}'::jsonb) INTO ts FROM public.tracks WHERE release_id=r.id AND removed_from_release_at IS NULL;
 ELSE
   SELECT * INTO p FROM public.products WHERE id=p_ref AND deleted_at IS NULL;
   SELECT COALESCE(jsonb_object_agg(id::text,updated_at),'{}'::jsonb) INTO ts FROM public.catalog_tracks WHERE product_id=p.id AND removed_from_release_at IS NULL;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',value->'id','revision',value->'revision') ORDER BY value->>'scope',value->>'target_id'),'[]'::jsonb) INTO cs FROM jsonb_array_elements(public.get_release_credit_edit_state(p_ref));
 RETURN jsonb_build_object('release',r.updated_at,'product',p.updated_at,'tracks',ts,'credits',cs);
END; $$;

CREATE OR REPLACE FUNCTION public._credit_assert_revision(p_expected jsonb,p_actual jsonb) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE k text;
BEGIN
 IF p_expected IS NULL OR jsonb_typeof(p_expected)<>'object' THEN RAISE EXCEPTION 'Saved revision is required' USING ERRCODE='40001'; END IF;
 IF (p_expected->>'release')::timestamptz IS DISTINCT FROM (p_actual->>'release')::timestamptz OR (p_expected->>'product')::timestamptz IS DISTINCT FROM (p_actual->>'product')::timestamptz OR COALESCE(p_expected->'credits','[]'::jsonb)<>p_actual->'credits' THEN RAISE EXCEPTION 'Release changed since it was loaded' USING ERRCODE='40001'; END IF;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(COALESCE(p_expected->'tracks','{}'::jsonb)) key) IS DISTINCT FROM (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(p_actual->'tracks') key) THEN RAISE EXCEPTION 'Recording list changed' USING ERRCODE='40001'; END IF;
 FOR k IN SELECT jsonb_object_keys(p_actual->'tracks') LOOP
   IF (p_expected->'tracks'->>k)::timestamptz IS DISTINCT FROM (p_actual->'tracks'->>k)::timestamptz THEN RAISE EXCEPTION 'Recording changed' USING ERRCODE='40001'; END IF;
 END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public._set_credit_groups(p_kind text,p_id uuid,p_groups jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
<<credit_write>>
DECLARE category text; g jsonb; e jsonb; gid uuid; pos integer; pct integer; total integer; missing boolean; state text; identity uuid;
BEGIN
 IF jsonb_typeof(p_groups)<>'object' THEN RAISE EXCEPTION 'Credits must be an object' USING ERRCODE='22023'; END IF;
 FOR category,g IN SELECT key,value FROM jsonb_each(p_groups) LOOP
   IF category NOT IN ('songwriter','producer','featured_artist') OR jsonb_typeof(g)<>'object' OR jsonb_typeof(g->'entries')<>'array' OR jsonb_array_length(g->'entries')>200 THEN RAISE EXCEPTION 'Invalid credit category or entries' USING ERRCODE='22023'; END IF;
   state=g->>'state';
   IF state NOT IN ('legacy','draft','complete','not_applicable') OR state IS NULL OR (state='not_applicable' AND category<>'producer') THEN RAISE EXCEPTION 'Invalid allocation status' USING ERRCODE='22023'; END IF;
   SELECT id INTO gid FROM public.credit_groups WHERE (p_kind='release' AND release_id=p_id OR p_kind='product' AND product_id=p_id OR p_kind='track' AND track_id=p_id OR p_kind='catalog_track' AND catalog_track_id=p_id) AND credit_groups.category=credit_write.category FOR UPDATE;
   IF gid IS NULL THEN
     INSERT INTO public.credit_groups(release_id,product_id,track_id,catalog_track_id,category,state) VALUES(CASE WHEN p_kind='release' THEN p_id END,CASE WHEN p_kind='product' THEN p_id END,CASE WHEN p_kind='track' THEN p_id END,CASE WHEN p_kind='catalog_track' THEN p_id END,category,state) RETURNING id INTO gid;
   ELSE UPDATE public.credit_groups SET state=credit_write.state,revision=revision+1,updated_at=clock_timestamp() WHERE id=gid;
   END IF;
   DELETE FROM public.credit_assignments WHERE group_id=gid;
   pos=0;total=0;missing=false;
   FOR e IN SELECT value FROM jsonb_array_elements(g->'entries') LOOP
     IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(e->'name') IS DISTINCT FROM 'string' OR length(btrim(e->>'name')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Each credit requires a contributor name' USING ERRCODE='22023'; END IF;
     identity=NULLIF(e->>'contributor_id','')::uuid;
     IF identity IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.collaborators WHERE id=identity) THEN RAISE EXCEPTION 'Contributor identity no longer exists' USING ERRCODE='22023'; END IF;
     pct=NULL;
     IF category<>'featured_artist' AND COALESCE(e->>'percentage','')<>'' THEN
       IF (e->>'percentage') !~ '^(0|[1-9][0-9]{0,2})([.][0-9]{1,2})?$' OR (e->>'percentage')::numeric>100 THEN RAISE EXCEPTION 'Enter percentages from 0 to 100 with at most two decimal places' USING ERRCODE='22023'; END IF;
       pct=((e->>'percentage')::numeric*100)::integer;total=total+pct;
     ELSE missing=true;
     END IF;
     IF state='not_applicable' AND pct IS NOT NULL THEN RAISE EXCEPTION 'Not applicable allocations cannot contain percentages' USING ERRCODE='22023'; END IF;
     INSERT INTO public.credit_assignments(group_id,contributor_id,display_name,position,percentage_hundredths) VALUES(gid,identity,btrim(e->>'name'),pos,pct);
     pos=pos+1;
   END LOOP;
   IF total>10000 OR (category<>'featured_artist' AND state='complete' AND (total<>10000 OR missing OR pos=0)) THEN RAISE EXCEPTION 'Completed allocations must total exactly 100.00 percent' USING ERRCODE='22023'; END IF;
 END LOOP;
EXCEPTION WHEN invalid_text_representation OR unique_violation THEN RAISE EXCEPTION 'Invalid or duplicate contributor identity' USING ERRCODE='22023';
END; $$;

CREATE OR REPLACE FUNCTION public._merge_credit_projection(p_old jsonb,p_groups jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb=COALESCE(p_old,'{}'::jsonb); category text; g jsonb; names jsonb; key text;
BEGIN
 FOR category,g IN SELECT * FROM jsonb_each(p_groups) LOOP
   key=CASE category WHEN 'songwriter' THEN 'written_by' WHEN 'producer' THEN 'produced_by' WHEN 'featured_artist' THEN 'featured_artists' END;
   IF jsonb_typeof(result)='array' THEN
     SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO result FROM jsonb_array_elements(result) WHERE NOT COALESCE(CASE lower(value->>'role') WHEN 'writer' THEN 'songwriter' WHEN 'written by' THEN 'songwriter' WHEN 'produced by' THEN 'producer' WHEN 'featured' THEN 'featured_artist' WHEN 'featured artist' THEN 'featured_artist' ELSE lower(value->>'role') END=category,false);
     SELECT result||COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name',value->>'name','role',category,'contributor_id',value->>'contributor_id'))),'[]'::jsonb) INTO result FROM jsonb_array_elements(g->'entries');
   ELSE
     result=CASE category WHEN 'songwriter' THEN result-'writtenBy'-'writer'-'songwriter'-'written by' WHEN 'producer' THEN result-'producedBy'-'producer'-'produced by' ELSE result-'featuredArtists'-'featured'-'featured artist'-'featuring' END;
     SELECT COALESCE(jsonb_agg(CASE WHEN value->>'contributor_id' IS NULL THEN to_jsonb(value->>'name') ELSE jsonb_build_object('name',value->>'name','contributor_id',value->>'contributor_id') END),'[]'::jsonb) INTO names FROM jsonb_array_elements(g->'entries');
     result=jsonb_set(result,ARRAY[key],names,true);
   END IF;
 END LOOP;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public._credit_names(p_group jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$ SELECT COALESCE(array_agg(value->>'name'),'{}'::text[]) FROM jsonb_array_elements(p_group->'entries'); $$;

CREATE OR REPLACE FUNCTION public._legacy_credit_groups(p_credits jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb='{}'; category text; keys text[]; payload jsonb; entries jsonb; k text;
BEGIN
 FOREACH category IN ARRAY ARRAY['songwriter','producer','featured_artist'] LOOP
   keys=CASE category WHEN 'songwriter' THEN ARRAY['written_by','writtenBy','songwriter','writer'] WHEN 'producer' THEN ARRAY['produced_by','producedBy','producer'] ELSE ARRAY['featured_artists','featuredArtists','featured','featuring'] END;
   payload='[]';
   IF jsonb_typeof(p_credits)='array' THEN
     SELECT COALESCE(jsonb_agg(value),'[]'::jsonb) INTO payload FROM jsonb_array_elements(p_credits) WHERE CASE lower(value->>'role') WHEN 'writer' THEN 'songwriter' WHEN 'written by' THEN 'songwriter' WHEN 'produced by' THEN 'producer' WHEN 'featured' THEN 'featured_artist' WHEN 'featured artist' THEN 'featured_artist' ELSE lower(value->>'role') END=category;
   ELSE
     FOREACH k IN ARRAY keys LOOP IF p_credits?k THEN payload=p_credits->k;EXIT;END IF; END LOOP;
     IF jsonb_typeof(payload)='string' THEN payload=jsonb_build_array(payload);END IF;
     IF jsonb_typeof(payload) IS DISTINCT FROM 'array' THEN payload='[]';END IF;
   END IF;
   SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name',CASE jsonb_typeof(value) WHEN 'string' THEN value#>>'{}' ELSE value->>'name' END,'contributor_id',CASE WHEN jsonb_typeof(value)='object' THEN value->>'contributor_id' END,'percentage',''))),'[]'::jsonb) INTO entries FROM jsonb_array_elements(payload);
   result=jsonb_set(result,ARRAY[category],jsonb_build_object('state','legacy','entries',entries));
 END LOOP;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public._credit_group_payload(p_kind text,p_id uuid,p_fallback jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public._legacy_credit_groups(p_fallback) || COALESCE(jsonb_object_agg(g.category,jsonb_build_object('state',g.state,'entries',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',a.display_name,'contributor_id',a.contributor_id,'percentage',CASE WHEN a.percentage_hundredths IS NULL THEN '' ELSE to_char(a.percentage_hundredths::numeric/100,'FM990.00') END) ORDER BY a.position),'[]'::jsonb) FROM public.credit_assignments a WHERE a.group_id=g.id))),'{}'::jsonb)
 FROM public.credit_groups g WHERE (p_kind='release' AND release_id=p_id OR p_kind='product' AND product_id=p_id OR p_kind='track' AND track_id=p_id OR p_kind='catalog_track' AND catalog_track_id=p_id);
$$;

CREATE OR REPLACE FUNCTION public._project_recording_credits(p_kind text,p_id uuid,p_patch jsonb,p_release_groups jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tracks; c public.catalog_tracks; old jsonb; groups jsonb; inherited boolean; projection jsonb; identifier text;
BEGIN
 IF p_patch?'credit_groups' THEN PERFORM public._set_credit_groups(p_kind,p_id,p_patch->'credit_groups');END IF;
 IF p_kind='track' THEN
   SELECT * INTO STRICT t FROM public.tracks WHERE id=p_id AND removed_from_release_at IS NULL FOR UPDATE;
   SELECT * INTO c FROM public.catalog_tracks WHERE track_id=p_id AND product_id IN(SELECT id FROM public.products WHERE release_id=t.release_id AND deleted_at IS NULL) LIMIT 1;
   old=COALESCE(t.draft_data->'public_credits',c.credits,(SELECT pr.credits FROM public.products pr JOIN public.releases rr ON rr.id=pr.release_id WHERE rr.id=t.release_id AND rr.release_type IN ('single','feature') AND pr.deleted_at IS NULL LIMIT 1),jsonb_build_object('written_by',t.written_by,'produced_by',t.produced_by,'featured_artists',t.featured_artists));
   inherited=CASE WHEN p_patch?'inherit_credits' THEN (p_patch->>'inherit_credits')::boolean ELSE COALESCE((t.draft_data->>'inherit_credits')::boolean,false) END;
 ELSE
   SELECT * INTO STRICT c FROM public.catalog_tracks WHERE id=p_id AND removed_from_release_at IS NULL FOR UPDATE;
   old=c.credits;inherited=CASE WHEN p_patch?'inherit_credits' THEN (p_patch->>'inherit_credits')::boolean ELSE COALESCE((c.metadata->>'inherit_credits')::boolean,false) END;
 END IF;
 groups=CASE WHEN inherited THEN p_release_groups ELSE COALESCE(p_patch->'credit_groups','{}'::jsonb) END;
 projection=public._merge_credit_projection(old,groups);
 IF p_patch?'isrc' THEN
   IF jsonb_typeof(p_patch->'isrc') NOT IN ('string','null') OR COALESCE(p_patch->>'isrc','') ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'ISRC must be text or empty' USING ERRCODE='22023';END IF;
   identifier=NULLIF(btrim(p_patch->>'isrc'),'');
 ELSE identifier=CASE WHEN p_kind='track' THEN t.isrc ELSE COALESCE(c.metadata->>'isrc',c.credits->>'isrc') END;
 END IF;
 IF jsonb_typeof(projection)='object' THEN projection=jsonb_set(projection,'{isrc}',COALESCE(to_jsonb(identifier),'null'::jsonb));END IF;
 IF p_kind='track' THEN
   UPDATE public.tracks SET
     written_by=CASE WHEN groups?'songwriter' THEN public._credit_names(groups->'songwriter') ELSE written_by END,
     produced_by=CASE WHEN groups?'producer' THEN public._credit_names(groups->'producer') ELSE produced_by END,
     featured_artists=CASE WHEN groups?'featured_artist' THEN public._credit_names(groups->'featured_artist') ELSE featured_artists END,
     isrc=identifier,
     title=CASE WHEN p_patch?'title' THEN p_patch->>'title' ELSE title END,
     lyrics=CASE WHEN p_patch?'lyrics' THEN COALESCE(p_patch->>'lyrics','') ELSE lyrics END,
     draft_data=COALESCE(draft_data,'{}'::jsonb)||jsonb_build_object('inherit_credits',inherited,'public_credits',projection),
     updated_at=clock_timestamp() WHERE id=p_id;
   UPDATE public.catalog_tracks SET credits=public._merge_credit_projection(credits,groups),
     featured_artists=CASE WHEN groups?'featured_artist' THEN public._credit_names(groups->'featured_artist') ELSE featured_artists END,
     title=CASE WHEN p_patch?'title' THEN p_patch->>'title' ELSE title END,
     display_title=CASE WHEN p_patch?'title' THEN p_patch->>'title' ELSE display_title END,
     lyrics=CASE WHEN p_patch?'lyrics' THEN COALESCE(p_patch->>'lyrics','') ELSE lyrics END,
     metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('isrc',identifier,'inherit_credits',inherited)||CASE WHEN p_patch?'lyrics' THEN jsonb_build_object('lyrics',COALESCE(p_patch->>'lyrics','')) ELSE '{}'::jsonb END,
     updated_at=clock_timestamp() WHERE track_id=p_id AND product_id IN(SELECT id FROM public.products WHERE release_id=t.release_id AND deleted_at IS NULL);
   UPDATE public.catalog_tracks SET credits=jsonb_set(credits,'{isrc}',COALESCE(to_jsonb(identifier),'null'::jsonb)) WHERE track_id=p_id AND jsonb_typeof(credits)='object' AND product_id IN(SELECT id FROM public.products WHERE release_id=t.release_id AND deleted_at IS NULL);
 ELSE
   UPDATE public.catalog_tracks SET credits=projection,
     featured_artists=CASE WHEN groups?'featured_artist' THEN public._credit_names(groups->'featured_artist') ELSE featured_artists END,
     title=CASE WHEN p_patch?'title' THEN p_patch->>'title' ELSE title END,
     display_title=CASE WHEN p_patch?'title' THEN p_patch->>'title' ELSE display_title END,
     lyrics=CASE WHEN p_patch?'lyrics' THEN COALESCE(p_patch->>'lyrics','') ELSE lyrics END,
     metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('isrc',identifier,'inherit_credits',inherited)||CASE WHEN p_patch?'lyrics' THEN jsonb_build_object('lyrics',COALESCE(p_patch->>'lyrics','')) ELSE '{}'::jsonb END,
     updated_at=clock_timestamp() WHERE id=p_id;
 END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.commit_release_credit_edit(p_release_ref_id uuid,p_expected_revision jsonb,p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.releases;p public.products;item jsonb;old jsonb;groups jsonb;kind text;target uuid; k text;newtype text;folder text;originalfolder text;ts timestamptz;
BEGIN
 SELECT * INTO r FROM public.releases WHERE id=p_release_ref_id AND deleted_at IS NULL FOR UPDATE;
 IF r.id IS NOT NULL THEN
   SELECT * INTO p FROM public.products WHERE release_id=r.id AND deleted_at IS NULL FOR UPDATE;
   PERFORM id FROM public.tracks WHERE release_id=r.id AND removed_from_release_at IS NULL ORDER BY id FOR UPDATE;
   kind='release';target=r.id;
 ELSE
   SELECT * INTO p FROM public.products WHERE id=p_release_ref_id AND deleted_at IS NULL FOR UPDATE;
   IF p.id IS NULL THEN RAISE EXCEPTION 'Release not found' USING ERRCODE='22023';END IF;
   IF p.release_id IS NOT NULL THEN RAISE EXCEPTION 'Use the canonical release identity' USING ERRCODE='22023';END IF;
   PERFORM id FROM public.catalog_tracks WHERE product_id=p.id AND removed_from_release_at IS NULL ORDER BY id FOR UPDATE;
   kind='product';target=p.id;
 END IF;
 PERFORM public._credit_assert_revision(p_expected_revision,public._credit_revision(p_release_ref_id));
 IF jsonb_typeof(p_patch)<>'object' THEN RAISE EXCEPTION 'Invalid edit payload' USING ERRCODE='22023';END IF;
 IF p_patch?'title' AND (jsonb_typeof(p_patch->'title') IS DISTINCT FROM 'string' OR length(btrim(p_patch->>'title')) NOT BETWEEN 1 AND 500) THEN RAISE EXCEPTION 'Enter a release title' USING ERRCODE='22023';END IF;
 IF p_patch?'upc' AND (jsonb_typeof(p_patch->'upc') NOT IN ('string','null') OR COALESCE(p_patch->>'upc','') ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'UPC/EAN must be text or empty' USING ERRCODE='22023';END IF;
 IF p_patch?'price' AND (p_patch->>'price') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Enter a nonnegative price with at most two decimals' USING ERRCODE='22023';END IF;
 IF p_patch?'artist' AND jsonb_typeof(p_patch->'artist') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Artist must be text' USING ERRCODE='22023';END IF;
 IF p_patch?'release_type' THEN
   newtype=p_patch->>'release_type';folder=CASE newtype WHEN 'single' THEN 'singles' WHEN 'feature' THEN 'features' WHEN 'album' THEN 'albums' WHEN 'ep' THEN 'mixtapes-and-eps' WHEN 'mixtape' THEN 'mixtapes-and-eps' END;
   originalfolder=COALESCE(p.release_type,CASE r.release_type WHEN 'single' THEN 'singles' WHEN 'feature' THEN 'features' WHEN 'album' THEN 'albums' ELSE 'mixtapes-and-eps' END);
   IF folder IS NULL THEN RAISE EXCEPTION 'Invalid release type' USING ERRCODE='22023';END IF;
   IF folder<>originalfolder AND (r.status IS DISTINCT FROM 'draft' OR EXISTS(SELECT 1 FROM public.tracks WHERE release_id=r.id AND removed_from_release_at IS NULL)) THEN RAISE EXCEPTION 'This type change requires moving existing release assets; create a separate release or retain the existing media family' USING ERRCODE='22023';END IF;
 END IF;
 IF p_patch?'credit_groups' THEN PERFORM public._set_credit_groups(kind,target,p_patch->'credit_groups');END IF;
 old=p.credits;groups=public._credit_group_payload(kind,target,old);
 IF p.id IS NOT NULL THEN
   UPDATE public.products SET
     title=CASE WHEN p_patch?'title' THEN btrim(p_patch->>'title') ELSE title END,
     display_title=CASE WHEN p_patch?'title' THEN btrim(p_patch->>'title') ELSE display_title END,
     price_cents=CASE WHEN p_patch?'price' THEN ((p_patch->>'price')::numeric*100)::integer ELSE price_cents END,
     release_date=CASE WHEN p_patch?'release_date' THEN NULLIF(p_patch->>'release_date','')::date ELSE release_date END,
     product_type=CASE WHEN newtype IS NOT NULL THEN CASE WHEN newtype IN ('single','feature') THEN newtype ELSE 'album' END ELSE product_type END,
     release_type=COALESCE(folder,release_type),
     credits=CASE WHEN p_patch?'credit_groups' THEN public._merge_credit_projection(credits,p_patch->'credit_groups') ELSE credits END,
     metadata=COALESCE(metadata,'{}'::jsonb)
       ||CASE WHEN p_patch?'genre' THEN jsonb_build_object('genre',p_patch->'genre') ELSE '{}'::jsonb END
       ||CASE WHEN p_patch?'artist' THEN jsonb_build_object('artist',CASE WHEN jsonb_typeof(metadata->'artist')='object' THEN metadata->'artist'||jsonb_build_object('name',p_patch->'artist') ELSE p_patch->'artist' END) ELSE '{}'::jsonb END
       ||CASE WHEN p_patch?'release_date' THEN jsonb_build_object('release_date',p_patch->'release_date') ELSE '{}'::jsonb END
       ||CASE WHEN p_patch?'upc' THEN jsonb_build_object('upc',NULLIF(btrim(p_patch->>'upc'),'')) ELSE '{}'::jsonb END
       ||CASE WHEN newtype IS NOT NULL THEN jsonb_build_object('release_category',newtype,'release_type',newtype) ELSE '{}'::jsonb END
       ||CASE WHEN p_patch->'credit_groups'?'featured_artist' THEN jsonb_build_object('featured_artists',public._credit_names(p_patch->'credit_groups'->'featured_artist')) ELSE '{}'::jsonb END,
     updated_at=clock_timestamp() WHERE id=p.id;
 END IF;
 IF r.id IS NOT NULL THEN
   UPDATE public.releases SET
     title=CASE WHEN p_patch?'title' THEN btrim(p_patch->>'title') ELSE title END,
     release_date=CASE WHEN p_patch?'release_date' THEN NULLIF(p_patch->>'release_date','')::date ELSE release_date END,
     genre=CASE WHEN p_patch?'genre' THEN p_patch->>'genre' ELSE genre END,
     upc=CASE WHEN p_patch?'upc' THEN NULLIF(btrim(p_patch->>'upc'),'') ELSE upc END,
     release_type=COALESCE(newtype,release_type),
     metadata=COALESCE(metadata,'{}'::jsonb)||CASE WHEN p_patch?'artist' THEN jsonb_build_object('artist',p_patch->'artist') ELSE '{}'::jsonb END,
     updated_at=clock_timestamp() WHERE id=r.id;
   -- Only whitelisted lifecycle fields participate in this edit boundary.
   FOR k IN SELECT key FROM jsonb_each(p_patch) WHERE key IN ('available_at','scheduled_at','release_timezone','upcoming_visible','preview_before_release','preorder_enabled','preorder_starts_at','preorder_price_cents','early_access_enabled','early_access_starts_at','early_access_scope','early_access_audiences','unavailable_at') LOOP
     IF k IN ('available_at','scheduled_at','preorder_starts_at','early_access_starts_at','unavailable_at') THEN
       EXECUTE format('UPDATE public.releases SET %I=$1 WHERE id=$2',k) USING NULLIF(p_patch->>k,'')::timestamptz,r.id;
     ELSIF k IN ('upcoming_visible','preview_before_release','preorder_enabled','early_access_enabled') THEN
       EXECUTE format('UPDATE public.releases SET %I=$1 WHERE id=$2',k) USING (p_patch->>k)::boolean,r.id;
     ELSIF k='release_timezone' THEN
       IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_patch->>k) THEN RAISE EXCEPTION 'Invalid release timezone' USING ERRCODE='22023';END IF;
       UPDATE public.releases SET release_timezone=p_patch->>k WHERE id=r.id;
     ELSIF k='preorder_price_cents' THEN UPDATE public.releases SET preorder_price_cents=(p_patch->>k)::integer WHERE id=r.id;
     ELSIF k='early_access_scope' THEN UPDATE public.releases SET early_access_scope=p_patch->k WHERE id=r.id;
     ELSIF k='early_access_audiences' THEN UPDATE public.releases SET early_access_audiences=ARRAY(SELECT jsonb_array_elements_text(p_patch->k)) WHERE id=r.id;
     END IF;
   END LOOP;
   SELECT * INTO r FROM public.releases WHERE id=r.id;
   IF r.preorder_enabled AND (r.preorder_starts_at IS NULL OR r.preorder_price_cents IS NULL OR r.preorder_price_cents<0) THEN RAISE EXCEPTION 'Preorder requires a start time and a nonnegative price' USING ERRCODE='22023';END IF;
   IF r.early_access_enabled AND (NOT r.preorder_enabled OR r.early_access_starts_at IS NULL) THEN RAISE EXCEPTION 'Early access requires preorder and a start time' USING ERRCODE='22023';END IF;
   IF (p_patch?'available_at' OR p_patch?'scheduled_at') AND r.status IN ('scheduled','published') THEN
     ts=CASE WHEN p_patch?'available_at' THEN r.available_at ELSE r.scheduled_at END;
     IF ts IS NULL THEN RAISE EXCEPTION 'Publication requires a release time' USING ERRCODE='22023';END IF;
     UPDATE public.releases SET available_at=ts,scheduled_at=ts,status=CASE WHEN ts>clock_timestamp() THEN 'scheduled' ELSE 'published' END,storefront_visible=(ts<=clock_timestamp() OR upcoming_visible) WHERE id=r.id;
     UPDATE public.products SET active=(ts<=clock_timestamp() OR r.upcoming_visible) WHERE id=p.id;
   END IF;
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_patch->'recordings','[]'::jsonb)) LOOP
   IF r.id IS NOT NULL THEN
     IF NOT EXISTS(SELECT 1 FROM public.tracks WHERE id=(item->>'id')::uuid AND release_id=r.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Recording does not belong to this release' USING ERRCODE='22023';END IF;
     PERFORM public._project_recording_credits('track',(item->>'id')::uuid,item,groups);
   ELSE
     IF NOT EXISTS(SELECT 1 FROM public.catalog_tracks WHERE id=(item->>'id')::uuid AND product_id=p.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Recording does not belong to this product' USING ERRCODE='22023';END IF;
     PERFORM public._project_recording_credits('catalog_track',(item->>'id')::uuid,item,groups);
   END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_patch->'track_lyrics','[]'::jsonb)) LOOP
   IF r.id IS NOT NULL THEN
     IF NOT EXISTS(SELECT 1 FROM public.tracks WHERE id=(item->>'id')::uuid AND release_id=r.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Lyric recording does not belong to this release' USING ERRCODE='22023';END IF;
     PERFORM public._project_recording_credits('track',(item->>'id')::uuid,item,groups);
   ELSE
     IF NOT EXISTS(SELECT 1 FROM public.catalog_tracks WHERE id=(item->>'id')::uuid AND product_id=p.id AND removed_from_release_at IS NULL) THEN RAISE EXCEPTION 'Lyric recording does not belong to this product' USING ERRCODE='22023';END IF;
     PERFORM public._project_recording_credits('catalog_track',(item->>'id')::uuid,item,groups);
   END IF;
 END LOOP;
 IF p_patch?'credit_groups' THEN
   IF r.id IS NOT NULL THEN
     FOR item IN SELECT jsonb_build_object('id',id) FROM public.tracks WHERE release_id=r.id AND removed_from_release_at IS NULL AND draft_data->>'inherit_credits'='true' LOOP PERFORM public._project_recording_credits('track',(item->>'id')::uuid,'{}',groups);END LOOP;
   ELSE
     FOR item IN SELECT jsonb_build_object('id',id) FROM public.catalog_tracks WHERE product_id=p.id AND removed_from_release_at IS NULL AND metadata->>'inherit_credits'='true' LOOP PERFORM public._project_recording_credits('catalog_track',(item->>'id')::uuid,'{}',groups);END LOOP;
   END IF;
 END IF;
 SELECT * INTO r FROM public.releases WHERE id=r.id;
 RETURN jsonb_build_object('slug',COALESCE(r.slug,p.slug),'status',COALESCE(r.status,CASE WHEN p.active THEN 'published' ELSE 'draft' END),'release_type',COALESCE(r.release_type,p.metadata->>'release_category'),'revision',public._credit_revision(p_release_ref_id));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range OR check_violation THEN RAISE EXCEPTION 'Invalid release metadata or allocation; no changes were saved' USING ERRCODE='22023';
END; $$;

-- Functions are the only mutation interface for the private credit relationships.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('credit_storage_capabilities','get_release_credit_edit_state','_credit_revision','_credit_assert_revision','_set_credit_groups','_merge_credit_projection','_credit_names','_legacy_credit_groups','_credit_group_payload','_project_recording_credits','commit_release_credit_edit') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.identity);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.credit_storage_capabilities(),public.get_release_credit_edit_state(uuid),public.commit_release_credit_edit(uuid,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
