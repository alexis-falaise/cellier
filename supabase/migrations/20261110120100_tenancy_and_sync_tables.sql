-- Cellier migration 02: households, membership, invitations, and the sync bookkeeping tables.

-- A household is the tenant. Every inventory row carries household_id.
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  field_clock jsonb not null default '{}'::jsonb,   -- field name -> HLC of the last accepted write
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Membership. Exactly one owner per household: the partial unique index allows at most one,
-- and the household RPCs (create, transfer, leave) keep at least one.
create table public.household_members (
  household_id       uuid not null references public.households (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  role               text not null default 'member' check (role in ('owner', 'member')),
  display_name       text not null default '' check (char_length(display_name) <= 80),
  avatar_url         text check (avatar_url is null or char_length(avatar_url) <= 1000),
  notify_running_low boolean not null default true,
  notify_digest      boolean not null default true,
  joined_at          timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (household_id, user_id)
);
-- RLS helper lookups go by user_id; the primary key only covers household_id first.
create index household_members_user_id_idx on public.household_members (user_id, household_id);
create unique index household_members_one_owner_idx
  on public.household_members (household_id) where role = 'owner';

-- Invitation codes. Only the SHA-256 of the code is stored; the code is shown once.
create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  token_hash   bytea not null unique,
  created_by   uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  max_uses     integer not null default 1 check (max_uses = 1),   -- single use (design 03 §5)
  uses         integer not null default 0 check (uses >= 0),
  revoked_at   timestamptz,
  check (uses <= max_uses)
);
create index household_invites_household_id_idx on public.household_invites (household_id, created_at desc);
create index household_invites_created_by_idx on public.household_invites (created_by);

-- Per-household monotonic sync counter. Incrementing it takes a row lock, which serialises
-- writers within one household so sync ids become visible in commit order (no gaps seen by readers).
create table private.household_sync (
  household_id   uuid primary key references public.households (id) on delete cascade,
  last_sync_id   bigint not null default 0,
  pruned_through bigint not null default 0      -- change_log rows with sync_id <= this were deleted
);

-- Change log: one row per changed entity row. Row content is NOT stored; pull_changes reads the
-- current row, which compacts repeated edits and keeps the log small.
create table private.change_log (
  household_id uuid not null references public.households (id) on delete cascade,
  sync_id      bigint not null,
  entity       text not null check (entity in
                 ('household', 'member', 'pantry', 'category', 'product', 'stock', 'movement',
                  'grocery', 'overwrite')),
  row_id       text not null,          -- uuid as text; for stock: '<pantry_id>:<product_id>'; for member: user_id
  op           text not null check (op in ('upsert', 'delete')),
  changed_at   timestamptz not null default now(),
  primary key (household_id, sync_id)
);
create index change_log_changed_at_idx on private.change_log (changed_at);

-- Idempotency ledger for apply_mutations: one row per client mutation id, holding its result.
create table private.applied_mutations (
  mutation_id  uuid primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  actor_id     uuid not null,
  device_id    uuid not null,
  device_seq   bigint not null,
  name         text not null,
  status       text not null check (status in ('pending', 'applied', 'clamped', 'gone', 'invalid')),
  result       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index applied_mutations_household_id_idx on private.applied_mutations (household_id, created_at);
create index applied_mutations_created_at_idx on private.applied_mutations (created_at);

-- Ids merged into a canonical row after an add-versus-add conflict (same natural key created
-- on two offline devices). The server resolves aliases on every incoming reference.
create table private.id_aliases (
  household_id uuid not null references public.households (id) on delete cascade,
  alias_id     uuid not null,
  canonical_id uuid not null,
  entity       text not null check (entity in ('pantry', 'category', 'product', 'grocery')),
  created_at   timestamptz not null default now(),
  primary key (household_id, alias_id)
);

-- Invite redemption attempts, for rate limiting peek_invite and accept_invite (brute force of the
-- 8-character codes). key = 'u:<user id>' or 'ip:<client address>'. Pruned after 1 day.
create table private.invite_attempts (
  id         bigint generated always as identity primary key,
  key        text not null,
  found      boolean not null,
  created_at timestamptz not null default now()
);
create index invite_attempts_key_idx on private.invite_attempts (key, created_at);
create index invite_attempts_failed_idx on private.invite_attempts (created_at) where not found;

create trigger households_set_updated_at
  before update on public.households
  for each row execute function private.set_updated_at();
create trigger household_members_set_updated_at
  before update on public.household_members
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- RLS helpers (security definer so policies can read membership without recursive RLS).
-- `(select auth.uid())` makes the uid an init plan, evaluated once per statement.
-- ---------------------------------------------------------------------------------------------
create or replace function private.my_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.household_members m
  where m.user_id = (select auth.uid());
$$;

create or replace function private.my_owned_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.household_members m
  where m.user_id = (select auth.uid()) and m.role = 'owner';
$$;

create or replace function private.is_member(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_owner(p_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

revoke all on function private.my_household_ids() from public, anon;
revoke all on function private.my_owned_household_ids() from public, anon;
revoke all on function private.is_member(uuid) from public, anon;
revoke all on function private.is_owner(uuid) from public, anon;
grant execute on function private.my_household_ids() to authenticated, service_role;
grant execute on function private.my_owned_household_ids() to authenticated, service_role;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.is_owner(uuid) to authenticated, service_role;
