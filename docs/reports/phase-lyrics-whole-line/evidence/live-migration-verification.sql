BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='20s';
DO $probe$
DECLARE actor uuid; owner_release uuid; recording uuid; baseline text; saved jsonb; loaded jsonb;
BEGIN
 SELECT id INTO actor FROM auth.users ORDER BY id LIMIT 1;
 SELECT t.release_id,t.id,coalesce(t.lyrics,'') INTO owner_release,recording,baseline FROM public.tracks t JOIN public.releases r ON r.id=t.release_id WHERE r.deleted_at IS NULL AND t.removed_from_release_at IS NULL ORDER BY t.id LIMIT 1;
 IF actor IS NULL OR recording IS NULL THEN RAISE EXCEPTION 'No safe rollback probe target is available';END IF;
 IF EXISTS(SELECT 1 FROM public.recording_lyric_drafts WHERE author_id=actor AND release_ref_id=owner_release AND recording_id=recording) THEN RAISE EXCEPTION 'Probe target has a real working draft; refusing to alter it';END IF;
 saved=public.save_recording_lyric_draft(actor,owner_release,recording,NULL,baseline,'Unfinished deployment probe. Rolled back.');
 loaded=public.get_recording_lyric_draft(actor,owner_release,recording);
 IF loaded#>>'{draft,lyrics}' IS DISTINCT FROM 'Unfinished deployment probe. Rolled back.' OR loaded->>'revision' IS DISTINCT FROM saved->>'revision' THEN RAISE EXCEPTION 'Draft roundtrip failed';END IF;
 IF (SELECT coalesce(lyrics,'') FROM public.tracks WHERE id=recording) IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Public lyrics unexpectedly changed';END IF;
 IF public.get_recording_lyric_draft('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',owner_release,recording)->'draft' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Actor isolation failed';END IF;
 BEGIN
  PERFORM public.save_recording_lyric_draft(actor,owner_release,recording,NULL,baseline,'Stale write');
  RAISE EXCEPTION 'Stale draft write unexpectedly succeeded';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN
  PERFORM public.save_recording_lyric_draft(actor,owner_release,recording,(saved->>'revision')::uuid,baseline||' changed baseline','Wrong baseline');
  RAISE EXCEPTION 'Changed-baseline write unexpectedly succeeded';
 EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN
  PERFORM public.get_recording_lyric_draft(actor,owner_release,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  RAISE EXCEPTION 'Foreign recording unexpectedly accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END $probe$;
DO $denied$ BEGIN
 BEGIN
  SET LOCAL ROLE anon;
  PERFORM public.get_recording_lyric_draft('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
  RAISE EXCEPTION 'Anon RPC unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM public.save_recording_lyric_draft('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',NULL,'','Forbidden');
  RAISE EXCEPTION 'Authenticated RPC unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $denied$;
SELECT jsonb_build_object('roundtrip',true,'public_lyrics_unchanged',true,'actor_isolation',true,'stale_revision_rejected',true,'changed_baseline_rejected',true,'foreign_recording_rejected',true,'actual_anon_rpc_denied',true,'actual_authenticated_rpc_denied',true,'probe_will_rollback',true) AS probe;
ROLLBACK;
SELECT jsonb_build_object('draft_rows_after_rollback',(select count(*) from public.recording_lyric_drafts),'counts',jsonb_build_object('releases',(select count(*) from public.releases),'products',(select count(*) from public.products),'tracks',(select count(*) from public.tracks),'catalog_tracks',(select count(*) from public.catalog_tracks)),'migration_history',(select jsonb_agg(jsonb_build_object('version',version,'name',name)) from supabase_migrations.schema_migrations where version='20261024010000'),'rls_enabled',(select relrowsecurity from pg_class where oid='public.recording_lyric_drafts'::regclass),'anon_select',has_table_privilege('anon','public.recording_lyric_drafts','SELECT'),'authenticated_select',has_table_privilege('authenticated','public.recording_lyric_drafts','SELECT'),'service_execute',has_function_privilege('service_role','public.save_recording_lyric_draft(uuid,uuid,uuid,uuid,text,text)','EXECUTE')) AS readback;
