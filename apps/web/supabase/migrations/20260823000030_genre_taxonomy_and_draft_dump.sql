-- Canonical genre taxonomy, audited legacy backfill, durable draft snapshots, reversible draft dumping.
alter table public.releases add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.genre_taxonomy (
  id uuid primary key default gen_random_uuid(), parent_id uuid references public.genre_taxonomy(id) on delete restrict,
  name text not null, slug text not null unique, description text, sort_order integer not null default 0,
  active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique nulls not distinct(parent_id,name)
);
create index if not exists genre_taxonomy_parent_order_idx on public.genre_taxonomy(parent_id,sort_order,name);

create table if not exists public.release_genre_classifications (
  release_id uuid not null references public.releases(id) on delete cascade,
  taxonomy_id uuid not null references public.genre_taxonomy(id) on delete restrict,
  role text not null check(role in ('primary','subgenre','secondary')), sort_order integer not null default 0,
  created_at timestamptz not null default now(), primary key(release_id,taxonomy_id)
);
create unique index if not exists release_genre_one_primary_idx on public.release_genre_classifications(release_id) where role='primary';

create table if not exists public.genre_legacy_map (
  normalized_value text primary key, primary_slug text not null, subgenre_slug text
);
create table if not exists public.genre_migration_audit (
  product_id uuid primary key references public.products(id) on delete cascade,
  release_id uuid references public.releases(id) on delete cascade, title text, raw_genre text, normalized_genre text,
  mapped_primary_slug text, mapped_subgenre_slug text,
  audit_status text not null check(audit_status in ('blank','mapped','unmapped','legacy_without_release')),
  audited_at timestamptz not null default now()
);

create table if not exists public.draft_deletion_jobs (
  id uuid primary key default gen_random_uuid(), release_id uuid not null unique references public.releases(id) on delete cascade,
  prior_status text not null, asset_keys jsonb not null default '[]'::jsonb,
  requested_by uuid references auth.users(id) on delete set null, requested_at timestamptz not null default now(),
  delete_after timestamptz not null, finalized_at timestamptz
);
create index if not exists draft_deletion_jobs_due_idx on public.draft_deletion_jobs(delete_after) where finalized_at is null;

with ranked as (
  select ctid,row_number() over(partition by release_id order by saved_at desc,id desc) as row_rank from public.release_drafts
)
delete from public.release_drafts d using ranked r where d.ctid=r.ctid and r.row_rank>1;
create unique index if not exists release_drafts_one_per_release_idx on public.release_drafts(release_id);
alter table public.release_drafts add column if not exists updated_at timestamptz not null default now();

alter table public.genre_taxonomy enable row level security;
alter table public.release_genre_classifications enable row level security;
alter table public.genre_legacy_map enable row level security;
alter table public.genre_migration_audit enable row level security;
alter table public.draft_deletion_jobs enable row level security;
drop policy if exists "genre_taxonomy_public_read" on public.genre_taxonomy;
create policy "genre_taxonomy_public_read" on public.genre_taxonomy for select using(active=true);
drop policy if exists "release_genres_public_read" on public.release_genre_classifications;
create policy "release_genres_public_read" on public.release_genre_classifications for select using(true);
revoke all on public.genre_legacy_map,public.genre_migration_audit,public.draft_deletion_jobs from anon,authenticated;

insert into public.genre_taxonomy(name,slug,sort_order,active) values
('R&B','r-and-b',10,true),('Hip-Hop / Rap','hip-hop-rap',20,true),('Pop','pop',30,true),('Soul','soul',40,true),
('Reggaeton','reggaeton',50,true),('Latin Pop','latin-pop',60,true),('Latin R&B','latin-r-and-b',70,true),
('Afrobeats','afrobeats',80,true),('Amapiano','amapiano',90,true),('Island Vibes','island-vibes',100,true)
on conflict(slug) do update set name=excluded.name,parent_id=null,sort_order=excluded.sort_order,active=true;

with seed(parent_slug,name,slug,sort_order) as (values
('r-and-b','Alternative R&B','alternative-r-and-b',10),('r-and-b','Pop R&B','pop-r-and-b',20),('r-and-b','Contemporary R&B','contemporary-r-and-b',30),
('hip-hop-rap','Trap','trap',10),('hip-hop-rap','Melodic Rap','melodic-rap',20),('hip-hop-rap','Rap','rap',30),
('pop','Pop R&B','pop-r-and-b-pop',10),('pop','Alternative Pop','alternative-pop',20),
('soul','Neo-Soul','neo-soul',10),('soul','Contemporary Soul','contemporary-soul',20),
('reggaeton','Latin Trap','latin-trap',10),('reggaeton','Perreo','perreo',20),('reggaeton','Romantic Reggaeton','romantic-reggaeton',30),
('latin-pop','Pop Urbano','pop-urbano',10),('latin-pop','Latin Dance Pop','latin-dance-pop',20),('latin-pop','Tropical Pop','tropical-pop',30),
('latin-r-and-b','Latin Soul','latin-soul',10),('latin-r-and-b','R&B Urbano','r-and-b-urbano',20),('latin-r-and-b','Alternative Latin R&B','alternative-latin-r-and-b',30),
('afrobeats','Afro-Pop','afro-pop',10),('afrobeats','Afro-Fusion','afro-fusion',20),('afrobeats','Afro-R&B','afro-r-and-b',30),
('amapiano','Soulful Amapiano','soulful-amapiano',10),('amapiano','Private School Amapiano','private-school-amapiano',20),('amapiano','Bacardi','bacardi',30),
('island-vibes','Dancehall','dancehall',10),('island-vibes','Reggae','reggae',20),('island-vibes','Soca','soca',30),('island-vibes','Lovers Rock','lovers-rock',40),('island-vibes','Caribbean R&B','caribbean-r-and-b',50)
)
insert into public.genre_taxonomy(parent_id,name,slug,sort_order,active)
select p.id,s.name,s.slug,s.sort_order,true from seed s join public.genre_taxonomy p on p.slug=s.parent_slug
on conflict(slug) do update set parent_id=excluded.parent_id,name=excluded.name,sort_order=excluded.sort_order,active=true;

insert into public.genre_legacy_map(normalized_value,primary_slug,subgenre_slug) values
('r&b','r-and-b',null),('r&b & soul','r-and-b',null),('r&b/soul','r-and-b',null),
('alternative r&b','r-and-b','alternative-r-and-b'),('pop r&b','r-and-b','pop-r-and-b'),('contemporary r&b','r-and-b','contemporary-r-and-b'),
('hip-hop','hip-hop-rap',null),('hip hop','hip-hop-rap',null),('hip-hop / rap','hip-hop-rap',null),('hip-hop/rap','hip-hop-rap',null),
('rap','hip-hop-rap','rap'),('trap','hip-hop-rap','trap'),('melodic rap','hip-hop-rap','melodic-rap'),
('pop','pop',null),('alternative pop','pop','alternative-pop'),('soul','soul',null),('neo-soul','soul','neo-soul'),('neo soul','soul','neo-soul'),('contemporary soul','soul','contemporary-soul'),
('reggaeton','reggaeton',null),('latin trap','reggaeton','latin-trap'),('perreo','reggaeton','perreo'),('romantic reggaeton','reggaeton','romantic-reggaeton'),
('latin pop','latin-pop',null),('pop urbano','latin-pop','pop-urbano'),('latin dance pop','latin-pop','latin-dance-pop'),('tropical pop','latin-pop','tropical-pop'),
('latin r&b','latin-r-and-b',null),('latin soul','latin-r-and-b','latin-soul'),('r&b urbano','latin-r-and-b','r-and-b-urbano'),('alternative latin r&b','latin-r-and-b','alternative-latin-r-and-b'),
('afrobeats','afrobeats',null),('afro-pop','afrobeats','afro-pop'),('afro pop','afrobeats','afro-pop'),('afro-fusion','afrobeats','afro-fusion'),('afro-r&b','afrobeats','afro-r-and-b'),
('amapiano','amapiano',null),('soulful amapiano','amapiano','soulful-amapiano'),('private school amapiano','amapiano','private-school-amapiano'),('bacardi','amapiano','bacardi'),
('island vibes','island-vibes',null),('dancehall','island-vibes','dancehall'),('reggae','island-vibes','reggae'),('soca','island-vibes','soca'),('lovers rock','island-vibes','lovers-rock'),('caribbean r&b','island-vibes','caribbean-r-and-b')
on conflict(normalized_value) do update set primary_slug=excluded.primary_slug,subgenre_slug=excluded.subgenre_slug;

insert into public.genre_migration_audit(product_id,release_id,title,raw_genre,normalized_genre,mapped_primary_slug,mapped_subgenre_slug,audit_status,audited_at)
select p.id,p.release_id,p.title,p.metadata->>'genre',lower(trim(coalesce(p.metadata->>'genre',''))),m.primary_slug,m.subgenre_slug,
case when trim(coalesce(p.metadata->>'genre',''))='' then 'blank' when m.primary_slug is null then 'unmapped'
when p.release_id is null then 'legacy_without_release' else 'mapped' end,now()
from public.products p left join public.genre_legacy_map m on m.normalized_value=lower(trim(coalesce(p.metadata->>'genre','')))
on conflict(product_id) do update set release_id=excluded.release_id,title=excluded.title,raw_genre=excluded.raw_genre,
normalized_genre=excluded.normalized_genre,mapped_primary_slug=excluded.mapped_primary_slug,mapped_subgenre_slug=excluded.mapped_subgenre_slug,
audit_status=excluded.audit_status,audited_at=now();

do $$ declare unknowns text; begin
 select string_agg(format('%s [%s]',coalesce(title,'Untitled'),raw_genre),', ' order by title) into unknowns from public.genre_migration_audit where audit_status='unmapped';
 if unknowns is not null then raise exception 'Genre migration stopped; add explicit mappings for: %',unknowns; end if;
end $$;

insert into public.release_genre_classifications(release_id,taxonomy_id,role,sort_order)
select a.release_id,t.id,'primary',0 from public.genre_migration_audit a join public.genre_taxonomy t on t.slug=a.mapped_primary_slug where a.audit_status='mapped'
on conflict(release_id,taxonomy_id) do update set role='primary',sort_order=0;
insert into public.release_genre_classifications(release_id,taxonomy_id,role,sort_order)
select a.release_id,t.id,'subgenre',0 from public.genre_migration_audit a join public.genre_taxonomy t on t.slug=a.mapped_subgenre_slug where a.audit_status='mapped' and a.mapped_subgenre_slug is not null
on conflict(release_id,taxonomy_id) do update set role='subgenre',sort_order=0;
