-- Fix 1: vault_content SELECT policy was missing the access_tier check.
-- Previous policy: using (visibility = 'published')
-- Bug: any user could read inner_circle/vault_pass content — tier not enforced.
-- Fix: gate restricted tiers behind a vault_entitlements existence check.
drop policy if exists "vault_content_select_published" on public.vault_content;
create policy "vault_content_select_published"
  on public.vault_content for select
  using (
    visibility = 'published'
    and (
      access_tier = 'public'
      or (
        access_tier in ('inner_circle', 'vault_pass')
        and exists (
          select 1 from public.vault_entitlements ve
          where ve.user_id = auth.uid()
            and ve.access_tier = public.vault_content.access_tier
            and ve.status = 'active'
            and (ve.starts_at is null or ve.starts_at <= now())
            and (ve.ends_at   is null or ve.ends_at   >  now())
        )
      )
    )
  );

-- Fix 2: signals_select_active was dropped in signal_lifecycle_system migration
-- and never recreated — leaving signals table with RLS enabled but no SELECT policy,
-- which silently denies anon-client reads.
drop policy if exists "signals_select_active" on public.signals;
create policy "signals_select_active"
  on public.signals for select
  using (
    status = 'active'
    and (starts_at is null or starts_at <= now())
    and (expires_at is null or expires_at > now())
  );
