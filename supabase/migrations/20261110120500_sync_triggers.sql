-- Cellier migration 06: change-log triggers, realtime nudge, and the stock ledger triggers.

-- Take the household writer lock. Every write path calls this before touching household rows,
-- so all writes of one household are serialised and sync ids commit in order. Creates the
-- counter row on first use.
create or replace function private.lock_household(p_household uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Signed-in callers may only lock their own households (service role has no uid).
  if auth.uid() is not null and not private.is_member(p_household) then
    raise exception 'not a member of household %', p_household using errcode = '42501';
  end if;
  insert into private.household_sync (household_id) values (p_household)
  on conflict (household_id) do nothing;
  perform 1 from private.household_sync where household_id = p_household for update;
end;
$$;

-- Send one realtime nudge per transaction and household. Delivered after commit by Realtime.
create or replace function private.nudge_household(p_household uuid, p_sync_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag text := 'cellier.nudged_' || replace(p_household::text, '-', '');
begin
  if coalesce(current_setting(v_flag, true), '') = '1' then
    return;
  end if;
  perform set_config(v_flag, '1', true);   -- transaction-local
  begin
    perform realtime.send(
      jsonb_build_object('syncId', p_sync_id),
      'sync',
      'household:' || p_household::text,
      true
    );
  exception when others then
    -- A failed nudge must never fail the write: clients also pull on start, focus and reconnect.
    raise warning 'cellier: realtime nudge failed for %: %', p_household, sqlerrm;
  end;
end;
$$;

-- Row trigger on every synced table: append to change_log with the next household sync id.
create or replace function private.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       record;
  v_household uuid;
  v_entity    text := tg_argv[0];
  v_row_id    text;
  v_sync_id   bigint;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;

  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return null;   -- no-op update
  end if;

  if v_entity = 'household' then
    v_household := v_row.id;
  else
    v_household := v_row.household_id;
  end if;

  -- During a household delete the cascaded child deletes need no log: the household is gone.
  if tg_op = 'DELETE' and not exists (select 1 from public.households h where h.id = v_household) then
    return null;
  end if;

  v_row_id := case v_entity
    when 'stock'  then v_row.pantry_id::text || ':' || v_row.product_id::text
    when 'member' then v_row.user_id::text
    else v_row.id::text
  end;

  insert into private.household_sync as s (household_id, last_sync_id)
  values (v_household, 1)
  on conflict (household_id) do update set last_sync_id = s.last_sync_id + 1
  returning s.last_sync_id into v_sync_id;

  insert into private.change_log (household_id, sync_id, entity, row_id, op)
  values (v_household, v_sync_id, v_entity, v_row_id,
          case when tg_op = 'DELETE' then 'delete' else 'upsert' end);

  perform private.nudge_household(v_household, v_sync_id);
  return null;
end;
$$;

create trigger households_log_change after insert or update on public.households
  for each row execute function private.log_change('household');
create trigger household_members_log_change after insert or update or delete on public.household_members
  for each row execute function private.log_change('member');
create trigger pantries_log_change after insert or update or delete on public.pantries
  for each row execute function private.log_change('pantry');
create trigger categories_log_change after insert or update or delete on public.categories
  for each row execute function private.log_change('category');
create trigger products_log_change after insert or update or delete on public.products
  for each row execute function private.log_change('product');
create trigger stock_log_change after insert or update or delete on public.stock
  for each row execute function private.log_change('stock');
create trigger stock_movements_log_change after insert on public.stock_movements
  for each row execute function private.log_change('movement');
create trigger grocery_entries_log_change after insert or update or delete on public.grocery_entries
  for each row execute function private.log_change('grocery');
create trigger field_overwrites_log_change after insert on public.field_overwrites
  for each row execute function private.log_change('overwrite');

-- Field-overwrite capture (design «Modification remplacée»). For each field whose clock changed,
-- when the previous write came from another device within the last 7 days and the value really
-- changed, record old and new values. tg_argv[0] = entity. Clock keys are the mutation field names
-- (camelCase); columns are snake_case, except checked/dismissed on grocery entries.
create or replace function private.capture_overwrites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o           jsonb := to_jsonb(old);
  n           jsonb := to_jsonb(new);
  v_household uuid := coalesce((n ->> 'household_id')::uuid, (n ->> 'id')::uuid);
  v_key       text;
  v_new_hlc   text;
  v_old_hlc   text;
  v_col       text;
  v_horizon   bigint := (extract(epoch from now()) * 1000)::bigint - 7 * 86400000;
begin
  if new.field_clock = old.field_clock then return null; end if;
  for v_key, v_new_hlc in select e.key, e.value #>> '{}' from jsonb_each(new.field_clock) e loop
    v_old_hlc := old.field_clock ->> v_key;
    continue when v_old_hlc is null or v_old_hlc = v_new_hlc;
    continue when split_part(v_old_hlc, '.', 3) = split_part(v_new_hlc, '.', 3);   -- same device
    continue when left(v_old_hlc, 15)::bigint < v_horizon;
    v_col := case v_key when 'checked' then 'checked_at' when 'dismissed' then 'dismissed_at'
                        else lower(regexp_replace(v_key, '([A-Z])', '_\1', 'g')) end;
    continue when (o -> v_col) is not distinct from (n -> v_col);
    insert into public.field_overwrites (household_id, entity, row_id, field, old_value, new_value,
                                         old_hlc, new_hlc, actor_id)
    values (v_household, tg_argv[0], new.id, v_key, o -> v_col, n -> v_col, v_old_hlc, v_new_hlc, auth.uid());
  end loop;
  return null;
end;
$$;
revoke all on function private.capture_overwrites() from public, anon, authenticated;

create trigger households_capture_overwrites after update of field_clock on public.households
  for each row execute function private.capture_overwrites('household');
create trigger pantries_capture_overwrites after update of field_clock on public.pantries
  for each row execute function private.capture_overwrites('pantry');
create trigger categories_capture_overwrites after update of field_clock on public.categories
  for each row execute function private.capture_overwrites('category');
create trigger products_capture_overwrites after update of field_clock on public.products
  for each row execute function private.capture_overwrites('product');
create trigger grocery_entries_capture_overwrites after update of field_clock on public.grocery_entries
  for each row execute function private.capture_overwrites('grocery');

-- ---------------------------------------------------------------------------------------------
-- Ledger. The BEFORE trigger is the single place where the floor is enforced: whatever the insert
-- path, it locks the household and the stock row, computes applied_delta (clamping withdrawals at
-- zero, turning a recount into a delta) and quantity_after. The AFTER trigger updates the cache.
-- ---------------------------------------------------------------------------------------------
create or replace function private.movement_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
begin
  perform private.lock_household(new.household_id);

  insert into public.stock (household_id, pantry_id, product_id, quantity)
  values (new.household_id, new.pantry_id, new.product_id, 0)
  on conflict (household_id, pantry_id, product_id) do nothing;

  select s.quantity into v_qty
  from public.stock s
  where s.household_id = new.household_id and s.pantry_id = new.pantry_id and s.product_id = new.product_id
  for update;

  if new.kind = 'recount' then
    if new.counted is null then
      raise exception 'recount requires counted' using errcode = '22023';
    end if;
    new.requested_delta := new.counted - v_qty;
    new.applied_delta   := new.requested_delta;
  elsif new.requested_delta > 0 then
    new.applied_delta := new.requested_delta;
  else
    new.applied_delta := greatest(new.requested_delta, -v_qty);   -- clamp at the floor
  end if;

  new.quantity_after := v_qty + new.applied_delta;
  new.actor_id       := auth.uid();        -- never trust a client-supplied actor
  new.created_at     := now();
  return new;
end;
$$;

create or replace function private.movement_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.applied_delta <> 0 then
    update public.stock s
       set quantity = s.quantity + new.applied_delta,
           updated_at = now()
     where s.household_id = new.household_id and s.pantry_id = new.pantry_id and s.product_id = new.product_id;
  end if;
  return null;
end;
$$;

create or replace function private.forbid_ledger_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.households h where h.id = old.household_id) then
    return old;   -- cascade from a household delete
  end if;
  -- ON DELETE SET NULL from auth.users (account deletion): only actor_id may change.
  if tg_op = 'UPDATE' and new.actor_id is null and old.actor_id is not null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;
  raise exception 'stock_movements is append-only' using errcode = '42501';
end;
$$;

create trigger stock_movements_before_insert before insert on public.stock_movements
  for each row execute function private.movement_before_insert();
create trigger stock_movements_after_insert after insert on public.stock_movements
  for each row execute function private.movement_after_insert();
create trigger stock_movements_append_only before update or delete on public.stock_movements
  for each row execute function private.forbid_ledger_change();

revoke all on function private.lock_household(uuid) from public, anon;
revoke all on function private.nudge_household(uuid, bigint) from public, anon, authenticated;
revoke all on function private.log_change() from public, anon, authenticated;
revoke all on function private.movement_before_insert() from public, anon, authenticated;
revoke all on function private.movement_after_insert() from public, anon, authenticated;
revoke all on function private.forbid_ledger_change() from public, anon, authenticated;
grant execute on function private.lock_household(uuid) to authenticated, service_role;
