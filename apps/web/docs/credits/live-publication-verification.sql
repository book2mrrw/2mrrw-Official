BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL ROLE service_role;
DO $$ DECLARE r public.releases;p public.products;rev jsonb;result jsonb;payload jsonb;caught boolean=false;BEGIN
 SELECT rr.* INTO STRICT r FROM releases rr JOIN products pp ON pp.release_id=rr.id AND pp.deleted_at IS NULL WHERE rr.deleted_at IS NULL AND rr.status='published' AND EXISTS(SELECT 1 FROM tracks WHERE release_id=rr.id AND upload_status='ready' AND audio_r2_key IS NOT NULL AND removed_from_release_at IS NULL) LIMIT 1;
 SELECT * INTO STRICT p FROM products WHERE release_id=r.id AND deleted_at IS NULL;
 rev=public.get_release_publication_revision(r.id);
 payload=jsonb_build_object('product',to_jsonb(p),'release',to_jsonb(r),'catalog_tracks','[]'::jsonb,'recordings',(SELECT jsonb_agg(jsonb_build_object('id',id)) FROM tracks WHERE release_id=r.id AND upload_status='ready' AND audio_r2_key IS NOT NULL AND removed_from_release_at IS NULL));
 result=public.commit_release_publication(r.id,rev,payload);
 IF result->'revision' IS DISTINCT FROM public.get_release_publication_revision(r.id) THEN RAISE EXCEPTION 'Publication revision is stale';END IF;
 rev=public.get_release_publication_revision(r.id);
 BEGIN
  PERFORM public.commit_release_publication(r.id,rev,jsonb_set(payload,'{release,status}','"draft"'::jsonb));
 EXCEPTION WHEN invalid_parameter_value THEN caught=true;END;
 IF NOT caught OR rev IS DISTINCT FROM public.get_release_publication_revision(r.id) THEN RAISE EXCEPTION 'Failed publication did not roll back';END IF;
END;$$;
RESET ROLE;
ROLLBACK;
SELECT jsonb_build_object('publication_rpc_live_trigger_test','passed and rolled back','releases',(SELECT count(*) FROM releases),'products',(SELECT count(*) FROM products),'credit_groups',(SELECT count(*) FROM credit_groups)) AS verification;
