-- Cellier migration 13: lets the send-push Edge Function authenticate the pg_net call without
-- holding a copy of the internal secret. The function passes the received x-cellier-secret header
-- here; the comparison happens against the Vault value (cellier_internal_secret).

create or replace function private.verify_internal_secret_impl(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_expected text;
begin
  if p_secret is null or length(p_secret) < 32 then
    return false;
  end if;
  select s.decrypted_secret into v_expected from vault.decrypted_secrets s where s.name = 'cellier_internal_secret';
  if v_expected is null then
    return false;
  end if;
  -- Compare digests so the comparison time does not depend on a shared prefix.
  return extensions.digest(p_secret, 'sha256') = extensions.digest(v_expected, 'sha256');
end;
$$;

create or replace function public.verify_internal_secret(p_secret text)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.verify_internal_secret_impl(p_secret);
$$;

revoke all on function private.verify_internal_secret_impl(text) from public, anon, authenticated;
grant execute on function private.verify_internal_secret_impl(text) to service_role;
revoke all on function public.verify_internal_secret(text) from public, anon, authenticated;
grant execute on function public.verify_internal_secret(text) to service_role;
