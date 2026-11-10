# 16 - Supabase: multi-tenant RLS, Realtime, performance (Cellier)

Research date: 2026-11-10. Sources fetched the same day unless noted. Items marked **UNVERIFIED** could not be confirmed from a primary source (page 404, secondary source only, or inference).

## 1. Recommendations at a glance

- **Tenancy:** membership lives in a `household_members` table. RLS calls a `private.` security-definer helper that returns the caller's household ids. No custom JWT claim for membership in v1.
- **Realtime:** Broadcast from the database (`realtime.broadcast_changes` in triggers) on one private channel per household, `household:<uuid>`. Supabase's docs say "We recommend using Broadcast for most use cases." Postgres Changes is acceptable for a small app but is authorised per subscriber per event. Presence is only for slow-changing state (who is online), not for stock data.
- **Delivery:** treat Realtime as at-most-once. Every reconnect or foreground event runs a catch-up pull keyed on `updated_at` and soft deletes.
- **Keys:** client uses the publishable key (`sb_publishable_...`). The secret key stays in Edge Functions only. Legacy `anon` and `service_role` are to be disabled before end of 2026.
- **Free plan:** Realtime's 200 concurrent connections and 100 messages/s are the binding limits for Realtime. The 500 MB database is the binding limit for data. Free projects pause after 1 week of inactivity.

## 2. Free-plan limits (as of 2026-11-10)

| Resource | Free plan | Source |
|---|---|---|
| Database size | 500 MB per project | [pricing](https://supabase.com/pricing) |
| Monthly active users | 50,000 | pricing |
| Egress | 5 GB (page also says "5 GB cached egress"; **UNVERIFIED** how the two relate) | pricing |
| File storage | 1 GB | pricing |
| Realtime concurrent connections | 200 | [Realtime limits](https://supabase.com/docs/guides/realtime/limits) |
| Realtime messages per second | 100 | Realtime limits |
| Realtime channel joins per second | 100 | Realtime limits |
| Realtime channels per connection | 100 | Realtime limits |
| Realtime broadcast payload | 256 KB | Realtime limits |
| Postgres Changes payload | 1,024 KB (fields over 64 bytes dropped from `old`/`new` when exceeded) | Realtime limits |
| Presence keys per object / presence msgs per s | 10 / 20 | Realtime limits |
| Broadcast replay retention / per request | 72 h / 25 messages | Realtime limits |
| Realtime messages per month | 2,000,000 | pricing |
| Edge Function invocations | 500,000 per month | pricing |
| Active free projects | 2 (paused projects do not count) | pricing |
| Inactivity pause | after 1 week without activity | pricing |

Note: the pricing and limits pages can change. Re-check before any capacity decision.

## 3. Row-level security patterns

### 3.1 Documented guidance (Supabase RLS performance pages)

Sources: [RLS performance and best practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

1. **Wrap `auth.uid()` in `select`:** `(select auth.uid())` makes an initPlan, cached per statement, instead of a call per row.
2. **Index every policy filter column.** A column is indexed only if it leads a B-tree. A PK `(household_id, user_id)` does not cover lookups by `user_id`, so add `(user_id, household_id)`.
3. **`to authenticated`** on every policy, so `anon` requests skip evaluation.
4. **Security-definer helpers:** pin `search_path = ''`, schema-qualify every name, keep them outside exposed schemas, revoke `execute` from `public`/`anon`.
5. **Avoid row-correlated joins in policies.** Use `column in (select helper())`, which the docs describe as a fixed set, rather than a correlated `exists` per row.
6. **Do not rely on RLS for filtering.** Add explicit `.eq('household_id', ...)` in queries too.

Benchmark table (from the RLS performance page, as summarised by the fetch tool; **UNVERIFIED** against raw HTML, times presumed ms, the page's own test dataset):

| Test | Change | Before | After |
|---|---|---|---|
| 1 | Index on `user_id` | 171 | <0.1 |
| 2a | Wrap `auth.uid()` | 179 | 9 |
| 2b | Wrap `is_admin()` (table join) | 11,000 | 7 |
| 2d | Wrap `has_role()` | 178,000 | 12 |
| 2e | Wrap `user_teams()` in `array(select ...)` | 173,000 | 16 |
| 3 | Explicit `.eq` filter added | 171 | 9 |
| 5 | Join on fixed set instead of `auth.uid()` | 9,000 | 20 |
| 6 | `TO authenticated` | 170 | <0.1 |

Team example in the same page: 1M-row table, unwrapped `= ANY(user_teams())` timed out at over 2 minutes. Wrapped plus an index on `team_id`: 2 ms (10 teams), 3 ms (100), 3 ms (500). The page warns that lists above about 10K values may need separate analysis.

Also from the search: a third-party copy of the table has "171 ms vs under 1 ms" for the same index case, which matches. Not independently benchmarked by us.

### 3.2 Our pattern

- Membership in `public.household_members (household_id, user_id, role)`, PK `(household_id, user_id)`, and index `(user_id, household_id)`.
- Helpers in a `private` schema that is not exposed through the Data API. This keeps them out of the Data API, which is what advisors 0028/0029 check. (**UNVERIFIED** that advisors ignore non-exposed schemas.)
- Composite foreign keys (`household_id`, `pantry_id`) so a row cannot point at another tenant's pantry.
- Ledger is append-only: no update or delete policy on `stock_movements`.
- Writes that must be atomic (quantity change plus ledger row) go through a `security invoker` RPC, so RLS still applies.

## 4. Custom access token hook (JWT claims)

Source: [Custom claims and RBAC](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac).

- Hook signature: `public.custom_access_token_hook(event jsonb) returns jsonb`, `plpgsql`, `stable`.
- Grants: `grant usage on schema public` and `grant execute` to `supabase_auth_admin`; `revoke execute` from `authenticated`, `anon`, `public`; `grant all` on the roles table to `supabase_auth_admin`; `revoke all` from the API roles; permissive select policy for `supabase_auth_admin`.
- The hook writes into the access token only. Clients must decode `access_token`.
- The docs warn claims can be stale until the token refreshes. They do not state the refresh interval. The hook is labelled Beta on the dashboard (as of the fetch).
- `user_metadata` is user-editable and must not hold authorisation data. Use `app_metadata`.

**Trade-off for Cellier:** a `household_ids` array claim avoids a function call per query, but membership changes (removal, invite acceptance) do not reach the client until the token refreshes. That leaves a window where a removed member still passes RLS on a token that still lists the household. The DB helper is cached per statement and is authoritative. **Decision: DB helper for membership.** A hook is only worth it for a non-security UI claim such as the "active household" id.

## 5. Owner versus member permissions

| Table | Member | Owner |
|---|---|---|
| households | select | update name; delete via RPC |
| household_members | select own household; delete own row (leave) | delete any row except self-owner |
| pantries | select | insert, update, delete |
| categories | select, insert, update | delete |
| inventory_items | select, insert, update, delete | same |
| stock_movements | select, insert | select, insert (no update/delete for anyone) |
| household_invites | none | select, insert, update (revoke) |
| products (catalogue) | select (authenticated only) | select |

Owner is stored as `households.owner_id` and also as `role = 'owner'` on the member row. Transferring ownership is an RPC.

## 6. Invitations

Recommended: a random code, stored as a hash, redeemed through an RPC. The client never reads the invites table.

- Generate: `gen_random_bytes(16)` shown once to the owner, `sha256` hash stored in `household_invites.token_hash`.
- Accept: RPC `public.accept_household_invite(p_code text) returns uuid` (`security definer`, `set search_path = ''`). It checks `auth.uid()` is not null, finds the hash where not expired, not revoked and `uses < max_uses`, inserts the member with `on conflict do nothing`, increments `uses`, returns the household id.
- Revoke execute from `public`; grant to `authenticated` only.
- Invite link: `https://<app>/join#<code>` (fragment, so it never reaches server logs).

## 7. API keys

Source: [API keys](https://supabase.com/docs/guides/api/api-keys).

- Publishable key `sb_publishable_...`: client code. Maps to `anon`/`authenticated`. Only RLS-allowed access.
- Secret key `sb_secret_...`: backend only (Edge Functions, cron). Maps to `service_role`, bypasses RLS when no user JWT is present. Blocked in browsers (HTTP 401).
- Legacy `anon` and `service_role` JWT keys still work until disabled in Settings > API Keys. Supabase plans to deprecate them "by the end of 2026".
- With RLS on and no policies, a publishable key reaches nothing.

**Client uses the publishable key.** Never ship a secret key in the PWA bundle.

## 8. Realtime

Sources: [Broadcast](https://supabase.com/docs/guides/realtime/broadcast), [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), [Presence](https://supabase.com/docs/guides/realtime/presence), [Subscribing to database changes](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes).

### 8.1 Comparison

| | Postgres Changes | Broadcast from DB (recommended) | Presence |
|---|---|---|---|
| Source | WAL via `supabase_realtime` publication | trigger calls `realtime.broadcast_changes` or `realtime.send` | client `track()` |
| Authorisation | RLS checked per event per subscriber | RLS `SELECT` policy on `realtime.messages`, private channel | private channel |
| Scale | Single-threaded, drops with subscribers; docs steer high fan-out to Broadcast (about 3,000 subscribers as a rough point) | fan-out once, scales far better | not for high frequency |
| Filters | server-side `eq`, `in` (max 100), no OR | topic is the filter | n/a |
| DELETE | RLS not applied (cannot check a deleted row) | sent with `old` record | n/a |

Postgres Changes benchmark quoted by Supabase: Micro compute with RLS, 3,000 clients, about 3,000 messages/s total at 616 ms p95. Use it only as orientation.

### 8.2 Broadcast from the database

- Trigger on `inventory_items`, `stock_movements`, `pantries`, `categories` calling `realtime.broadcast_changes` with topic `household:<household_id>`.
- `realtime.send()` defaults to `private => true`. Private channels need Realtime Authorization. Public and private flags must match.
- Client joins the private channel after `realtime.setAuth()` with the user's JWT.
- Database messages sit in `realtime.messages` and are deleted after 3 days. A connected client must create the daily partition, else the insert fails and logs a warning.
- `ack` option: the send promise resolves only after the server confirms.
- Replay (private channels, DB-sent messages): `since` (epoch ms), `limit` max 25, retention about 72 hours. Enough for short gaps, not for bulk catch-up.

### 8.3 Ordering and delivery

- Assume **at-most-once**. Messages are not redelivered after a disconnect (Supabase does not state a formal guarantee on the broadcast page; the no-redelivery behaviour is from the community sources below, **UNVERIFIED** as official).
- Each event carries `updated_at` and the row id. The client keeps the last seen `updated_at` per household and pulls `where updated_at > cursor` on every reconnect and foreground.
- Deletes: use soft delete (`deleted_at`) so a catch-up pull can see removals. Hard deletes are otherwise invisible to a reconnecting client.
- Payload budget: broadcast 256 KB on free. Send the changed row only, never the whole pantry.

### 8.4 Reconnect on mobile Safari (PWA)

- Supabase's troubleshooting guide says backgrounded tabs can disconnect silently, with no error. Heartbeat timers stop while suspended.
- Pattern: on `visibilitychange` (visible) and on `online`, check `channel.state` and call `supabase.realtime.connect()` if not joined, then run the catch-up pull.
- `worker: true` runs the socket in a Web Worker; it helps throttled background tabs, not iOS suspension (**UNVERIFIED** for iOS Safari).
- Known community report: auto-reconnect can leave channels closed. Do not rely on it alone.
- No Safari-specific Supabase source was found. Treat as **UNVERIFIED**; test on a real device.

### 8.5 One channel per household

- One private channel `household:<id>`, subscribed when the user opens a household, unsubscribed when switching. Stays within the 100 channels per connection limit and the 100 joins/s limit.
- Presence is not used for stock data. If "who is editing" is ever needed, keep it on the same channel, but with `track()` at most every 30 s (presence calls per client are capped at 5 per 30 s on every plan).

### 8.6 Realtime policy (draft)

```sql
-- Receive only broadcasts for households the caller belongs to.
-- Realtime Authorization must be enabled; channel must be private.
create policy "household members receive broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.topic() like 'household:%'
  and (split_part(realtime.topic(), ':', 2))::uuid in (select private.my_household_ids())
);
```

Caveat **UNVERIFIED**: Postgres does not guarantee short-circuit evaluation, so the `::uuid` cast may run on non-matching topics. Test with a malformed topic; if it errors, wrap in a helper that returns null on bad input.

## 9. Index design

### 9.1 Tables and indexes (draft)

Schema-qualified, run as one migration. Extensions live in the `extensions` schema on Supabase.

```sql
-- Extensions
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Private schema: helpers never exposed through the Data API
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ============ Tenancy ============
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 80),
  owner_id    uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now()
);
create index households_owner_id_idx on public.households (owner_id);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
-- PK covers household_id lookups; this covers user_id lookups used by RLS
create index household_members_user_idx on public.household_members (user_id, household_id);

create table public.household_invites (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash   text not null unique,
  created_by   uuid not null references auth.users(id) on delete restrict,
  expires_at   timestamptz not null,
  max_uses     int check (max_uses is null or max_uses > 0),
  uses         int not null default 0,
  revoked_at   timestamptz
);
create index household_invites_household_idx on public.household_invites (household_id);
create index household_invites_created_by_idx on public.household_invites (created_by);

-- ============ Helpers (private schema, security definer, pinned search_path) ============
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

create or replace function private.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.households h
    where h.id = hid and h.owner_id = (select auth.uid())
  );
$$;

revoke execute on function private.my_household_ids() from public, anon;
revoke execute on function private.is_household_owner(uuid) from public, anon;
grant execute on function private.my_household_ids() to authenticated;
grant execute on function private.is_household_owner(uuid) to authenticated;

-- ============ Catalogue (shared, read-only) ============
create or replace function private.immutable_unaccent(input text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, input);
$$;
-- UNVERIFIED: the two-argument unaccent call with regdictionary is the usual way to
-- get an immutable wrapper for generated columns and expression indexes.

create table public.products (
  id          bigint generated always as identity primary key,
  ean         text unique,
  name        text not null,
  brand       text,
  search_text text generated always as (
    lower(private.immutable_unaccent(coalesce(name, '') || ' ' || coalesce(brand, '')))
  ) stored
);
-- trigram index: supports ILIKE '%term%' and similarity on French names
create index products_search_trgm_idx on public.products
  using gin (search_text extensions.gin_trgm_ops);

-- ============ Inventory ============
create table public.pantries (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (length(name) between 1 and 80),
  created_at   timestamptz not null default now(),
  unique (id, household_id)                -- target for composite FKs
);
create index pantries_household_idx on public.pantries (household_id);

create table public.categories (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null,
  unique (household_id, name)
);
-- unique (household_id, name) already leads with household_id: no extra index needed

create table public.inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households(id) on delete cascade,
  pantry_id           uuid not null,
  product_id          bigint references public.products(id) on delete set null,
  category_id         uuid references public.categories(id) on delete set null,
  label               text not null check (length(label) between 1 and 120),
  quantity            numeric(12,3) not null default 0 check (quantity >= 0),
  low_stock_threshold numeric(12,3) not null default 0 check (low_stock_threshold >= 0),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,                        -- soft delete for catch-up sync
  unique (id, household_id),                              -- target for composite FK
  foreign key (pantry_id, household_id)
    references public.pantries (id, household_id) on delete cascade
);

-- list query: household + pantry, ordered by label (keyset pagination)
create index inventory_items_list_idx
  on public.inventory_items (household_id, pantry_id, label)
  where deleted_at is null;
-- catch-up pull: household + updated_at cursor
create index inventory_items_sync_idx
  on public.inventory_items (household_id, updated_at);
-- FK indexes (advisor 0001)
create index inventory_items_product_idx  on public.inventory_items (product_id)  where product_id is not null;
create index inventory_items_category_idx on public.inventory_items (category_id) where category_id is not null;
-- low-stock: partial index, predicate matches the query exactly
create index inventory_items_low_stock_idx
  on public.inventory_items (household_id, pantry_id)
  where deleted_at is null and quantity <= low_stock_threshold;

-- ============ Ledger (append-only) ============
create table public.stock_movements (
  id           bigint generated always as identity primary key,
  household_id uuid not null,
  item_id      uuid not null,
  delta        numeric(12,3) not null check (delta <> 0),
  reason       text not null check (reason in ('purchase', 'consume', 'adjust', 'waste')),
  created_by   uuid not null references auth.users(id) on delete restrict,
  created_at   timestamptz not null default now(),
  foreign key (item_id, household_id)
    references public.inventory_items (id, household_id) on delete cascade
);
-- history for household, newest first
create index stock_movements_household_time_idx
  on public.stock_movements (household_id, created_at desc);
-- history for one item
create index stock_movements_item_time_idx
  on public.stock_movements (item_id, created_at desc);
-- FK index (advisor 0001)
create index stock_movements_created_by_idx on public.stock_movements (created_by);
-- BRIN (optional, measure first): only if the ledger reaches tens of millions of rows and
-- time-range scans dominate. Works because created_at is physically ordered on an append-only table.
-- create index stock_movements_created_brin on public.stock_movements using brin (created_at);

-- ============ RLS ============
alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.household_invites  enable row level security;
alter table public.pantries           enable row level security;
alter table public.categories         enable row level security;
alter table public.inventory_items    enable row level security;
alter table public.stock_movements    enable row level security;
alter table public.products           enable row level security;

-- households: members read; owner updates; creation by owner; no direct delete
create policy households_select on public.households for select to authenticated
  using (id in (select private.my_household_ids()));
create policy households_insert on public.households for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy households_update_owner on public.households for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- members: read own households; leave yourself or owner removes others
create policy members_select on public.household_members for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy members_delete on public.household_members for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_household_owner(household_id));

-- invites: owner only (redemption goes through RPC)
create policy invites_owner_select on public.household_invites for select to authenticated
  using (private.is_household_owner(household_id));
create policy invites_owner_insert on public.household_invites for insert to authenticated
  with check (private.is_household_owner(household_id) and created_by = (select auth.uid()));
create policy invites_owner_update on public.household_invites for update to authenticated
  using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));

-- pantries: members read; owner writes
create policy pantries_select on public.pantries for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy pantries_owner_write on public.pantries for all to authenticated
  using (private.is_household_owner(household_id))
  with check (private.is_household_owner(household_id));

-- categories: members read and write
create policy categories_member_all on public.categories for all to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

-- inventory: members read and write
create policy items_member_all on public.inventory_items for all to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

-- ledger: members read and append; no update or delete policy exists
create policy movements_member_select on public.stock_movements for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy movements_member_insert on public.stock_movements for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and created_by = (select auth.uid()));

-- catalogue: any signed-in user reads; nobody writes from the client
-- (a bare `using (true)` would trigger advisor 0024)
create policy products_read on public.products for select to authenticated
  using ((select auth.uid()) is not null);

-- Grants: explicitly limit anon; RLS already blocks, but keep it tight
revoke all on all tables in schema public from anon;
```

Notes on the draft:

- **Owner-only pantry writes** are a product decision. Members may be allowed to create pantries; change `pantries_owner_write` accordingly.
- The `households_update_owner` policy with `owner_id` in the `with check` stops an owner from transferring ownership by direct update. Transfers go through an RPC.
- Everything the policies test is in the table's own indexes or the PK. Policy columns: `household_members(user_id)`, `(household_id)`, `inventory_items(household_id)`, `pantries(household_id)`, `categories(household_id)`, `stock_movements(household_id)`, `households(owner_id)`.
- `stock_movements` has no `updated_at` by design. Ledger rows are immutable.

### 9.2 Query shapes that use these indexes

- Items for a pantry, keyset paging: `where household_id = $1 and pantry_id = $2 and label > $3 order by label limit 50`. Uses `inventory_items_list_idx`.
- Catch-up pull: `where household_id = $1 and updated_at > $2 order by updated_at`. Uses `inventory_items_sync_idx`. Include deleted rows (no `deleted_at` filter).
- Low stock: `where household_id = $1 and deleted_at is null and quantity <= low_stock_threshold`. Matches the partial index predicate.
- Product search: `where search_text like '%' || private.immutable_unaccent(lower($1)) || '%' limit 20`. Uses the trigram GIN index. Keep the normalisation identical on both sides. Also `similarity()` / `<%` for typo tolerance (UNVERIFIED for French names; test).
- Full-text search is the alternative (tsvector with a `french` config plus unaccent). Not verified here; trigram is simpler for autocomplete.

### 9.3 BRIN versus B-tree for the ledger

- The ledger is append-only and `created_at` is physically ordered, so BRIN is a fit in principle. Secondary sources report far smaller indexes (one example: 171 MB B-tree versus 64 kB BRIN, Percona). BRIN is lossy and needs a good physical correlation.
- BRIN does not help a `household_id` filter (not correlated). Our history query filters by household, so the B-tree `(household_id, created_at desc)` is the right default.
- **Decision:** B-tree now. Revisit BRIN only after measuring, with `pg_stats` correlation for `created_at` and `EXPLAIN (ANALYZE, BUFFERS)`. Sources: [Crunchy Data, When does BRIN win?](https://crunchydata.com/blog/postgres-indexing-when-does-brin-win) (secondary; the official postgresql.org BRIN page would not fetch at check time, **UNVERIFIED** for pages_per_range defaults beyond "128 by default").

## 10. PostgREST and supabase-js

- **Select only needed columns:** `.select('id,label,quantity,updated_at')`. Avoid `select('*')` on the items list.
- **Embedding instead of N+1:** `.select('id,label,pantries(name)')`. Uses the FK indexes.
- **Batched writes through RPC:** a single `rpc('apply_stock_movements', { p_movements: [...] })` that loops inside one transaction. One round trip, atomic. Use `security invoker` so RLS applies.
- **`count`:** `count: 'exact'` scans. Use `count: 'estimated'` for the catalogue and for any "N results" label. Use `head: true` for counts alone.
- **Pagination:** keyset (`gt` on the sort key) rather than `range()` offsets on large tables.
- **Explain while debugging:** `.explain({ analyze: true })` needs `pgrst.db_plan_enabled`; **use only outside production**. Source: [RLS performance page](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv).

## 11. Advisors to watch

Source: [Database advisors](https://supabase.com/docs/guides/database/database-advisors). Grouping is ours.

- **Performance:** `0001_unindexed_foreign_keys` (INFO), `0003_auth_rls_initplan` (WARN, fix with `(select auth.uid())`), `0006_multiple_permissive_policies` (WARN, merge overlapping policies), `0009_duplicate_index` (WARN), `0005_unused_index` (INFO), `0020_table_bloat` (WARN).
- **Security:** `0010_security_definer_view` (ERROR; never create views with security-definer semantics), `0011_function_search_path_mutable` (WARN; set `search_path = ''`), `0013_rls_disabled_in_public` (ERROR), `0015_rls_references_user_metadata` (ERROR; never use `user_metadata` in policies), `0024_permissive_rls_policy` (WARN; avoid `using (true)`), `0028`/`0029` security-definer function executable by `anon`/`authenticated` (WARN; keep helpers in `private`), `0012_auth_allow_anonymous_sign_ins` (INFO; anonymous users get the `authenticated` role).

## 12. Open questions (UNVERIFIED)

- Exact `realtime.broadcast_changes` and `realtime.topic()` signatures on the current platform version. Check against the live project with `\df realtime.*`.
- Whether advisors ignore helper functions in non-exposed schemas (0028/0029).
- Catch-up semantics and whether Realtime's `ack` solves send-side loss. Not a receive guarantee.
- Safari or iOS PWA suspension behaviour for Supabase sockets. Needs a device test.
- Custom token hook refresh interval (not stated).
- Pricing page wording on egress ("5 GB" and "5 GB cached egress") is ambiguous.
- Unaccent and pg_trgm Supabase docs pages returned 404 at fetch time; the setup above follows general Postgres usage.
- BRIN thresholds: only secondary sources, not the postgresql.org page.

## 13. Sources

- Supabase RLS performance and best practices: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Custom claims and RBAC (access token hook): https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac
- API keys: https://supabase.com/docs/guides/api/api-keys
- Realtime Broadcast: https://supabase.com/docs/guides/realtime/broadcast
- Realtime Postgres Changes: https://supabase.com/docs/guides/realtime/postgres-changes
- Realtime Presence: https://supabase.com/docs/guides/realtime/presence
- Realtime limits: https://supabase.com/docs/guides/realtime/limits
- Realtime silent disconnections in backgrounded apps: https://supabase.com/docs/guides/troubleshooting/realtime-handling-silent-disconnections-in-backgrounded-applications-592794
- Database advisors: https://supabase.com/docs/guides/database/database-advisors
- Pricing: https://supabase.com/pricing
- Crunchy Data, BRIN: https://crunchydata.com/blog/postgres-indexing-when-does-brin-win (secondary)
- Supabase RLS performance community discussion: https://github.com/orgs/supabase/discussions/14576 (not fetched)

Not fetched successfully (404 at check time): supabase.com/docs/guides/database/extensions/unaccent, .../pg_trgm, postgresql.org/docs/17/brin-intro.html, supabase.com/docs/guides/realtime/reconnecting.
