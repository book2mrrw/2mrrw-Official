-- E1-M: controlled expiration proof without weakening production MFA lifetime.
begin;

create or replace function public.certify_2mrrw_mfa_expiration(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_generation bigint;
  v_authority_id uuid;
  v_token_hash text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  v_accepted boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'user required' using errcode = '22023';
  end if;

  insert into public.mfa_authority_generations(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select generation into v_generation
  from public.mfa_authority_generations
  where user_id = p_user_id;

  insert into public.mfa_authority_sessions(
    user_id, token_hash, auth_session_id, generation, verified_at, expires_at
  ) values (
    p_user_id, v_token_hash, 'controlled-expiration-certification', v_generation,
    now() - interval '2 minutes', now() - interval '1 minute'
  ) returning id into v_authority_id;

  select exists (
    select 1
    from public.mfa_authority_sessions s
    join public.mfa_authority_generations g on g.user_id = s.user_id
    where s.id = v_authority_id
      and s.generation = g.generation
      and s.revoked_at is null
      and s.expires_at > now()
  ) into v_accepted;

  insert into public.mfa_authority_events(
    user_id, authority_id, event_type, generation, detail
  ) values (
    p_user_id, v_authority_id, 'expiration_certified', v_generation,
    jsonb_build_object('expired_authority_accepted', v_accepted)
  );

  delete from public.mfa_authority_sessions where id = v_authority_id;
  return not v_accepted;
end
$$;

revoke all on function public.certify_2mrrw_mfa_expiration(uuid)
  from public, anon, authenticated;
grant execute on function public.certify_2mrrw_mfa_expiration(uuid)
  to service_role;

notify pgrst, 'reload schema';
commit;
