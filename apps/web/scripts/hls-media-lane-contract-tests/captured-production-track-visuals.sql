-- Track-visual schema that 20261119150000_hls_media_worker_role.sql builds on,
-- captured read-only from production on 2026-11-19. A test fixture only:
-- never applied anywhere. Load after captured-production-schema.sql. Tables
-- keep the columns and checks these functions touch (track_visuals: only
-- what complete_track_visual_job writes); functions are verbatim.

CREATE TABLE public.track_visuals (
  track_id uuid PRIMARY KEY,
  requested_version_id uuid,
  current_version_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.track_visual_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL REFERENCES public.track_visuals(track_id) ON DELETE CASCADE,
  source_key text NOT NULL UNIQUE,
  source_bytes bigint NOT NULL CHECK ((source_bytes >= 1) AND (source_bytes <= '5000000000'::bigint)),
  source_content_type text NOT NULL CHECK (source_content_type = ANY (ARRAY['video/mp4'::text, 'video/quicktime'::text])),
  status text NOT NULL DEFAULT 'uploading' CHECK (status = ANY (ARRAY['uploading'::text, 'pending'::text, 'processing'::text, 'ready'::text, 'failed'::text])),
  manifest jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.track_visual_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL UNIQUE REFERENCES public.track_visual_versions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'complete'::text, 'failed'::text])),
  lease_token uuid,
  worker_id text,
  heartbeat_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.claim_track_visual_job(p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare j public.track_visual_jobs; v public.track_visual_versions;
begin
 -- An exhausted worker lease must not leave a visual permanently processing.
 with expired as (
   update public.track_visual_jobs set status='failed',error_message='Worker lease expired after three attempts'
   where status='processing' and heartbeat_at<now()-interval '5 minutes' and attempt_count>=3
   returning version_id
 ) update public.track_visual_versions set status='failed',error_message='Worker lease expired after three attempts'
   where id in (select version_id from expired);
 select * into j from public.track_visual_jobs
 where (status='pending' or (status='processing' and heartbeat_at<now()-interval '5 minutes')) and attempt_count<3
 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.track_visual_jobs set status='processing',worker_id=p_worker_id,lease_token=gen_random_uuid(),heartbeat_at=now(),attempt_count=attempt_count+1
 where id=j.id returning * into j;
 update public.track_visual_versions set status='processing' where id=j.version_id returning * into v;
 return to_jsonb(j)||jsonb_build_object('version',to_jsonb(v));
end $function$;

CREATE OR REPLACE FUNCTION public.complete_track_visual_job(p_job_id uuid, p_lease_token uuid, p_manifest jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare j public.track_visual_jobs; v public.track_visual_versions;
begin
 select * into j from public.track_visual_jobs where id=p_job_id and lease_token=p_lease_token and status='processing' for update;
 if not found then return false; end if;
 select * into v from public.track_visual_versions where id=j.version_id for update;
 if p_error is null and (p_manifest is null or (p_manifest->>'assetVersionId') is distinct from v.id::text or coalesce((p_manifest->>'duration')::numeric between 7 and 30,false)=false or jsonb_typeof(p_manifest->'renditions') is distinct from 'array' or coalesce(jsonb_array_length(p_manifest->'renditions'),0)<1) then
   raise exception 'Invalid visual manifest';
 end if;
 update public.track_visual_jobs set status=case when p_error is null then 'complete' else 'failed' end,error_message=p_error where id=j.id;
 update public.track_visual_versions set status=case when p_error is null then 'ready' else 'failed' end,manifest=p_manifest,error_message=p_error where id=v.id;
 if p_error is null then
   update public.track_visuals set current_version_id=v.id,updated_at=now() where track_id=v.track_id and requested_version_id=v.id;
 end if;
 return true;
end $function$;
