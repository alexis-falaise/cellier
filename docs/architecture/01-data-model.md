# 01 — Data model

The database is Postgres on Supabase (free plan). The SQL in `supabase/migrations/` is the source of
truth; this document is a map of it. Wire shapes (camelCase JSON) are in `contracts/domain.ts`. The sync
behaviour is in `02-sync-protocol.md`, notifications in `04`, the catalogue in `05`.

Terms:
- **Household**: the sharing unit. Every synced row carries `household_id`.
- **Synced table**: written through `apply_mutations` and read through `pull_changes`.
- **Tombstone**: a soft delete (`deleted_at` set). Synced rows are never hard-deleted by clients.
- **HLC**: hybrid logical clock string `<15-digit wall ms>.<6-digit counter>.<device uuid>`. Each synced row
  keeps `field_clock` (field name → HLC of the last accepted write) for per-field last-writer-wins.

## 1. Order to apply

Apply the files in name order on a branch database, then run the Supabase advisors (security and performance).

| File | Content |
|---|---|
| `20261110120000_extensions_and_helpers.sql` | extensions, `private` schema, pure helpers (name normalisation, HLC) |
| `…120100_tenancy_and_sync_tables.sql` | households, members, invites, sync counter, change log, idempotency, aliases, invite attempts, RLS helpers |
| `…120200_reference_data.sql` | 28 category templates, `catalog_products`, `search_catalog` |
| `…120300_inventory_tables.sql` | pantries, categories, products, stock, ledger, Courses entries, overwrite records |
| `…120400_notification_tables.sql` | push subscriptions, forecasts, running-low state, notification outbox |
| `…120500_sync_triggers.sql` | change-log trigger, Realtime nudge, ledger triggers, overwrite capture |
| `…120600_rls_and_grants.sql` | grants, RLS policies, Realtime authorization |
| `…120700_apply_mutations.sql` | write path |
| `…120800_pull_changes.sql` | read path |
| `…120900_household_rpcs.sql` | household lifecycle, invites, account deletion |
| `…121000_notifications_and_cron.sql` | running-low evaluation, outbox, digest, sender RPCs, push registration, prune, cron |
| `…121100_catalogue_service.sql` | catalogue lookup gate, upsert, negative cache, cron |

Required extensions: `pg_trgm`, `unaccent`, `pgcrypto` (schema `extensions`), `pg_net`, `pg_cron`
(`with schema pg_catalog`). Vault and Realtime are built in.

## 2. Tables

Columns are listed in full in the SQL; this table gives the purpose, key and access.

### 2.1 Public schema (reachable through the Data API, always under RLS)

| Table | Key | Purpose | Client access (role `authenticated`) |
|---|---|---|---|
| `households` | `id` | name, `field_clock` | members read; owner updates name (mutation) |
| `household_members` | `(household_id, user_id)` | role `owner`/`member` (one owner, partial unique index), display name, avatar, household-level notification switches | members read; a member updates own display name and switches |
| `household_invites` | `id`; `token_hash` unique | single-use 8-character code (SHA-256 only), 7-day expiry, `uses`, `revoked_at` | owner reads safe columns; writes through RPCs |
| `category_templates` | `key` (slug) | the 28 default categories (`key`, French `name`, `sort_order`) | any signed-in user reads |
| `catalog_products` | `gtin` (14 digits) | shared catalogue (Open Food Facts family, ODbL) with trigram `search_text` | any signed-in user reads; service role writes |
| `pantries` | `id` (client uuid) | named storage places; natural key `(household_id, name_key)` | members read, insert, update (column grants) |
| `categories` | `id` | per-household copy of the templates (`template_key`) plus custom ones | as pantries |
| `products` | `id` | household product: name, brand, `gtin` (natural key), `catalog_gtin`, category, net quantity and unit, pack count, price, `min_quantity` (seuil), `usual_quantity` (override), `low_alert`, image | as pantries |
| `stock` | `(household_id, pantry_id, product_id)` | quantity cache (integer ≥ 0), written only by ledger triggers | members read |
| `stock_movements` | `id` (= mutation id); `seq` identity | append-only ledger: kind, counted, requested/applied delta, `quantity_after`, transfer and revert links, actor, device, `source` | members read and insert (trigger computes the result); no update or delete |
| `grocery_entries` | `id` | Courses: product or free-text label, quantity override, checked (at, by), dismissed, tombstone; one open entry per product | as pantries |
| `field_overwrites` | `id` | «Modification remplacée» records: entity, row, field, old and new value and HLC, author | members read; written by trigger |
| `push_subscriptions` | `id`; `endpoint` unique | Web Push endpoint and keys per device, per-device switches, health counters | own rows: read, insert, delete, update keys/switches/`last_seen_at`; registration through RPC |
| `product_forecasts` | `(household_id, product_id)` | forecast published by a client (rate, usual quantity, run-out date, confidence) | members read, insert, update |
| `household_forecasts` | `household_id` | next shopping trip estimate | as above |

### 2.2 Private schema (not exposed through the Data API)

| Table | Purpose |
|---|---|
| `household_sync` | per-household `last_sync_id` (row lock serialises writers) and `pruned_through` |
| `change_log` | `(household_id, sync_id)` → entity, row id, op. No row content; `pull_changes` reads current rows |
| `applied_mutations` | idempotency store: mutation id → status and stored result (60 days) |
| `id_aliases` | ids merged into a canonical row after add-versus-add (pantry, category, product, grocery) |
| `invite_attempts` | invite redemption attempts for rate limiting (1 day) |
| `low_stock_state` | running-low hysteresis state per product |
| `notification_outbox` | pending pushes (running low, daily digest) with dedupe key and retry state |
| `catalog_lookup_log`, `catalog_misses` | catalogue lookup rate limits and 72-hour negative cache |

Members can read `household_sync` and `change_log` rows of their households (used inside invoker RPCs).

## 3. Access rules

- RLS is enabled on every table. Every policy is `to authenticated` and calls `(select auth.uid())` or a
  `private` security-definer helper (`my_household_ids()`, `my_owned_household_ids()`, `is_member()`,
  `is_owner()`) inside `(select …)`, so it is evaluated once per statement. One permissive policy per command.
- Supabase's default grants to `anon` and `authenticated` are revoked; privileges are granted back per table,
  column-level for INSERT and UPDATE. No DELETE privilege on synced tables.
- Every function sets `search_path = ''`. Each public RPC is a SECURITY INVOKER wrapper; where elevated rights
  are needed it calls a SECURITY DEFINER implementation in `private`. No definer function is in `public`.
- `anon` can call exactly one RPC: `peek_invite` (the `/join` screen before sign-in). It has `usage` on
  `private` for that reason only; every private table is revoked from it.
- Composite foreign keys `(household_id, x_id)` make cross-household references impossible.

## 4. RPCs

| Function | Caller | Returns |
|---|---|---|
| `apply_mutations(p_request jsonb)` | authenticated | `ApplyMutationsResponse` (02 §4) |
| `pull_changes(p_household uuid, p_since bigint, p_limit int = 500)` | authenticated | `PullResponse` (02 §5) |
| `search_catalog(p_query text, p_limit int = 20)` | authenticated | `setof catalog_products` |
| `create_household(p_household_id, p_name, p_pantry_id, p_pantry_name)` | authenticated | `{householdId, created}` |
| `create_invite(p_household_id)` | owner | `{inviteId, code, expiresAt}` |
| `revoke_invite(p_invite_id)` | owner | void |
| `peek_invite(p_code)` | anon or authenticated | `InvitePeek` |
| `accept_invite(p_code)` | authenticated | `AcceptInviteResult` |
| `remove_member(p_household_id, p_user_id)`, `transfer_ownership(…)` | owner | void |
| `leave_household(p_household_id)` | member | void |
| `delete_household(p_household_id)` | owner | void (broadcasts `household_deleted`) |
| `delete_account()` | authenticated | void (hands over or deletes owned households, then deletes the auth user) |
| `register_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent)` | authenticated | subscription id |
| `notification_claim(p_limit)`, `notification_complete(p_report)` | service role | 04 |
| `catalog_lookup_gate(p_user, p_gtin)`, `catalog_upsert(p_row)`, `catalog_record_miss(p_gtin)` | service role | 05 |

Household RPC business errors raise SQLSTATE `P0001` with a message key (`HouseholdRpcError`).

## 5. Realtime

- Private channel `household:<uuid>`; the client calls `supabase.realtime.setAuth()` and subscribes with
  `config: { private: true }`.
- Policy `cellier_household_broadcast_select` on `realtime.messages` lets members receive broadcasts; there is
  no insert policy, so clients cannot send.
- Events: `sync` with `{ syncId }`, sent at most once per transaction by `log_change`; `household_deleted`
  with `{ householdId }`.

## 6. Cron jobs (pg_cron, UTC)

| Job | Schedule | Function |
|---|---|---|
| `cellier-notify` | every minute | `private.kick_notification_sender()` → `pg_net` POST to Edge Function `send-push` |
| `cellier-digest` | hourly | `private.enqueue_daily_digests()` (acts at 18:xx Europe/Paris) |
| `cellier-prune` | 03:17 daily | `private.prune()`: change log 30 days, idempotency 60 days, outbox 14 days, idle subscriptions 120 days, overwrites 30 days, invite attempts 1 day, invites 30 days after expiry |
| `cellier-catalog-prune` | 03:41 daily | `private.catalog_prune()`: lookup log 2 days, misses 30 days |

## 7. Set-up outside the migrations

- Vault secrets (SQL editor, once): `cellier_functions_url` = `https://<ref>.supabase.co/functions/v1`,
  `cellier_internal_secret` = 32 random bytes in hex.
- Edge Function secrets (04 §4): `CELLIER_INTERNAL_SECRET` (same value), `VAPID_PRIVATE_JWK`, `VAPID_SUBJECT`
  (real `mailto:` address), `CELLIER_APP_URL` (`https://cellier-one.vercel.app`). `SUPABASE_URL` and the secret
  keys are injected by the platform.
- Front-end environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_VAPID_PUBLIC_KEY`.
- Auth: Google provider enabled; redirect URL `https://cellier-one.vercel.app/auth/callback`.

## 8. Queries per screen

Screens never query Postgres directly. They read the in-memory store (base rows from IndexedDB plus the
pending overlay, 02 §6), whose derived indexes serve every sort and filter (by product, by pantry, by
category, low products, recent movements, open Courses entries). Server reads are:

| Read | Served by |
|---|---|
| Snapshot | primary keys and `(household_id, …)` unique constraints of each table; `stock_movements_household_created_idx` for the 120-day window; `field_overwrites_household_created_idx` |
| Delta page | `change_log` primary key `(household_id, sync_id)`, then primary keys of each entity |
| Catalogue search (new item) | `catalog_products_search_trgm_idx` (GIN trigram) |
| Scan lookup | `catalog_products` primary key |
| RLS helper lookups | `household_members_user_id_idx (user_id, household_id)` |
| Running-low evaluation | `stock_product_idx (household_id, product_id)` |
| Outbox claim | partial index on due pending rows |
| Invite redemption | `household_invites.token_hash` unique; `invite_attempts_key_idx` |
