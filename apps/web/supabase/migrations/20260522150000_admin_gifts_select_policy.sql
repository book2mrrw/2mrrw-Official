-- Admin gifts visibility: explicit SELECT policy for admin users and fallback UUID.

drop policy if exists "gifts_admin_select_all" on public.gifts;
create policy "gifts_admin_select_all" on public.gifts
  for select
  using (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'admin'
    )
    or auth.uid() = '545cd959-5cae-4009-8a91-1c46fe2f4d27'::uuid
  );

drop policy if exists "gifts_sender_read_own" on public.gifts;
create policy "gifts_sender_read_own" on public.gifts
  for select
  using (auth.uid() = sender_id);

update public.profiles
set role = 'admin'
where id = '545cd959-5cae-4009-8a91-1c46fe2f4d27'::uuid
  and role is distinct from 'admin';
