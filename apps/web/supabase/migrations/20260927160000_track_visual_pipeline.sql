-- Independent silent-visual ownership and queue. No audio or Audio Visualz jobs.
begin;
create table public.track_visuals (
 track_id uuid primary key references public.tracks(id) on delete cascade,
 current_version_id uuid, requested_version_id uuid,
 updated_at timestamptz not null default now()
);
create table public.track_visual_versions (
 id uuid primary key default gen_random_uuid(), track_id uuid not null references public.track_visuals(track_id) on delete cascade,
 source_key text not null unique, source_bytes bigint not null check(source_bytes between 1 and 5000000000),
 source_content_type text not null check(source_content_type in ('video/mp4','video/quicktime')),
 status text not null default 'uploading' check(status in ('uploading','pending','processing','ready','failed')),
 manifest jsonb, error_message text, created_at timestamptz not null default now()
);
alter table public.track_visuals add foreign key(current_version_id) references public.track_visual_versions(id),
 add foreign key(requested_version_id) references public.track_visual_versions(id);
create table public.track_visual_jobs (
 id uuid primary key default gen_random_uuid(), version_id uuid not null unique references public.track_visual_versions(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','processing','complete','failed')),
 lease_token uuid, worker_id text, heartbeat_at timestamptz, attempt_count integer not null default 0,
 error_message text, created_at timestamptz not null default now()
);
create index track_visual_jobs_poll on public.track_visual_jobs(status,created_at);
create index track_visual_versions_track on public.track_visual_versions(track_id,created_at desc);
alter table public.track_visuals enable row level security;
alter table public.track_visual_versions enable row level security;
alter table public.track_visual_jobs enable row level security;
revoke all on public.track_visuals,public.track_visual_versions,public.track_visual_jobs from anon,authenticated;
grant all on public.track_visuals,public.track_visual_versions,public.track_visual_jobs to service_role;

create function public.claim_track_visual_job(p_worker_id text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;

create function public.complete_track_visual_job(p_job_id uuid,p_lease_token uuid,p_manifest jsonb default null,p_error text default null) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
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
end $$;
revoke all on function public.claim_track_visual_job(text),public.complete_track_visual_job(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.claim_track_visual_job(text),public.complete_track_visual_job(uuid,uuid,jsonb,text) to service_role;
-- Serialize upload intent and removal at the track owner. A delayed completion
-- cannot resurrect an older upload or enqueue after removal.
create function public.prepare_track_visual(p_track_id uuid,p_version_id uuid,p_source_key text,p_source_bytes bigint,p_source_content_type text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.track_visuals(track_id) values(p_track_id) on conflict do nothing;
 perform 1 from public.track_visuals where track_id=p_track_id for update;
 insert into public.track_visual_versions(id,track_id,source_key,source_bytes,source_content_type)
 values(p_version_id,p_track_id,p_source_key,p_source_bytes,p_source_content_type);
 update public.track_visuals set requested_version_id=p_version_id,updated_at=now() where track_id=p_track_id;
end $$;
create function public.queue_track_visual(p_track_id uuid,p_version_id uuid) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner public.track_visuals;
begin
 select * into owner from public.track_visuals where track_id=p_track_id for update;
 if not found or owner.requested_version_id is distinct from p_version_id then return false; end if;
 update public.track_visual_versions set status='pending' where id=p_version_id and track_id=p_track_id and status='uploading';
 insert into public.track_visual_jobs(version_id) values(p_version_id) on conflict(version_id) do nothing;
 return true;
end $$;
revoke all on function public.prepare_track_visual(uuid,uuid,text,bigint,text),public.queue_track_visual(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_track_visual(uuid,uuid,text,bigint,text),public.queue_track_visual(uuid,uuid) to service_role;
commit;
