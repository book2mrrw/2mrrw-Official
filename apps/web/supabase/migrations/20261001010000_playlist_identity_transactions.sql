begin;
set local lock_timeout='2s';
alter table public.user_playlists add column revision bigint not null default 0;
update public.playlist_tracks set album_slug=null where album_slug='';
-- NULLS NOT DISTINCT ensures single-track releases are also unique.
alter table public.playlist_tracks drop constraint playlist_tracks_playlist_id_track_slug_key;
-- Repair the verified historical projection error without guessing from titles.
-- Conflicting metadata or targets missing from the catalog stop the transaction.
do $$
begin
 if exists(select 1 from public.playlist_tracks t where
  (nullif(t.track_data->>'trackSlug','') is not null and nullif(t.track_data->'metadata'->>'trackSlug','') is not null
   and t.track_data->>'trackSlug'<>t.track_data->'metadata'->>'trackSlug')
  or (nullif(coalesce(nullif(t.track_data->>'trackSlug',''),nullif(t.track_data->'metadata'->>'trackSlug','')),'') is not null
   and t.track_slug<>coalesce(nullif(t.track_data->>'trackSlug',''),nullif(t.track_data->'metadata'->>'trackSlug',''))
   and not (t.album_slug is not null and t.track_slug=t.album_slug and exists(
    select 1 from public.catalog_tracks c where c.album_slug=t.album_slug
     and c.slug=coalesce(nullif(t.track_data->>'trackSlug',''),nullif(t.track_data->'metadata'->>'trackSlug','')))))) then
  raise exception 'Playlist identity mismatch requires catalog verification';
 end if;
end $$;
update public.playlist_tracks t set track_slug=coalesce(nullif(t.track_data->>'trackSlug',''),nullif(t.track_data->'metadata'->>'trackSlug',''))
where t.album_slug is not null and t.track_slug=t.album_slug
 and nullif(coalesce(nullif(t.track_data->>'trackSlug',''),nullif(t.track_data->'metadata'->>'trackSlug','')),'') is not null
 and exists(select 1 from public.catalog_tracks c where c.album_slug=t.album_slug
  and c.slug=coalesce(nullif(t.track_data->>'trackSlug',''),nullif(t.track_data->'metadata'->>'trackSlug','')));
alter table public.playlist_tracks add constraint playlist_tracks_release_identity_key
 unique nulls not distinct (playlist_id,album_slug,track_slug);

create function public.mutate_playlist_tracks(p_playlist_id uuid,p_user_id uuid,p_revision bigint,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare pl public.user_playlists; wanted uuid[]:=array[]::uuid[];
 token text; matches uuid[]; identity jsonb; release_slug text; song_slug text; changed boolean:=false;
begin
 select * into pl from public.user_playlists where id=p_playlist_id and user_id=p_user_id for update;
 if not found then raise exception 'Playlist not found' using errcode='42501'; end if;
 if p_revision is null or p_revision<>pl.revision then raise exception 'Playlist changed; reload before editing' using errcode='40001'; end if;
 if p_action='add' then
  release_slug:=nullif(p_payload->>'albumSlug',''); song_slug:=p_payload->>'trackSlug';
  if nullif(song_slug,'') is null or length(song_slug)>512 or length(release_slug)>512 then raise exception 'Invalid track identity' using errcode='22023'; end if;
  insert into public.playlist_tracks(playlist_id,album_slug,track_slug,track_data,sort_order)
  values(pl.id,release_slug,song_slug,coalesce(p_payload->'trackData','{}'::jsonb),
   coalesce((select max(sort_order)+1 from public.playlist_tracks where playlist_id=pl.id),0))
  on conflict on constraint playlist_tracks_release_identity_key do nothing;
  changed:=found;
 elsif p_action in ('reorder','remove') then
  if jsonb_typeof(p_payload->'keys') is distinct from 'array' then raise exception 'Track keys required' using errcode='22023'; end if;
  for token in select jsonb_array_elements_text(p_payload->'keys') loop
   begin identity:=token::jsonb; exception when invalid_text_representation then identity:=null; end;
   -- Canonical JSON identity, UUID row identity, or unambiguous old client slug/ID.
   select array_agg(id) into matches from public.playlist_tracks t where t.playlist_id=pl.id and (
    token=t.id::text or token=t.track_slug or token=t.track_data->>'id'
    or identity=jsonb_build_array(t.album_slug,t.track_slug));
   if coalesce(cardinality(matches),0)<>1 then raise exception 'Missing or ambiguous playlist entry' using errcode='22023'; end if;
   if matches[1]=any(wanted) then raise exception 'Duplicate playlist entry' using errcode='22023'; end if;
   wanted:=array_append(wanted,matches[1]);
  end loop;
  if p_action='reorder' then
   if cardinality(wanted)<>(select count(*) from public.playlist_tracks where playlist_id=pl.id) then raise exception 'Reorder must include every entry exactly once' using errcode='40001'; end if;
   update public.playlist_tracks t set sort_order=s.ordinality-1 from unnest(wanted) with ordinality s(id,ordinality) where t.id=s.id and t.playlist_id=pl.id;
  else
   if cardinality(wanted)<>1 then raise exception 'One removal identity required' using errcode='22023'; end if;
   delete from public.playlist_tracks where playlist_id=pl.id and id=wanted[1];
  end if;
  changed:=true;
 else raise exception 'Invalid playlist action' using errcode='22023';
 end if;
 if changed then update public.user_playlists set revision=revision+1,updated_at=now() where id=pl.id returning * into pl; end if;
 return jsonb_build_object('revision',pl.revision);
end $$;
revoke all on function public.mutate_playlist_tracks(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.mutate_playlist_tracks(uuid,uuid,bigint,text,jsonb) to service_role;
-- All track writes must share the parent lock and revision contract.
revoke insert,update,delete on public.playlist_tracks from public,anon,authenticated,service_role;
commit;
