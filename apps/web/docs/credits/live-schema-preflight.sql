-- READ ONLY: run in the Supabase SQL editor or an authenticated SQL session.
-- No schema, application data, grants, or migration history are changed.
BEGIN READ ONLY;
SELECT current_database() AS database_name, current_user AS inspector, version();
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN
  ('releases','products','tracks','catalog_tracks','release_drafts','collaborators','release_collaborators','credit_groups','credit_assignments')
ORDER BY table_name, ordinal_position;
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
       pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN
  ('releases','products','tracks','catalog_tracks','release_drafts','collaborators','release_collaborators','credit_groups','credit_assignments');
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename IN
  ('releases','products','tracks','catalog_tracks','release_drafts','collaborators','release_collaborators','credit_groups','credit_assignments')
ORDER BY tablename, policyname;
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN
  ('releases','products','tracks','catalog_tracks','release_drafts','collaborators','release_collaborators','credit_groups','credit_assignments')
ORDER BY table_name, grantee, privilege_type;
SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
  ('releases','products','tracks','catalog_tracks','release_drafts','collaborators','release_collaborators')
ORDER BY c.relname, con.conname;
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN
  ('releases','products','tracks','catalog_tracks','collaborators','release_collaborators')
ORDER BY tablename, indexname;
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer, p.proacl AS grants, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
  ('commit_current_release_edit','credit_storage_capabilities','get_release_credit_edit_state','commit_release_credit_edit','commit_release_publication');
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 30;
-- JSON shapes only. Use to_jsonb so an absent credits column does not masquerade as a missing table.
SELECT 'products' AS source, jsonb_typeof(to_jsonb(p)->'credits') AS credits_shape, count(*)
FROM public.products p GROUP BY 2
UNION ALL
SELECT 'catalog_tracks', jsonb_typeof(to_jsonb(t)->'credits'), count(*)
FROM public.catalog_tracks t GROUP BY 2;
SELECT count(*) AS contributors FROM public.collaborators;
SELECT count(*) AS allocation_rows, count(*) FILTER (WHERE release_id IS NOT NULL AND product_id IS NOT NULL) AS dual_targets
FROM public.release_collaborators;
SELECT count(*) AS orphan_catalog_track_links FROM public.catalog_tracks c
WHERE to_jsonb(c)->>'track_id' IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM public.tracks t WHERE t.id::text=to_jsonb(c)->>'track_id');
COMMIT;
