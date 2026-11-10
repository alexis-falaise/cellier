-- Cellier migration 01: extensions, the private schema and shared pure helpers.
--
-- Conventions used by every Cellier migration:
--   * Every function sets `search_path = ''` and schema-qualifies every name.
--   * `private` is not exposed through the Data API. Security-definer helpers live there.
--   * Client-facing RPCs live in `public` and are `security invoker`. When a client RPC needs
--     elevated rights it calls a `private` security-definer implementation.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions; -- gen_random_bytes (invite codes)
create extension if not exists pg_net with schema extensions;   -- creates schema `net`
create extension if not exists pg_cron with schema pg_catalog;  -- Supabase documented form

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated, service_role;

-- Immutable accent folding, needed for generated columns and expression indexes.
-- The two-argument form with an explicit dictionary does not depend on search_path,
-- which is what makes the immutable label safe.
create or replace function private.unaccent_immutable(p_input text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, p_input);
$$;

-- Canonical name key used for natural-key uniqueness (pantries, categories, custom products)
-- and for catalogue search: accents folded, lower case, trimmed, inner whitespace collapsed.
-- The client mirrors it in src/domain/text.ts (normalizeName) for local dedupe hints only;
-- the server value is authoritative.
create or replace function private.normalize_name(p_input text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select regexp_replace(lower(private.unaccent_immutable(btrim(p_input))), '\s+', ' ', 'g');
$$;

-- Hybrid logical clock strings: 15-digit wall clock in ms, 6-digit counter, device uuid.
-- Example: 001762780000000.000003.5b1c...  Lexicographic order equals HLC order.
create or replace function private.hlc_is_valid(p_hlc text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_hlc is not null
     and p_hlc ~ '^[0-9]{15}\.[0-9]{6}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- Clamp a client HLC whose wall clock is more than 5 minutes ahead of the server.
-- The counter and device suffix are kept so ties still break deterministically.
create or replace function private.hlc_clamp(p_hlc text)
returns text
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when left(p_hlc, 15)::bigint > (extract(epoch from now()) * 1000)::bigint + 300000
      then lpad(((extract(epoch from now()) * 1000)::bigint + 300000)::text, 15, '0') || substr(p_hlc, 16)
    else p_hlc
  end;
$$;

-- True when an incoming HLC beats the clock stored for one field.
create or replace function private.hlc_wins(p_clock jsonb, p_field text, p_hlc text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(p_clock ->> p_field, '') < p_hlc;
$$;

-- Generic `updated_at` maintenance. A no-op update keeps the old timestamp, so the change-log
-- trigger (which compares old and new) can skip it. Generated columns are removed from the
-- comparison because their value is not available in BEFORE triggers.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'name_key' - 'search_text')
     = (to_jsonb(old) - 'updated_at' - 'name_key' - 'search_text') then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.unaccent_immutable(text) from public, anon;
revoke all on function private.normalize_name(text) from public, anon;
revoke all on function private.hlc_is_valid(text) from public, anon;
revoke all on function private.hlc_clamp(text) from public, anon;
revoke all on function private.hlc_wins(jsonb, text, text) from public, anon;
revoke all on function private.set_updated_at() from public, anon;
grant execute on function private.unaccent_immutable(text) to authenticated, service_role;
grant execute on function private.normalize_name(text) to authenticated, service_role;
grant execute on function private.hlc_is_valid(text) to authenticated, service_role;
grant execute on function private.hlc_clamp(text) to authenticated, service_role;
grant execute on function private.hlc_wins(jsonb, text, text) to authenticated, service_role;
