-- Read-only readiness evidence. This does not apply or authorize a migration.
begin read only;
set local statement_timeout = '15s';
select jsonb_build_object(
 'database_version', current_setting('server_version'),
 'revision_column', exists(select 1 from information_schema.columns
   where table_schema='public' and table_name='user_playlists' and column_name='revision'),
 'mutation_function', to_regprocedure('public.mutate_playlist_tracks(uuid,uuid,bigint,text,jsonb)') is not null,
 'constraints', (select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)))
   from pg_constraint where conrelid='public.playlist_tracks'::regclass and contype='u'),
 'entry_count', (select count(*) from public.playlist_tracks),
 'empty_release_count', (select count(*) from public.playlist_tracks where album_slug=''),
 'verified_repair_candidates', (select count(*) from public.playlist_tracks t
   where t.album_slug is not null and t.track_slug=t.album_slug
   and exists(select 1 from public.catalog_tracks c where c.album_slug=t.album_slug
     and c.slug=coalesce(nullif(t.track_data->>'trackSlug',''),nullif(t.track_data->'metadata'->>'trackSlug','')))),
 'conflicting_metadata_count', (select count(*) from public.playlist_tracks
   where nullif(track_data->>'trackSlug','') is not null
   and nullif(track_data->'metadata'->>'trackSlug','') is not null
   and track_data->>'trackSlug'<>track_data->'metadata'->>'trackSlug'),
 'service_role_direct_writes', jsonb_build_object(
   'insert',has_table_privilege('service_role','public.playlist_tracks','INSERT'),
   'update',has_table_privilege('service_role','public.playlist_tracks','UPDATE'),
   'delete',has_table_privilege('service_role','public.playlist_tracks','DELETE'))
) as playlist_rollout_evidence;
commit;
