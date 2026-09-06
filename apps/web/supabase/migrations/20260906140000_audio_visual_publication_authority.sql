-- Atomically promotes a validated audio_visual_asset_versions row to be
-- its parent audio_visuals row's current_version_id. This is the ONLY
-- path by which current_version_id may change — it re-verifies the
-- target version's status itself (never trusts the caller alone), so a
-- version that hasn't passed every encoding-pipeline stage can never be
-- promoted, even by a buggy or malicious caller.
--
-- publication_state only ever moves from 'draft'/'processing' to 'ready'
-- here — an already-'published' row stays 'published' (this is what lets
-- "replace the master" swap current_version_id without ever un-publishing
-- a live video), and 'failed'/'unpublished' are left alone too, since
-- promotion is not a business-visibility decision, just "this row now has
-- a playable version." A separate, explicit admin action moves 'ready' to
-- 'published'.
create or replace function promote_audio_visual_version(
  p_audio_visual_id uuid,
  p_asset_version_id uuid
) returns void
language plpgsql
as $$
declare
  v_status text;
  v_owner_id uuid;
begin
  select status, audio_visual_id into v_status, v_owner_id
  from audio_visual_asset_versions
  where id = p_asset_version_id
  for update;

  if v_owner_id is null then
    raise exception 'promote_audio_visual_version: asset version % does not exist', p_asset_version_id;
  end if;

  if v_owner_id != p_audio_visual_id then
    raise exception 'promote_audio_visual_version: asset version % does not belong to audio_visual %', p_asset_version_id, p_audio_visual_id;
  end if;

  if v_status != 'ready' then
    raise exception 'promote_audio_visual_version: asset version % has status % — only a version with status ''ready'' may be promoted', p_asset_version_id, v_status;
  end if;

  update audio_visual_asset_versions
  set promoted_at = now()
  where id = p_asset_version_id;

  update audio_visuals
  set current_version_id = p_asset_version_id,
      publication_state = case when publication_state in ('draft', 'processing') then 'ready' else publication_state end,
      updated_at = now()
  where id = p_audio_visual_id;
end;
$$;
