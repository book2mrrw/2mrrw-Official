-- Private authoring state for existing canonical and legacy recordings.
-- Separate from listener lyrics and from release_drafts (draft releases only).
BEGIN;
CREATE TABLE public.recording_lyric_drafts (
 author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 release_ref_id uuid NOT NULL,
 recording_id uuid NOT NULL,
 lyrics text NOT NULL CHECK(length(lyrics)<=250000),
 base_lyrics text NOT NULL CHECK(length(base_lyrics)<=250000),
 revision uuid NOT NULL DEFAULT gen_random_uuid(),
 saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(author_id,release_ref_id,recording_id)
);
ALTER TABLE public.recording_lyric_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recording_lyric_drafts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.recording_lyric_drafts TO service_role;

CREATE FUNCTION public._lyric_draft_current_lyrics(p_release_ref_id uuid,p_recording_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.releases;p public.products;value text;
BEGIN
 SELECT * INTO r FROM public.releases WHERE id=p_release_ref_id AND deleted_at IS NULL FOR SHARE;
 IF r.id IS NOT NULL THEN
  SELECT COALESCE(lyrics,'') INTO value FROM public.tracks WHERE id=p_recording_id AND release_id=r.id AND removed_from_release_at IS NULL FOR SHARE;
 ELSE
  SELECT * INTO p FROM public.products WHERE id=p_release_ref_id AND deleted_at IS NULL FOR SHARE;
  IF p.id IS NULL OR p.release_id IS NOT NULL THEN RAISE EXCEPTION 'Use a current canonical release identity' USING ERRCODE='22023';END IF;
  IF p_recording_id=p.id AND p.product_type IN ('single','feature') AND NOT EXISTS(SELECT 1 FROM public.catalog_tracks WHERE product_id=p.id AND removed_from_release_at IS NULL) THEN
   value=COALESCE(p.metadata->>'lyrics','');
  ELSE
   SELECT COALESCE(lyrics,metadata->>'lyrics','') INTO value FROM public.catalog_tracks WHERE id=p_recording_id AND product_id=p.id AND removed_from_release_at IS NULL FOR SHARE;
  END IF;
 END IF;
 IF value IS NULL THEN RAISE EXCEPTION 'Recording does not belong to this release' USING ERRCODE='22023';END IF;
 RETURN value;
END;$$;

CREATE FUNCTION public.get_recording_lyric_draft(p_actor_id uuid,p_release_ref_id uuid,p_recording_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.recording_lyric_drafts;baseline text;
BEGIN
 baseline=public._lyric_draft_current_lyrics(p_release_ref_id,p_recording_id);
 SELECT * INTO d FROM public.recording_lyric_drafts WHERE author_id=p_actor_id AND release_ref_id=p_release_ref_id AND recording_id=p_recording_id;
 RETURN jsonb_build_object('base_lyrics',baseline,'revision',d.revision,'draft',CASE WHEN d.revision IS NULL OR d.lyrics=baseline THEN NULL ELSE jsonb_build_object('lyrics',d.lyrics,'base_lyrics',d.base_lyrics,'revision',d.revision,'saved_at',d.saved_at) END);
END;$$;

CREATE FUNCTION public.save_recording_lyric_draft(p_actor_id uuid,p_release_ref_id uuid,p_recording_id uuid,p_expected_draft_revision uuid,p_base_lyrics text,p_lyrics text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE d public.recording_lyric_drafts;baseline text;next_revision uuid=gen_random_uuid();saved timestamptz=clock_timestamp();
BEGIN
 IF p_actor_id IS NULL OR p_lyrics IS NULL OR p_base_lyrics IS NULL OR length(p_lyrics)>250000 OR length(p_base_lyrics)>250000 THEN RAISE EXCEPTION 'Invalid lyric draft' USING ERRCODE='22023';END IF;
 -- Serialize first inserts as well as later CAS writes. Publishers use the
 -- same parent/recording rows, so baseline comparison remains transactional.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_release_ref_id::text||p_recording_id::text,0));
 baseline=public._lyric_draft_current_lyrics(p_release_ref_id,p_recording_id);
 IF p_base_lyrics IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Published lyrics changed; reopen before saving this draft' USING ERRCODE='40001';END IF;
 SELECT * INTO d FROM public.recording_lyric_drafts WHERE author_id=p_actor_id AND release_ref_id=p_release_ref_id AND recording_id=p_recording_id FOR UPDATE;
 IF p_expected_draft_revision IS DISTINCT FROM d.revision THEN RAISE EXCEPTION 'A newer draft was saved in another editor' USING ERRCODE='40001';END IF;
 INSERT INTO public.recording_lyric_drafts(author_id,release_ref_id,recording_id,lyrics,base_lyrics,revision,saved_at)
 VALUES(p_actor_id,p_release_ref_id,p_recording_id,p_lyrics,p_base_lyrics,next_revision,saved)
 ON CONFLICT(author_id,release_ref_id,recording_id) DO UPDATE SET lyrics=EXCLUDED.lyrics,base_lyrics=EXCLUDED.base_lyrics,revision=EXCLUDED.revision,saved_at=EXCLUDED.saved_at;
 RETURN jsonb_build_object('revision',next_revision,'saved_at',saved);
END;$$;
REVOKE ALL ON FUNCTION public._lyric_draft_current_lyrics(uuid,uuid),public.get_recording_lyric_draft(uuid,uuid,uuid),public.save_recording_lyric_draft(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_recording_lyric_draft(uuid,uuid,uuid),public.save_recording_lyric_draft(uuid,uuid,uuid,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
