-- Legal name for collector card activation (KYC-lite, display not public by default)
alter table public.profiles add column if not exists legal_name text;

comment on column public.profiles.legal_name is 'Full legal name collected at collector card activation; distinct from display full_name.';
