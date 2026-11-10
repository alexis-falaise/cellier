-- Cellier migration 10: household lifecycle and invitations. Online-only RPCs (not queued in
-- the outbox). Each public function is a thin SECURITY INVOKER wrapper over a private
-- SECURITY DEFINER implementation, so no definer function is exposed through the Data API.
--
-- Business errors raise SQLSTATE P0001 with a stable message key that the client maps to copy:
--   not_authenticated, not_member, not_owner, household_exists, too_many_households,
--   owner_must_transfer, cannot_remove_owner, target_not_member, invalid_argument.

create or replace function private.raise_key(p_key text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_key using errcode = 'P0001';
end;
$$;

-- Serialise household writes without the membership check (used by the definer functions,
-- including accept_invite where the caller is not a member yet).
create or replace function private.lock_household_definer(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.household_sync (household_id) values (p_household) on conflict (household_id) do nothing;
  perform 1 from private.household_sync where household_id = p_household for update;
end;
$$;

-- Display name and avatar from the Google profile stored by Supabase Auth (display only).
create or replace function private.profile_of(p_user uuid)
returns table (display_name text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select left(coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), nullif(u.raw_user_meta_data ->> 'name', ''),
                       split_part(u.email, '@', 1), ''), 80),
         left(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture'), 1000)
  from auth.users u where u.id = p_user;
$$;

-- ---------------------------------------------------------------------------------------------
-- create_household: idempotent on the client-generated household id.
-- Seeds the 28 default categories and one first pantry.
-- ---------------------------------------------------------------------------------------------
create or replace function private.create_household_impl(p_household_id uuid, p_name text,
                                                         p_pantry_id uuid, p_pantry_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_prof record;
begin
  if v_uid is null then perform private.raise_key('not_authenticated'); end if;
  if p_household_id is null or p_pantry_id is null then perform private.raise_key('invalid_argument'); end if;

  if exists (select 1 from public.households h where h.id = p_household_id) then
    if private.is_owner(p_household_id) then
      return jsonb_build_object('householdId', p_household_id, 'created', false);
    end if;
    perform private.raise_key('household_exists');
  end if;
  if (select count(*) from public.household_members m where m.user_id = v_uid and m.role = 'owner') >= 10 then
    perform private.raise_key('too_many_households');
  end if;

  select * into v_prof from private.profile_of(v_uid);

  insert into public.households (id, name) values (p_household_id, btrim(p_name));
  perform private.lock_household_definer(p_household_id);
  insert into public.household_members (household_id, user_id, role, display_name, avatar_url)
  values (p_household_id, v_uid, 'owner', coalesce(v_prof.display_name, ''), v_prof.avatar_url);

  insert into public.categories (id, household_id, template_key, name, sort_order)
  select gen_random_uuid(), p_household_id, t.key, t.name, t.sort_order * 10
  from public.category_templates t;

  insert into public.pantries (id, household_id, name, sort_order)
  values (p_pantry_id, p_household_id, btrim(coalesce(nullif(p_pantry_name, ''), 'Cellier')), 0);

  return jsonb_build_object('householdId', p_household_id, 'created', true);
end;
$$;

create or replace function public.create_household(p_household_id uuid, p_name text,
                                                   p_pantry_id uuid, p_pantry_name text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.create_household_impl(p_household_id, p_name, p_pantry_id, p_pantry_name);
$$;

-- ---------------------------------------------------------------------------------------------
-- Invitations (design 03 §5). The code is 8 Crockford base-32 characters (40 random bits), single
-- use, valid 7 days, shown once; only its SHA-256 is stored. Link: https://<app>/join#<code>.
-- Typed codes are normalised: upper case, spaces and hyphens removed, I/L -> 1, O -> 0.
-- Redemption is rate limited (private.invite_attempts): 10 failed attempts per user or client
-- address per 15 minutes, and 300 failed attempts overall per 15 minutes.
-- ---------------------------------------------------------------------------------------------
create or replace function private.normalize_invite_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select translate(upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')), 'ILO', '110');
$$;

create or replace function private.create_invite_impl(p_household_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes   bytea;
  v_code    text;
  v_id      uuid;
  v_expires timestamptz := now() + interval '7 days';
begin
  if auth.uid() is null then perform private.raise_key('not_authenticated'); end if;
  if not private.is_owner(p_household_id) then perform private.raise_key('not_owner'); end if;
  if (select count(*) from public.household_invites i
      where i.household_id = p_household_id and i.revoked_at is null and i.uses = 0
        and i.expires_at > now()) >= 20 then
    perform private.raise_key('invalid_argument');
  end if;

  for attempt in 1..5 loop
    v_bytes := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);   -- 256 = 8 x 32: uniform
    end loop;
    begin
      insert into public.household_invites (household_id, token_hash, created_by, expires_at, max_uses)
      values (p_household_id, sha256(convert_to(v_code, 'UTF8')), auth.uid(), v_expires, 1)
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_id := null;   -- same hash as an older invite: draw again
    end;
  end loop;
  if v_id is null then perform private.raise_key('invalid_argument'); end if;

  return jsonb_build_object('inviteId', v_id, 'code', v_code, 'expiresAt', v_expires);
end;
$$;

create or replace function public.create_invite(p_household_id uuid)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.create_invite_impl(p_household_id);
$$;

create or replace function private.revoke_invite_impl(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select i.household_id into v_household from public.household_invites i where i.id = p_invite_id;
  if v_household is null or not private.is_owner(v_household) then perform private.raise_key('not_owner'); end if;
  update public.household_invites set revoked_at = coalesce(revoked_at, now()) where id = p_invite_id;
end;
$$;

create or replace function public.revoke_invite(p_invite_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  select private.revoke_invite_impl(p_invite_id);
$$;

-- Rate-limit key: the user when signed in, else the first X-Forwarded-For address PostgREST received.
create or replace function private.invite_rate_key()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce('u:' || (select auth.uid())::text,
                  'ip:' || nullif(btrim(split_part(
                    coalesce(current_setting('request.headers', true), '{}')::json ->> 'x-forwarded-for', ',', 1)), ''),
                  'ip:unknown');
$$;

create or replace function private.invite_rate_limited(p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select (select count(*) from private.invite_attempts a
          where a.key = p_key and not a.found and a.created_at > now() - interval '15 minutes') >= 10
      or (select count(*) from private.invite_attempts a
          where not a.found and a.created_at > now() - interval '15 minutes') >= 300;
$$;

-- Status of a code for the current caller (anonymous or signed in). Records the attempt.
-- status: valid | already_member | expired | revoked | used_up | not_found | rate_limited
create or replace function private.invite_status(p_code text)
returns table (invite_id uuid, household_id uuid, created_by uuid, expires_at timestamptz, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key  text := private.invite_rate_key();
  v_code text := private.normalize_invite_code(p_code);
  v_inv  public.household_invites;
begin
  if private.invite_rate_limited(v_key) then
    return query select null::uuid, null::uuid, null::uuid, null::timestamptz, 'rate_limited'::text; return;
  end if;
  if v_code ~ '^[0-9A-HJKMNP-TV-Z]{8}$' then
    select * into v_inv from public.household_invites i where i.token_hash = sha256(convert_to(v_code, 'UTF8'));
  end if;
  insert into private.invite_attempts (key, found) values (v_key, v_inv.id is not null);
  if v_inv.id is null then
    return query select null::uuid, null::uuid, null::uuid, null::timestamptz, 'not_found'::text; return;
  end if;
  return query select v_inv.id, v_inv.household_id, v_inv.created_by, v_inv.expires_at,
    case
      when (select auth.uid()) is not null and exists (
             select 1 from public.household_members m
             where m.household_id = v_inv.household_id and m.user_id = (select auth.uid())) then 'already_member'
      when v_inv.revoked_at is not null then 'revoked'
      when v_inv.expires_at <= now() then 'expired'
      when v_inv.uses >= v_inv.max_uses then 'used_up'
      else 'valid'
    end;
end;
$$;

-- Pre-auth preview for /join: only the household name and the inviter's first name, and only for
-- a usable code. Callable by anon.
create or replace function private.peek_invite_impl(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select * into v from private.invite_status(p_code);
  if v.status not in ('valid', 'already_member') then
    return jsonb_build_object('status', v.status, 'householdName', null, 'inviterFirstName', null, 'expiresAt', null);
  end if;
  return jsonb_build_object(
    'status', v.status,
    'householdName', (select h.name from public.households h where h.id = v.household_id),
    'inviterFirstName', (
      select nullif(split_part(btrim(m.display_name), ' ', 1), '')
      from public.household_members m
      where m.household_id = v.household_id and (m.user_id = v.created_by or m.role = 'owner')
      order by (m.user_id = v.created_by) desc
      limit 1),
    'expiresAt', v.expires_at);
end;
$$;

create or replace function public.peek_invite(p_code text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.peek_invite_impl(p_code);
$$;

-- Returns { status: 'joined' | 'already_member' | 'expired' | 'revoked' | 'used_up' | 'not_found'
--           | 'rate_limited', householdId }.
create or replace function private.accept_invite_impl(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      record;
  v_prof record;
begin
  if auth.uid() is null then perform private.raise_key('not_authenticated'); end if;
  select * into v from private.invite_status(p_code);
  if v.status <> 'valid' then
    return jsonb_build_object('status', v.status,
      'householdId', case when v.status = 'already_member' then v.household_id end);
  end if;

  perform private.lock_household_definer(v.household_id);
  -- Re-check under the lock (two people redeeming the same code at once).
  perform 1 from public.household_invites i
   where i.id = v.invite_id and i.uses < i.max_uses and i.revoked_at is null and i.expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('status', 'used_up', 'householdId', null);
  end if;

  select * into v_prof from private.profile_of(auth.uid());
  insert into public.household_members (household_id, user_id, role, display_name, avatar_url)
  values (v.household_id, auth.uid(), 'member', coalesce(v_prof.display_name, ''), v_prof.avatar_url)
  on conflict (household_id, user_id) do nothing;
  update public.household_invites set uses = uses + 1 where id = v.invite_id;

  return jsonb_build_object('status', 'joined', 'householdId', v.household_id);
end;
$$;

create or replace function public.accept_invite(p_code text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.accept_invite_impl(p_code);
$$;

-- ---------------------------------------------------------------------------------------------
-- Membership changes
-- ---------------------------------------------------------------------------------------------
create or replace function private.remove_member_impl(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner(p_household_id) then perform private.raise_key('not_owner'); end if;
  if p_user_id = auth.uid() then perform private.raise_key('cannot_remove_owner'); end if;
  perform private.lock_household_definer(p_household_id);
  delete from public.household_members m where m.household_id = p_household_id and m.user_id = p_user_id;
  if not found then perform private.raise_key('target_not_member'); end if;
end;
$$;

create or replace function public.remove_member(p_household_id uuid, p_user_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  select private.remove_member_impl(p_household_id, p_user_id);
$$;

create or replace function private.transfer_ownership_impl(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner(p_household_id) then perform private.raise_key('not_owner'); end if;
  if not exists (select 1 from public.household_members m
                 where m.household_id = p_household_id and m.user_id = p_user_id and m.role = 'member') then
    perform private.raise_key('target_not_member');
  end if;
  perform private.lock_household_definer(p_household_id);
  -- Demote first: the partial unique index allows only one owner at any time.
  update public.household_members set role = 'member'
   where household_id = p_household_id and user_id = auth.uid();
  update public.household_members set role = 'owner'
   where household_id = p_household_id and user_id = p_user_id;
end;
$$;

create or replace function public.transfer_ownership(p_household_id uuid, p_user_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  select private.transfer_ownership_impl(p_household_id, p_user_id);
$$;

create or replace function private.delete_household_impl(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner(p_household_id) then perform private.raise_key('not_owner'); end if;
  perform private.lock_household_definer(p_household_id);
  begin
    perform realtime.send(jsonb_build_object('householdId', p_household_id), 'household_deleted',
                          'household:' || p_household_id::text, true);
  exception when others then
    raise warning 'cellier: household_deleted broadcast failed: %', sqlerrm;
  end;
  delete from public.households where id = p_household_id;   -- cascades to every household row
end;
$$;

create or replace function public.delete_household(p_household_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  select private.delete_household_impl(p_household_id);
$$;

-- Leave: a member removes themself. The owner must transfer first, unless they are alone,
-- in which case leaving deletes the household.
create or replace function private.leave_household_impl(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_household_id) then perform private.raise_key('not_member'); end if;
  if private.is_owner(p_household_id) then
    if exists (select 1 from public.household_members m
               where m.household_id = p_household_id and m.user_id <> auth.uid()) then
      perform private.raise_key('owner_must_transfer');
    end if;
    perform private.delete_household_impl(p_household_id);
    return;
  end if;
  perform private.lock_household_definer(p_household_id);
  delete from public.household_members m where m.household_id = p_household_id and m.user_id = auth.uid();
end;
$$;

create or replace function public.leave_household(p_household_id uuid)
returns void language sql volatile security invoker set search_path = '' as $$
  select private.leave_household_impl(p_household_id);
$$;

-- ---------------------------------------------------------------------------------------------
-- delete_account (design 03 §5): for each household the caller owns, ownership passes to the
-- longest-standing other member, or the household is deleted when the caller is alone. Then the
-- auth.users row is deleted, which cascades to memberships, push subscriptions and invites, and sets
-- actor references (ledger, Courses, overwrite records) to null.
-- ---------------------------------------------------------------------------------------------
create or replace function private.delete_account_impl()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  r      record;
  v_next uuid;
begin
  if v_uid is null then perform private.raise_key('not_authenticated'); end if;
  for r in select m.household_id from public.household_members m where m.user_id = v_uid and m.role = 'owner' loop
    select m.user_id into v_next from public.household_members m
     where m.household_id = r.household_id and m.user_id <> v_uid
     order by m.joined_at, m.user_id limit 1;
    if v_next is null then
      perform private.delete_household_impl(r.household_id);
    else
      perform private.lock_household_definer(r.household_id);
      update public.household_members set role = 'member' where household_id = r.household_id and user_id = v_uid;
      update public.household_members set role = 'owner' where household_id = r.household_id and user_id = v_next;
    end if;
  end loop;
  delete from auth.users where id = v_uid;
end;
$$;

create or replace function public.delete_account()
returns void language sql volatile security invoker set search_path = '' as $$
  select private.delete_account_impl();
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function private.raise_key(text) from public, anon;
revoke all on function private.lock_household_definer(uuid) from public, anon, authenticated;
revoke all on function private.profile_of(uuid) from public, anon, authenticated;
revoke all on function private.invite_status(text) from public, anon, authenticated;
revoke all on function private.normalize_invite_code(text) from public, anon, authenticated;
revoke all on function private.invite_rate_key() from public, anon, authenticated;
revoke all on function private.invite_rate_limited(text) from public, anon, authenticated;
grant execute on function private.raise_key(text) to authenticated;

revoke all on function private.create_household_impl(uuid, text, uuid, text) from public, anon;
revoke all on function private.create_invite_impl(uuid) from public, anon;
revoke all on function private.revoke_invite_impl(uuid) from public, anon;
revoke all on function private.peek_invite_impl(text) from public;
revoke all on function private.delete_account_impl() from public, anon;
revoke all on function private.accept_invite_impl(text) from public, anon;
revoke all on function private.remove_member_impl(uuid, uuid) from public, anon;
revoke all on function private.transfer_ownership_impl(uuid, uuid) from public, anon;
revoke all on function private.delete_household_impl(uuid) from public, anon;
revoke all on function private.leave_household_impl(uuid) from public, anon;
grant execute on function private.create_household_impl(uuid, text, uuid, text) to authenticated;
grant execute on function private.create_invite_impl(uuid) to authenticated;
grant execute on function private.revoke_invite_impl(uuid) to authenticated;
grant execute on function private.peek_invite_impl(text) to anon, authenticated;
grant execute on function private.delete_account_impl() to authenticated;
grant execute on function private.accept_invite_impl(text) to authenticated;
grant execute on function private.remove_member_impl(uuid, uuid) to authenticated;
grant execute on function private.transfer_ownership_impl(uuid, uuid) to authenticated;
grant execute on function private.delete_household_impl(uuid) to authenticated;
grant execute on function private.leave_household_impl(uuid) to authenticated;

revoke all on function public.create_household(uuid, text, uuid, text) from public, anon;
revoke all on function public.create_invite(uuid) from public, anon;
revoke all on function public.revoke_invite(uuid) from public, anon;
revoke all on function public.peek_invite(text) from public;
revoke all on function public.delete_account() from public, anon;
revoke all on function public.accept_invite(text) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
revoke all on function public.delete_household(uuid) from public, anon;
revoke all on function public.leave_household(uuid) from public, anon;
grant execute on function public.create_household(uuid, text, uuid, text) to authenticated;
grant execute on function public.create_invite(uuid) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.peek_invite(text) to anon, authenticated;
grant execute on function public.delete_account() to authenticated;
-- peek_invite runs before sign-in: anon needs to resolve the private implementation it wraps.
grant usage on schema private to anon;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_household(uuid) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
