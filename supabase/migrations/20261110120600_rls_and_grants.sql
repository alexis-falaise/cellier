-- Cellier migration 07: row level security on every table, explicit grants, and the Realtime
-- authorization policy.
--
-- Rules:
--   * Every policy is `to authenticated` and calls auth.uid() through `(select auth.uid())` or a
--     private helper wrapped in `(select ...)`, so it is evaluated once per statement.
--   * One permissive policy per table and command (no overlapping permissive policies).
--   * Grants are explicit: Supabase's default "all to anon, authenticated" is revoked first, then
--     only the needed privileges (column-level for UPDATE) are granted back.
--   * Deletes of synced rows are soft (deleted_at); no DELETE privilege on them.

-- ---------------------------------------------------------------------------------------------
-- Reset default grants
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated, public;
revoke all on all sequences in schema private from anon, authenticated, public;

-- ---------------------------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------------------------
alter table public.households            enable row level security;
alter table public.household_members     enable row level security;
alter table public.household_invites     enable row level security;
alter table public.category_templates    enable row level security;
alter table public.catalog_products      enable row level security;
alter table public.pantries              enable row level security;
alter table public.categories            enable row level security;
alter table public.products              enable row level security;
alter table public.stock                 enable row level security;
alter table public.stock_movements       enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.product_forecasts     enable row level security;
alter table public.household_forecasts   enable row level security;
alter table public.grocery_entries       enable row level security;
alter table public.field_overwrites      enable row level security;
alter table private.invite_attempts      enable row level security;
alter table private.household_sync       enable row level security;
alter table private.change_log           enable row level security;
alter table private.applied_mutations    enable row level security;
alter table private.id_aliases           enable row level security;
alter table private.low_stock_state      enable row level security;
alter table private.notification_outbox  enable row level security;

-- ---------------------------------------------------------------------------------------------
-- Households and membership
-- ---------------------------------------------------------------------------------------------
grant select on public.households to authenticated;
grant update (name, field_clock) on public.households to authenticated;

create policy households_select on public.households
  for select to authenticated
  using (id in (select private.my_household_ids()));
-- Only the owner renames (mutation household.rename). Create and delete go through RPCs.
create policy households_update on public.households
  for update to authenticated
  using (id in (select private.my_owned_household_ids()))
  with check (id in (select private.my_owned_household_ids()));

grant select on public.household_members to authenticated;
grant update (display_name, notify_running_low, notify_digest) on public.household_members to authenticated;

create policy household_members_select on public.household_members
  for select to authenticated
  using (household_id in (select private.my_household_ids()));
-- A member edits only their own row, and only the granted columns (not role).
create policy household_members_update on public.household_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Invites: the owner can list them; creation, revocation and redemption go through RPCs.
grant select (id, household_id, created_by, created_at, expires_at, max_uses, uses, revoked_at)
  on public.household_invites to authenticated;
create policy household_invites_select on public.household_invites
  for select to authenticated
  using (household_id in (select private.my_owned_household_ids()));

-- ---------------------------------------------------------------------------------------------
-- Reference data: readable by any signed-in user, written only by the service role.
-- ---------------------------------------------------------------------------------------------
grant select on public.category_templates to authenticated;
create policy category_templates_select on public.category_templates
  for select to authenticated
  using ((select auth.uid()) is not null);

grant select on public.catalog_products to authenticated;
create policy catalog_products_select on public.catalog_products
  for select to authenticated
  using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------------------------
-- Inventory: members read and write their household's rows (through apply_mutations).
-- ---------------------------------------------------------------------------------------------
grant select on public.pantries to authenticated;
grant insert (id, household_id, name, icon, color, sort_order, field_clock) on public.pantries to authenticated;
grant update (name, icon, color, sort_order, field_clock, deleted_at) on public.pantries to authenticated;
create policy pantries_select on public.pantries
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy pantries_insert on public.pantries
  for insert to authenticated with check (household_id in (select private.my_household_ids()));
create policy pantries_update on public.pantries
  for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

grant select on public.categories to authenticated;
grant insert (id, household_id, template_key, name, icon, color, sort_order, field_clock) on public.categories to authenticated;
grant update (name, icon, color, sort_order, field_clock, deleted_at) on public.categories to authenticated;
create policy categories_select on public.categories
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy categories_insert on public.categories
  for insert to authenticated with check (household_id in (select private.my_household_ids()));
create policy categories_update on public.categories
  for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

grant select on public.products to authenticated;
grant insert (id, household_id, name, brand, gtin, catalog_gtin, category_id, net_quantity, net_unit,
              pack_count, price_cents, price_source, min_quantity, usual_quantity, low_alert, image_url,
              field_clock)
  on public.products to authenticated;
grant update (name, brand, category_id, net_quantity, net_unit, pack_count, price_cents, price_source,
              min_quantity, usual_quantity, low_alert, image_url, field_clock, deleted_at)
  on public.products to authenticated;
create policy products_select on public.products
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy products_insert on public.products
  for insert to authenticated with check (household_id in (select private.my_household_ids()));
create policy products_update on public.products
  for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

-- Stock is a cache written only by the ledger triggers (security definer): read-only here.
grant select on public.stock to authenticated;
create policy stock_select on public.stock
  for select to authenticated using (household_id in (select private.my_household_ids()));

-- Ledger: members read and append. No UPDATE or DELETE privilege; a trigger also forbids them.
-- applied_delta, quantity_after, actor_id and created_at are set by the BEFORE INSERT trigger.
grant select on public.stock_movements to authenticated;
grant insert (id, household_id, pantry_id, product_id, kind, counted, requested_delta,
              transfer_id, reverts_id, device_id, client_at, source)
  on public.stock_movements to authenticated;
create policy stock_movements_select on public.stock_movements
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy stock_movements_insert on public.stock_movements
  for insert to authenticated with check (household_id in (select private.my_household_ids()));

-- Courses entries: same pattern as products (soft delete, column grants).
grant select on public.grocery_entries to authenticated;
grant insert (id, household_id, product_id, label, quantity, added_by, checked_at, checked_by,
              dismissed_at, field_clock)
  on public.grocery_entries to authenticated;
grant update (label, quantity, checked_at, checked_by, dismissed_at, field_clock, deleted_at)
  on public.grocery_entries to authenticated;
create policy grocery_entries_select on public.grocery_entries
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy grocery_entries_insert on public.grocery_entries
  for insert to authenticated with check (household_id in (select private.my_household_ids()));
create policy grocery_entries_update on public.grocery_entries
  for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

-- Overwrite records: written by a definer trigger only; members read.
grant select on public.field_overwrites to authenticated;
create policy field_overwrites_select on public.field_overwrites
  for select to authenticated using (household_id in (select private.my_household_ids()));

-- ---------------------------------------------------------------------------------------------
-- Notifications and forecasts
-- ---------------------------------------------------------------------------------------------
grant select, insert, delete on public.push_subscriptions to authenticated;
grant update (p256dh, auth, user_agent, last_seen_at, notify_running_low, notify_digest)
  on public.push_subscriptions to authenticated;
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update on public.product_forecasts to authenticated;
create policy product_forecasts_select on public.product_forecasts
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy product_forecasts_insert on public.product_forecasts
  for insert to authenticated with check (household_id in (select private.my_household_ids()));
create policy product_forecasts_update on public.product_forecasts
  for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

grant select, insert, update on public.household_forecasts to authenticated;
create policy household_forecasts_select on public.household_forecasts
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy household_forecasts_insert on public.household_forecasts
  for insert to authenticated with check (household_id in (select private.my_household_ids()));
create policy household_forecasts_update on public.household_forecasts
  for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

-- ---------------------------------------------------------------------------------------------
-- Private sync tables used by the security-invoker RPCs (not reachable through the Data API).
-- ---------------------------------------------------------------------------------------------
grant select on private.household_sync to authenticated;
create policy household_sync_select on private.household_sync
  for select to authenticated using (household_id in (select private.my_household_ids()));

grant select on private.change_log to authenticated;
create policy change_log_select on private.change_log
  for select to authenticated using (household_id in (select private.my_household_ids()));

grant select, insert on private.applied_mutations to authenticated;
grant update (status, result) on private.applied_mutations to authenticated;
create policy applied_mutations_select on private.applied_mutations
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy applied_mutations_insert on private.applied_mutations
  for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and actor_id = (select auth.uid()));
create policy applied_mutations_update on private.applied_mutations
  for update to authenticated
  using (actor_id = (select auth.uid())) with check (actor_id = (select auth.uid()));

grant select, insert on private.id_aliases to authenticated;
create policy id_aliases_select on private.id_aliases
  for select to authenticated using (household_id in (select private.my_household_ids()));
create policy id_aliases_insert on private.id_aliases
  for insert to authenticated with check (household_id in (select private.my_household_ids()));

-- low_stock_state and notification_outbox: no grants to clients. Written by security-definer
-- triggers and read by service-role RPCs only. RLS stays enabled with no policy (deny all).

-- ---------------------------------------------------------------------------------------------
-- Realtime authorization. Clients join the private channel `household:<uuid>` and may only
-- receive broadcasts. No INSERT policy: clients cannot send on household channels.
-- Evaluated once per channel join (Supabase docs, Realtime Authorization).
-- ---------------------------------------------------------------------------------------------
create or replace function private.can_read_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_topic ~ '^household:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_member(substr(p_topic, 11)::uuid)
    else false
  end;
$$;
revoke all on function private.can_read_topic(text) from public, anon;
grant execute on function private.can_read_topic(text) to authenticated;

create policy cellier_household_broadcast_select on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast')
    and (select private.can_read_topic((select realtime.topic())))
  );
