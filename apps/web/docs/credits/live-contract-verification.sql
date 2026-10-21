BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
SET LOCAL ROLE service_role;
DO $$
DECLARE ref uuid; rev jsonb; saved jsonb; actual jsonb; caught boolean=false;
BEGIN
 SELECT id INTO STRICT ref FROM releases WHERE deleted_at IS NULL AND status='published' AND EXISTS(SELECT 1 FROM tracks WHERE release_id=releases.id AND removed_from_release_at IS NULL) LIMIT 1;
 rev=public.get_release_publication_revision(ref);
 saved=public.commit_release_credit_edit(ref,rev,'{"credit_groups":{"songwriter":{"state":"complete","entries":[{"name":"ROLLBACK ONLY verification","percentage":"100.00"}]}}}'::jsonb);
 actual=public.get_release_publication_revision(ref);
 IF saved->'revision' IS DISTINCT FROM actual THEN RAISE EXCEPTION 'Returned revision differs from live read'; END IF;
 PERFORM public.commit_release_credit_edit(ref,saved->'revision','{}'::jsonb);
 BEGIN
   PERFORM public.commit_release_credit_edit(ref,rev,'{}'::jsonb);
 EXCEPTION WHEN serialization_failure THEN caught=true;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'Stale revision was not rejected';END IF;
 actual=public.get_release_publication_revision(ref); caught=false;
 BEGIN
   PERFORM public.commit_release_credit_edit(ref,actual,'{"title":"MUST ROLL BACK","credit_groups":{"songwriter":{"state":"complete","entries":[{"name":"Invalid","percentage":"99.99"}]}}}'::jsonb);
 EXCEPTION WHEN invalid_parameter_value THEN caught=true;
 END;
 IF NOT caught OR actual IS DISTINCT FROM public.get_release_publication_revision(ref) THEN RAISE EXCEPTION 'Invalid allocation changed live state';END IF;
 RAISE NOTICE 'PASS live service-role edit, consecutive returned revision, stale conflict, invalid allocation rollback';
END; $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ DECLARE caught boolean=false;BEGIN
 BEGIN PERFORM public.credit_storage_capabilities();EXCEPTION WHEN insufficient_privilege THEN caught=true;END;
 IF NOT caught THEN RAISE EXCEPTION 'Anonymous RPC access was allowed';END IF;
 caught=false;
 BEGIN PERFORM * FROM public.credit_assignments LIMIT 1;EXCEPTION WHEN insufficient_privilege THEN caught=true;END;
 IF NOT caught THEN RAISE EXCEPTION 'Anonymous allocation access was allowed';END IF;
 RAISE NOTICE 'PASS actual anonymous role denied RPC and private allocation access';
END;$$;
RESET ROLE;
ROLLBACK;
SELECT jsonb_build_object('releases',(SELECT count(*) FROM releases),'products',(SELECT count(*) FROM products),'tracks',(SELECT count(*) FROM tracks),'catalog_tracks',(SELECT count(*) FROM catalog_tracks),'collaborators',(SELECT count(*) FROM collaborators),'financial_rows',(SELECT count(*) FROM release_collaborators),'credit_groups',(SELECT count(*) FROM credit_groups),'credit_assignments',(SELECT count(*) FROM credit_assignments),'versions',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations WHERE version IN ('20261021010000','20261021020000')),'authenticated_can_read_allocations',has_table_privilege('authenticated','public.credit_assignments','SELECT'),'authenticated_can_execute_edit',has_function_privilege('authenticated','public.commit_release_credit_edit(uuid,jsonb,jsonb)','EXECUTE'),'anon_can_read_directory',has_table_privilege('anon','public.collaborators','SELECT')) AS verification;
