-- Cellier migration 08: the write path. `public.apply_mutations(p_request jsonb)` applies a batch
-- of client mutations idempotently, in order, each in its own subtransaction.
--
-- Security: every function here is SECURITY INVOKER, so RLS and column grants apply to every
-- write. The only elevated steps are the security-definer triggers (ledger, change log) and the
-- lock helper. See docs/architecture/02-sync-protocol.md for the full contract.
--
-- Result statuses: applied | clamped | gone | invalid | forbidden | retry (see contracts/domain.ts).

-- ---------------------------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------------------------

-- Resolve an id that may have been merged into a canonical row (add-versus-add).
create or replace function private.resolve_id(p_household uuid, p_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select a.canonical_id from private.id_aliases a where a.household_id = p_household and a.alias_id = p_id),
    p_id);
$$;

-- Split an update's fields into those that win against the stored per-field clocks and those
-- that lose. Unknown field names are reported so the caller can reject the mutation.
create or replace function private.lww_split(p_clock jsonb, p_fields jsonb, p_hlc text, p_allowed text[])
returns table (winning jsonb, rejected text[], unknown text[])
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(jsonb_object_agg(f.key, f.value) filter (
      where f.key = any (p_allowed) and private.hlc_wins(p_clock, f.key, p_hlc)), '{}'::jsonb),
    coalesce(array_agg(f.key) filter (
      where f.key = any (p_allowed) and not private.hlc_wins(p_clock, f.key, p_hlc)), '{}'::text[]),
    coalesce(array_agg(f.key) filter (where not (f.key = any (p_allowed))), '{}'::text[])
  from jsonb_each(coalesce(p_fields, '{}'::jsonb)) f;
$$;

-- New clock entries for the winning fields.
create or replace function private.clock_for(p_fields jsonb, p_hlc text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, p_hlc), '{}'::jsonb) from jsonb_object_keys(p_fields) k;
$$;

create or replace function private.result(p_status text, p_code text default null,
                                          p_message text default null, p_data jsonb default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('status', p_status, 'code', p_code,
                                              'message', p_message, 'data', p_data));
$$;

-- Positive integer argument within bounds, or an exception (mapped to 'invalid').
create or replace function private.arg_int(p_args jsonb, p_key text, p_min integer, p_max integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v integer := (p_args ->> p_key)::integer;
begin
  if v is null or v < p_min or v > p_max then
    raise exception '% must be an integer between % and %', p_key, p_min, p_max using errcode = '22023';
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Household and member
-- ---------------------------------------------------------------------------------------------
create or replace function private.m_household_rename(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_clock jsonb;
  v_name  text := btrim(p_args ->> 'name');
begin
  if not private.is_owner(p_household) then
    return private.result('invalid', 'not_owner', 'only the owner renames the household');
  end if;
  select h.field_clock into v_clock from public.households h where h.id = p_household;
  if not private.hlc_wins(v_clock, 'name', p_hlc) then
    return private.result('applied', null, null, jsonb_build_object('rejectedFields', jsonb_build_array('name')));
  end if;
  update public.households
     set name = v_name, field_clock = field_clock || jsonb_build_object('name', p_hlc)
   where id = p_household;
  return private.result('applied', null, null, jsonb_build_object('rejectedFields', '[]'::jsonb));
end;
$$;

create or replace function private.m_member_update_self(p_household uuid, p_args jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from jsonb_object_keys(p_args) k
             where k not in ('displayName', 'notifyRunningLow', 'notifyDigest')) then
    return private.result('invalid', 'validation', 'unknown field');
  end if;
  update public.household_members m
     set display_name       = coalesce(btrim(p_args ->> 'displayName'), m.display_name),
         notify_running_low = coalesce((p_args ->> 'notifyRunningLow')::boolean, m.notify_running_low),
         notify_digest      = coalesce((p_args ->> 'notifyDigest')::boolean, m.notify_digest)
   where m.household_id = p_household and m.user_id = auth.uid();
  return private.result('applied', null, null, jsonb_build_object('rejectedFields', '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Pantries and categories (same shape: name natural key, LWW fields, tombstones)
-- ---------------------------------------------------------------------------------------------
create or replace function private.m_pantry_create(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id       uuid := (p_args ->> 'pantryId')::uuid;
  v_name     text := btrim(p_args ->> 'name');
  v_existing record;
  v_merged   boolean := false;
  v_restored boolean := false;
begin
  select p.id, p.deleted_at, p.icon, p.color into v_existing
  from public.pantries p
  where p.household_id = p_household
    and (p.id = v_id or p.name_key = private.normalize_name(v_name))
  order by (p.id = v_id) desc
  limit 1;

  if not found then
    insert into public.pantries (id, household_id, name, icon, color, sort_order, field_clock)
    values (v_id, p_household, v_name, p_args ->> 'icon', p_args ->> 'color',
            coalesce((p_args ->> 'sortOrder')::integer, 0),
            private.clock_for(p_args - 'pantryId', p_hlc));
  else
    if v_existing.id <> v_id then
      insert into private.id_aliases (household_id, alias_id, canonical_id, entity)
      values (p_household, v_id, v_existing.id, 'pantry') on conflict do nothing;
      v_merged := true;
    end if;
    v_restored := v_existing.deleted_at is not null;
    -- Merge fills empty fields only; it never overwrites a value someone already set.
    update public.pantries p
       set deleted_at = null,
           icon  = coalesce(p.icon, p_args ->> 'icon'),
           color = coalesce(p.color, p_args ->> 'color')
     where p.id = v_existing.id;
  end if;

  return private.result('applied', null, null, jsonb_build_object(
    'canonicalId', coalesce(v_existing.id, v_id), 'merged', v_merged, 'restored', v_restored));
end;
$$;

create or replace function private.m_pantry_update(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id  uuid := private.resolve_id(p_household, (p_args ->> 'pantryId')::uuid);
  v_row record;
  w     record;
begin
  select p.field_clock, p.deleted_at into v_row
  from public.pantries p where p.id = v_id and p.household_id = p_household;
  if not found then return private.result('gone', 'not_found'); end if;
  if v_row.deleted_at is not null then return private.result('gone'); end if;

  select * into w from private.lww_split(v_row.field_clock, p_args -> 'fields', p_hlc,
                                         array['name', 'icon', 'color', 'sortOrder']);
  if cardinality(w.unknown) > 0 then
    return private.result('invalid', 'validation', 'unknown field ' || w.unknown[1]);
  end if;
  if w.winning ? 'name' and exists (
       select 1 from public.pantries p
       where p.household_id = p_household and p.id <> v_id
         and p.name_key = private.normalize_name(w.winning ->> 'name')) then
    return private.result('invalid', 'name_taken');
  end if;

  update public.pantries p
     set name        = case when w.winning ? 'name' then btrim(w.winning ->> 'name') else p.name end,
         icon        = case when w.winning ? 'icon' then w.winning ->> 'icon' else p.icon end,
         color       = case when w.winning ? 'color' then w.winning ->> 'color' else p.color end,
         sort_order  = case when w.winning ? 'sortOrder' then (w.winning ->> 'sortOrder')::integer else p.sort_order end,
         field_clock = p.field_clock || private.clock_for(w.winning, p_hlc)
   where p.id = v_id;

  return private.result('applied', null, null, jsonb_build_object('rejectedFields', to_jsonb(w.rejected)));
end;
$$;

create or replace function private.m_category_create(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id       uuid := (p_args ->> 'categoryId')::uuid;
  v_name     text := btrim(p_args ->> 'name');
  v_existing record;
  v_merged   boolean := false;
  v_restored boolean := false;
begin
  select c.id, c.deleted_at into v_existing
  from public.categories c
  where c.household_id = p_household
    and (c.id = v_id or c.name_key = private.normalize_name(v_name))
  order by (c.id = v_id) desc
  limit 1;

  if not found then
    insert into public.categories (id, household_id, name, icon, color, sort_order, field_clock)
    values (v_id, p_household, v_name, p_args ->> 'icon', p_args ->> 'color',
            coalesce((p_args ->> 'sortOrder')::integer, 100),
            private.clock_for(p_args - 'categoryId', p_hlc));
  else
    if v_existing.id <> v_id then
      insert into private.id_aliases (household_id, alias_id, canonical_id, entity)
      values (p_household, v_id, v_existing.id, 'category') on conflict do nothing;
      v_merged := true;
    end if;
    v_restored := v_existing.deleted_at is not null;
    update public.categories c
       set deleted_at = null,
           icon  = coalesce(c.icon, p_args ->> 'icon'),
           color = coalesce(c.color, p_args ->> 'color')
     where c.id = v_existing.id;
  end if;

  return private.result('applied', null, null, jsonb_build_object(
    'canonicalId', coalesce(v_existing.id, v_id), 'merged', v_merged, 'restored', v_restored));
end;
$$;

create or replace function private.m_category_update(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id  uuid := private.resolve_id(p_household, (p_args ->> 'categoryId')::uuid);
  v_row record;
  w     record;
begin
  select c.field_clock, c.deleted_at into v_row
  from public.categories c where c.id = v_id and c.household_id = p_household;
  if not found then return private.result('gone', 'not_found'); end if;
  if v_row.deleted_at is not null then return private.result('gone'); end if;

  select * into w from private.lww_split(v_row.field_clock, p_args -> 'fields', p_hlc,
                                         array['name', 'icon', 'color', 'sortOrder']);
  if cardinality(w.unknown) > 0 then
    return private.result('invalid', 'validation', 'unknown field ' || w.unknown[1]);
  end if;
  if w.winning ? 'name' and exists (
       select 1 from public.categories c
       where c.household_id = p_household and c.id <> v_id
         and c.name_key = private.normalize_name(w.winning ->> 'name')) then
    return private.result('invalid', 'name_taken');
  end if;

  update public.categories c
     set name        = case when w.winning ? 'name' then btrim(w.winning ->> 'name') else c.name end,
         icon        = case when w.winning ? 'icon' then w.winning ->> 'icon' else c.icon end,
         color       = case when w.winning ? 'color' then w.winning ->> 'color' else c.color end,
         sort_order  = case when w.winning ? 'sortOrder' then (w.winning ->> 'sortOrder')::integer else c.sort_order end,
         field_clock = c.field_clock || private.clock_for(w.winning, p_hlc)
   where c.id = v_id;

  return private.result('applied', null, null, jsonb_build_object('rejectedFields', to_jsonb(w.rejected)));
end;
$$;

-- Tombstone and restore for pantry, category and product. Idempotent; arrival order decides.
create or replace function private.m_set_deleted(p_household uuid, p_entity text, p_id uuid, p_deleted boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := private.resolve_id(p_household, p_id);
  v_n  integer;
begin
  if p_entity = 'pantry' then
    update public.pantries set deleted_at = case when p_deleted then coalesce(deleted_at, now()) end
     where id = v_id and household_id = p_household;
  elsif p_entity = 'category' then
    update public.categories set deleted_at = case when p_deleted then coalesce(deleted_at, now()) end
     where id = v_id and household_id = p_household;
  elsif p_entity = 'grocery' then
    update public.grocery_entries set deleted_at = case when p_deleted then coalesce(deleted_at, now()) end
     where id = v_id and household_id = p_household;
  else
    update public.products set deleted_at = case when p_deleted then coalesce(deleted_at, now()) end
     where id = v_id and household_id = p_household;
  end if;
  get diagnostics v_n = row_count;
  if v_n = 0 then return private.result('gone', 'not_found'); end if;
  return private.result('applied');
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------------------------
create or replace function private.m_product_create(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id       uuid := (p_args ->> 'productId')::uuid;
  v_name     text := btrim(p_args ->> 'name');
  v_gtin     text := nullif(p_args ->> 'gtin', '');
  v_catalog  text := nullif(p_args ->> 'catalogGtin', '');
  v_category uuid;
  v_existing record;
  v_merged   boolean := false;
  v_restored boolean := false;
begin
  if p_args ? 'categoryId' and p_args ->> 'categoryId' is not null then
    v_category := private.resolve_id(p_household, (p_args ->> 'categoryId')::uuid);
  end if;
  -- A catalogue reference that does not exist is dropped rather than failing the create.
  if v_catalog is not null and not exists (select 1 from public.catalog_products c where c.gtin = v_catalog) then
    v_catalog := null;
  end if;

  -- Natural key: the barcode when present, otherwise the normalised name among custom products.
  select p.id, p.deleted_at into v_existing
  from public.products p
  where p.household_id = p_household
    and (p.id = v_id
         or (v_gtin is not null and p.gtin = v_gtin)
         or (v_gtin is null and p.gtin is null and p.name_key = private.normalize_name(v_name)))
  order by (p.id = v_id) desc
  limit 1;

  if not found then
    insert into public.products (id, household_id, name, brand, gtin, catalog_gtin, category_id,
                                 net_quantity, net_unit, pack_count, price_cents, price_source,
                                 min_quantity, usual_quantity, low_alert, image_url, field_clock)
    values (v_id, p_household, v_name, p_args ->> 'brand', v_gtin, v_catalog, v_category,
            (p_args ->> 'netQuantity')::numeric, p_args ->> 'netUnit', (p_args ->> 'packCount')::smallint,
            (p_args ->> 'priceCents')::integer, p_args ->> 'priceSource',
            (p_args ->> 'minQuantity')::integer, (p_args ->> 'usualQuantity')::integer,
            coalesce((p_args ->> 'lowAlert')::boolean, true),
            p_args ->> 'imageUrl',
            private.clock_for(p_args - 'productId' - 'gtin' - 'catalogGtin', p_hlc));
  else
    if v_existing.id <> v_id then
      insert into private.id_aliases (household_id, alias_id, canonical_id, entity)
      values (p_household, v_id, v_existing.id, 'product') on conflict do nothing;
      v_merged := true;
    end if;
    v_restored := v_existing.deleted_at is not null;
    update public.products p
       set deleted_at   = null,
           brand        = coalesce(p.brand, p_args ->> 'brand'),
           catalog_gtin = coalesce(p.catalog_gtin, v_catalog),
           category_id  = coalesce(p.category_id, v_category),
           net_quantity = coalesce(p.net_quantity, (p_args ->> 'netQuantity')::numeric),
           net_unit     = coalesce(p.net_unit, p_args ->> 'netUnit'),
           pack_count   = coalesce(p.pack_count, (p_args ->> 'packCount')::smallint),
           price_cents  = coalesce(p.price_cents, (p_args ->> 'priceCents')::integer),
           price_source = coalesce(p.price_source, p_args ->> 'priceSource'),
           min_quantity = coalesce(p.min_quantity, (p_args ->> 'minQuantity')::integer),
           usual_quantity = coalesce(p.usual_quantity, (p_args ->> 'usualQuantity')::integer),
           image_url    = coalesce(p.image_url, p_args ->> 'imageUrl')
     where p.id = v_existing.id;
  end if;

  return private.result('applied', null, null, jsonb_build_object(
    'canonicalId', coalesce(v_existing.id, v_id), 'merged', v_merged, 'restored', v_restored));
end;
$$;

create or replace function private.m_product_update(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id  uuid := private.resolve_id(p_household, (p_args ->> 'productId')::uuid);
  v_row record;
  w     record;
  v_cat uuid;
begin
  select p.field_clock, p.deleted_at, p.gtin into v_row
  from public.products p where p.id = v_id and p.household_id = p_household;
  if not found then return private.result('gone', 'not_found'); end if;
  if v_row.deleted_at is not null then return private.result('gone'); end if;

  select * into w from private.lww_split(v_row.field_clock, p_args -> 'fields', p_hlc, array[
    'name', 'brand', 'categoryId', 'netQuantity', 'netUnit', 'packCount', 'priceCents',
    'priceSource', 'minQuantity', 'usualQuantity', 'lowAlert', 'imageUrl']);
  if cardinality(w.unknown) > 0 then
    return private.result('invalid', 'validation', 'unknown field ' || w.unknown[1]);
  end if;
  if w.winning ? 'name' and v_row.gtin is null and exists (
       select 1 from public.products p
       where p.household_id = p_household and p.id <> v_id and p.gtin is null
         and p.name_key = private.normalize_name(w.winning ->> 'name')) then
    return private.result('invalid', 'name_taken');
  end if;
  if w.winning ? 'categoryId' and w.winning ->> 'categoryId' is not null then
    v_cat := private.resolve_id(p_household, (w.winning ->> 'categoryId')::uuid);
  end if;

  update public.products p
     set name         = case when w.winning ? 'name' then btrim(w.winning ->> 'name') else p.name end,
         brand        = case when w.winning ? 'brand' then w.winning ->> 'brand' else p.brand end,
         category_id  = case when w.winning ? 'categoryId' then v_cat else p.category_id end,
         net_quantity = case when w.winning ? 'netQuantity' then (w.winning ->> 'netQuantity')::numeric else p.net_quantity end,
         net_unit     = case when w.winning ? 'netUnit' then w.winning ->> 'netUnit' else p.net_unit end,
         pack_count   = case when w.winning ? 'packCount' then (w.winning ->> 'packCount')::smallint else p.pack_count end,
         price_cents  = case when w.winning ? 'priceCents' then (w.winning ->> 'priceCents')::integer else p.price_cents end,
         price_source = case when w.winning ? 'priceSource' then w.winning ->> 'priceSource' else p.price_source end,
         min_quantity = case when w.winning ? 'minQuantity' then (w.winning ->> 'minQuantity')::integer else p.min_quantity end,
         usual_quantity = case when w.winning ? 'usualQuantity' then (w.winning ->> 'usualQuantity')::integer else p.usual_quantity end,
         low_alert    = case when w.winning ? 'lowAlert' then coalesce((w.winning ->> 'lowAlert')::boolean, true) else p.low_alert end,
         image_url    = case when w.winning ? 'imageUrl' then w.winning ->> 'imageUrl' else p.image_url end,
         field_clock  = p.field_clock || private.clock_for(w.winning, p_hlc)
   where p.id = v_id;

  return private.result('applied', null, null, jsonb_build_object('rejectedFields', to_jsonb(w.rejected)));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Stock. The ledger BEFORE INSERT trigger computes applied_delta and quantity_after under lock.
-- ---------------------------------------------------------------------------------------------

-- Returns null when pantry and product are alive in the household, else a 'gone' result.
create or replace function private.check_stock_target(p_household uuid, p_pantry uuid, p_product uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when not exists (select 1 from public.pantries p where p.id = p_pantry and p.household_id = p_household)
      or not exists (select 1 from public.products p where p.id = p_product and p.household_id = p_household)
      then private.result('gone', 'not_found')
    when exists (select 1 from public.pantries p where p.id = p_pantry and p.deleted_at is not null)
      or exists (select 1 from public.products p where p.id = p_product and p.deleted_at is not null)
      then private.result('gone')
  end;
$$;

create or replace function private.m_stock_single(p_household uuid, p_device uuid, p_mutation uuid,
                                                  p_name text, p_args jsonb, p_client_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_pantry  uuid := private.resolve_id(p_household, (p_args ->> 'pantryId')::uuid);
  v_product uuid := private.resolve_id(p_household, (p_args ->> 'productId')::uuid);
  v_kind    text;
  v_req     integer;
  v_counted integer;
  v_gone    jsonb;
  v_mv      record;
begin
  if p_name = 'stock.add' then
    v_kind := 'restock';
    v_req  := private.arg_int(p_args, 'quantity', 1, 9999);
  elsif p_name = 'stock.remove' then
    v_kind := coalesce(p_args ->> 'reason', 'consume');
    if v_kind not in ('consume', 'discard') then
      return private.result('invalid', 'validation', 'reason must be consume or discard');
    end if;
    v_req := -private.arg_int(p_args, 'quantity', 1, 9999);
  else
    v_kind    := 'recount';
    v_counted := private.arg_int(p_args, 'counted', 0, 99999);
    v_req     := 0;   -- replaced by the trigger: counted - quantity at apply time
  end if;

  v_gone := private.check_stock_target(p_household, v_pantry, v_product);
  if v_gone is not null then return v_gone; end if;

  insert into public.stock_movements (id, household_id, pantry_id, product_id, kind, counted,
                                      requested_delta, device_id, client_at, source)
  values (p_mutation, p_household, v_pantry, v_product, v_kind, v_counted, v_req, p_device, p_client_at,
          p_args ->> 'source')
  returning requested_delta, applied_delta, quantity_after into v_mv;

  return private.result(
    case when v_mv.applied_delta = v_mv.requested_delta then 'applied' else 'clamped' end,
    null, null,
    jsonb_build_object('movementId', p_mutation, 'requested', v_mv.requested_delta,
                       'applied', v_mv.applied_delta, 'quantityAfter', v_mv.quantity_after));
end;
$$;

create or replace function private.m_stock_transfer(p_household uuid, p_device uuid, p_mutation uuid,
                                                    p_args jsonb, p_client_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_from    uuid := private.resolve_id(p_household, (p_args ->> 'fromPantryId')::uuid);
  v_to      uuid := private.resolve_id(p_household, (p_args ->> 'toPantryId')::uuid);
  v_product uuid := private.resolve_id(p_household, (p_args ->> 'productId')::uuid);
  v_qty     integer := private.arg_int(p_args, 'quantity', 1, 9999);
  v_gone    jsonb;
  v_out     record;
  v_in_id   uuid;
  v_in_qty  integer;
begin
  if v_from = v_to then
    return private.result('invalid', 'validation', 'source and destination are the same pantry');
  end if;
  v_gone := coalesce(private.check_stock_target(p_household, v_from, v_product),
                     private.check_stock_target(p_household, v_to, v_product));
  if v_gone is not null then return v_gone; end if;

  insert into public.stock_movements (id, household_id, pantry_id, product_id, kind, requested_delta,
                                      transfer_id, device_id, client_at, source)
  values (p_mutation, p_household, v_from, v_product, 'transfer_out', -v_qty, p_mutation, p_device, p_client_at,
          p_args ->> 'source')
  returning applied_delta, quantity_after into v_out;

  if v_out.applied_delta <> 0 then
    v_in_id := gen_random_uuid();
    insert into public.stock_movements (id, household_id, pantry_id, product_id, kind, requested_delta,
                                        transfer_id, device_id, client_at, source)
    values (v_in_id, p_household, v_to, v_product, 'transfer_in', -v_out.applied_delta, p_mutation, p_device, p_client_at,
            p_args ->> 'source')
    returning quantity_after into v_in_qty;
  end if;

  return private.result(
    case when -v_out.applied_delta = v_qty then 'applied' else 'clamped' end, null, null,
    jsonb_build_object('movementId', p_mutation, 'requested', v_qty, 'applied', -v_out.applied_delta,
                       'quantityAfter', v_out.quantity_after, 'inMovementId', v_in_id,
                       'toQuantityAfter', v_in_qty));
end;
$$;

-- Undo: writes 'correction' movements that invert what was applied. A transfer is undone as a
-- whole (destination first, then source with the amount actually taken back).
create or replace function private.m_stock_revert(p_household uuid, p_device uuid, p_mutation uuid,
                                                  p_args jsonb, p_client_at timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_target  uuid := (p_args ->> 'movementId')::uuid;
  v_mv      public.stock_movements;
  v_out     public.stock_movements;
  v_in      public.stock_movements;
  v_gone    jsonb;
  v_c1      record;
  v_id2     uuid;
begin
  select * into v_mv from public.stock_movements m where m.id = v_target and m.household_id = p_household;
  if not found then return private.result('gone', 'not_found'); end if;
  if v_mv.kind in ('recount', 'correction') then
    return private.result('invalid', 'not_revertible');
  end if;

  if v_mv.transfer_id is null then
    if v_mv.applied_delta = 0 then return private.result('invalid', 'not_revertible', 'nothing was applied'); end if;
    if exists (select 1 from public.stock_movements m where m.reverts_id = v_mv.id) then
      return private.result('invalid', 'already_reverted');
    end if;
    v_gone := private.check_stock_target(p_household, v_mv.pantry_id, v_mv.product_id);
    if v_gone is not null then return v_gone; end if;
    insert into public.stock_movements (id, household_id, pantry_id, product_id, kind, requested_delta,
                                        reverts_id, device_id, client_at, source)
    values (p_mutation, p_household, v_mv.pantry_id, v_mv.product_id, 'correction', -v_mv.applied_delta,
            v_mv.id, p_device, p_client_at, 'undo')
    returning requested_delta, applied_delta, quantity_after into v_c1;
    return private.result(
      case when v_c1.applied_delta = v_c1.requested_delta then 'applied' else 'clamped' end, null, null,
      jsonb_build_object('movementId', p_mutation, 'requested', v_c1.requested_delta, 'applied', v_c1.applied_delta,
                         'quantityAfter', v_c1.quantity_after, 'movementIds', jsonb_build_array(p_mutation)));
  end if;

  -- Transfer: load both legs.
  select * into v_out from public.stock_movements m
   where m.transfer_id = v_mv.transfer_id and m.kind = 'transfer_out';
  select * into v_in from public.stock_movements m
   where m.transfer_id = v_mv.transfer_id and m.kind = 'transfer_in';
  if v_in.id is null then return private.result('invalid', 'not_revertible', 'nothing was moved'); end if;
  if exists (select 1 from public.stock_movements m where m.reverts_id in (v_out.id, v_in.id)) then
    return private.result('invalid', 'already_reverted');
  end if;
  v_gone := coalesce(private.check_stock_target(p_household, v_in.pantry_id, v_in.product_id),
                     private.check_stock_target(p_household, v_out.pantry_id, v_out.product_id));
  if v_gone is not null then return v_gone; end if;

  insert into public.stock_movements (id, household_id, pantry_id, product_id, kind, requested_delta,
                                      reverts_id, device_id, client_at, source)
  values (p_mutation, p_household, v_in.pantry_id, v_in.product_id, 'correction', -v_in.applied_delta,
          v_in.id, p_device, p_client_at, 'undo')
  returning requested_delta, applied_delta, quantity_after into v_c1;

  if v_c1.applied_delta <> 0 then
    v_id2 := gen_random_uuid();
    insert into public.stock_movements (id, household_id, pantry_id, product_id, kind, requested_delta,
                                        reverts_id, device_id, client_at, source)
    values (v_id2, p_household, v_out.pantry_id, v_out.product_id, 'correction', -v_c1.applied_delta,
            v_out.id, p_device, p_client_at, 'undo');
  end if;

  return private.result(
    case when v_c1.applied_delta = v_c1.requested_delta then 'applied' else 'clamped' end, null, null,
    jsonb_build_object('movementId', p_mutation, 'requested', v_c1.requested_delta, 'applied', v_c1.applied_delta,
                       'quantityAfter', v_c1.quantity_after,
                       'movementIds', to_jsonb(array_remove(array[p_mutation, v_id2], null))));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Courses (grocery entries). Checking an entry never changes stock.
-- ---------------------------------------------------------------------------------------------
create or replace function private.m_grocery_create(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id       uuid := (p_args ->> 'groceryId')::uuid;
  v_product  uuid;
  v_label    text := nullif(btrim(p_args ->> 'label'), '');
  v_qty      integer := (p_args ->> 'quantity')::integer;
  v_existing record;
  v_merged   boolean := false;
begin
  if p_args ->> 'productId' is not null then
    v_product := private.resolve_id(p_household, (p_args ->> 'productId')::uuid);
    v_label   := null;
    if not exists (select 1 from public.products p where p.household_id = p_household and p.id = v_product) then
      return private.result('gone', 'not_found');
    end if;
    if exists (select 1 from public.products p
               where p.household_id = p_household and p.id = v_product and p.deleted_at is not null) then
      return private.result('gone');
    end if;
  end if;

  -- Natural key: the open entry of the same product (add-versus-add from two devices).
  select g.id into v_existing
  from public.grocery_entries g
  where g.household_id = p_household
    and (g.id = v_id
         or (v_product is not null and g.product_id = v_product
             and g.checked_at is null and g.dismissed_at is null and g.deleted_at is null))
  order by (g.id = v_id) desc
  limit 1;

  if not found then
    insert into public.grocery_entries (id, household_id, product_id, label, quantity, added_by, field_clock)
    values (v_id, p_household, v_product, v_label, v_qty, auth.uid(),
            private.clock_for(p_args - 'groceryId' - 'productId', p_hlc));
  else
    if v_existing.id <> v_id then
      insert into private.id_aliases (household_id, alias_id, canonical_id, entity)
      values (p_household, v_id, v_existing.id, 'grocery') on conflict do nothing;
      v_merged := true;
    end if;
    update public.grocery_entries g set quantity = coalesce(g.quantity, v_qty) where g.id = v_existing.id;
  end if;

  return private.result('applied', null, null, jsonb_build_object(
    'canonicalId', coalesce(v_existing.id, v_id), 'merged', v_merged, 'restored', false));
end;
$$;

-- fields: label (free-text entries only), quantity, checked (boolean), dismissed (boolean).
create or replace function private.m_grocery_update(p_household uuid, p_args jsonb, p_hlc text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id  uuid := private.resolve_id(p_household, (p_args ->> 'groceryId')::uuid);
  v_row record;
  w     record;
begin
  select g.field_clock, g.deleted_at, g.product_id into v_row
  from public.grocery_entries g where g.id = v_id and g.household_id = p_household;
  if not found then return private.result('gone', 'not_found'); end if;
  if v_row.deleted_at is not null then return private.result('gone'); end if;

  select * into w from private.lww_split(v_row.field_clock, p_args -> 'fields', p_hlc,
                                         array['label', 'quantity', 'checked', 'dismissed']);
  if cardinality(w.unknown) > 0 then
    return private.result('invalid', 'validation', 'unknown field ' || w.unknown[1]);
  end if;
  if w.winning ? 'label' and v_row.product_id is not null then
    return private.result('invalid', 'validation', 'label applies to free-text entries only');
  end if;

  update public.grocery_entries g
     set label        = case when w.winning ? 'label' then nullif(btrim(w.winning ->> 'label'), '') else g.label end,
         quantity     = case when w.winning ? 'quantity' then (w.winning ->> 'quantity')::integer else g.quantity end,
         checked_at   = case when not (w.winning ? 'checked') then g.checked_at
                             when (w.winning ->> 'checked')::boolean then coalesce(g.checked_at, now()) end,
         checked_by   = case when not (w.winning ? 'checked') then g.checked_by
                             when (w.winning ->> 'checked')::boolean then coalesce(g.checked_by, auth.uid()) end,
         dismissed_at = case when not (w.winning ? 'dismissed') then g.dismissed_at
                             when (w.winning ->> 'dismissed')::boolean then coalesce(g.dismissed_at, now()) end,
         field_clock  = g.field_clock || private.clock_for(w.winning, p_hlc)
   where g.id = v_id;

  return private.result('applied', null, null, jsonb_build_object('rejectedFields', to_jsonb(w.rejected)));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- One mutation: idempotency claim, dispatch, error mapping. Runs inside the caller's household lock.
-- ---------------------------------------------------------------------------------------------
create or replace function private.apply_one(p_household uuid, p_device uuid, p_m jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id        uuid;
  v_seq       bigint;
  v_name      text;
  v_args      jsonb;
  v_hlc       text;
  v_client_at timestamptz;
  v_prev      record;
  v_result    jsonb;
begin
  -- Envelope validation.
  begin
    v_id        := (p_m ->> 'id')::uuid;
    v_seq       := (p_m ->> 'seq')::bigint;
    v_name      := p_m ->> 'name';
    v_args      := p_m -> 'args';
    v_hlc       := p_m ->> 'hlc';
    v_client_at := (p_m ->> 'clientAt')::timestamptz;
  exception when others then
    return jsonb_build_object('id', p_m ->> 'id') || private.result('invalid', 'validation', 'malformed envelope');
  end;
  if v_id is null or v_seq is null or v_name is null or jsonb_typeof(v_args) is distinct from 'object'
     or not private.hlc_is_valid(v_hlc) then
    return jsonb_build_object('id', p_m ->> 'id') || private.result('invalid', 'validation', 'malformed envelope');
  end if;
  v_hlc := private.hlc_clamp(v_hlc);

  -- Idempotent replay: return the stored result.
  select a.household_id, a.result into v_prev from private.applied_mutations a where a.mutation_id = v_id;
  if found then
    if v_prev.household_id <> p_household then
      return jsonb_build_object('id', v_id) || private.result('invalid', 'validation', 'mutation id reused');
    end if;
    return v_prev.result || jsonb_build_object('replayed', true);
  end if;

  begin
    insert into private.applied_mutations (mutation_id, household_id, actor_id, device_id, device_seq, name, status)
    values (v_id, p_household, auth.uid(), p_device, v_seq, v_name, 'pending');

    v_result := case v_name
      when 'household.rename'  then private.m_household_rename(p_household, v_args, v_hlc)
      when 'member.updateSelf' then private.m_member_update_self(p_household, v_args)
      when 'pantry.create'     then private.m_pantry_create(p_household, v_args, v_hlc)
      when 'pantry.update'     then private.m_pantry_update(p_household, v_args, v_hlc)
      when 'pantry.delete'     then private.m_set_deleted(p_household, 'pantry', (v_args ->> 'pantryId')::uuid, true)
      when 'pantry.restore'    then private.m_set_deleted(p_household, 'pantry', (v_args ->> 'pantryId')::uuid, false)
      when 'category.create'   then private.m_category_create(p_household, v_args, v_hlc)
      when 'category.update'   then private.m_category_update(p_household, v_args, v_hlc)
      when 'category.delete'   then private.m_set_deleted(p_household, 'category', (v_args ->> 'categoryId')::uuid, true)
      when 'category.restore'  then private.m_set_deleted(p_household, 'category', (v_args ->> 'categoryId')::uuid, false)
      when 'product.create'    then private.m_product_create(p_household, v_args, v_hlc)
      when 'product.update'    then private.m_product_update(p_household, v_args, v_hlc)
      when 'product.delete'    then private.m_set_deleted(p_household, 'product', (v_args ->> 'productId')::uuid, true)
      when 'product.restore'   then private.m_set_deleted(p_household, 'product', (v_args ->> 'productId')::uuid, false)
      when 'stock.add'         then private.m_stock_single(p_household, p_device, v_id, v_name, v_args, v_client_at)
      when 'stock.remove'      then private.m_stock_single(p_household, p_device, v_id, v_name, v_args, v_client_at)
      when 'stock.recount'     then private.m_stock_single(p_household, p_device, v_id, v_name, v_args, v_client_at)
      when 'stock.transfer'    then private.m_stock_transfer(p_household, p_device, v_id, v_args, v_client_at)
      when 'stock.revert'      then private.m_stock_revert(p_household, p_device, v_id, v_args, v_client_at)
      when 'grocery.add'       then private.m_grocery_create(p_household, v_args, v_hlc)
      when 'grocery.update'    then private.m_grocery_update(p_household, v_args, v_hlc)
      when 'grocery.delete'    then private.m_set_deleted(p_household, 'grocery', (v_args ->> 'groceryId')::uuid, true)
      when 'grocery.restore'   then private.m_set_deleted(p_household, 'grocery', (v_args ->> 'groceryId')::uuid, false)
      else private.result('invalid', 'unknown_mutation', v_name)
    end;
    v_result := jsonb_build_object('id', v_id) || v_result;

    update private.applied_mutations
       set status = v_result ->> 'status', result = v_result
     where mutation_id = v_id;
    return v_result;
  exception
    when serialization_failure or deadlock_detected or lock_not_available then
      -- Nothing decided; not stored. The caller stops the batch here.
      return jsonb_build_object('id', v_id) || private.result('retry', 'transient', sqlstate);
    when insufficient_privilege then
      -- RLS rejected a write: the caller lost membership mid-way. Not stored.
      return jsonb_build_object('id', v_id) || private.result('forbidden');
    when unique_violation then
      v_result := jsonb_build_object('id', v_id) || private.result('invalid',
        case when sqlerrm like '%gtin%' then 'gtin_taken' else 'validation' end, sqlerrm);
    when others then
      -- Validation failures (check, not null, cast, foreign key) and unexpected errors: terminal for
      -- this mutation only. The subtransaction is rolled back, so it left no partial effect.
      v_result := jsonb_build_object('id', v_id) || private.result('invalid', 'validation', sqlstate || ': ' || sqlerrm);
  end;

  -- Store the terminal 'invalid' result so a replay returns the same answer.
  insert into private.applied_mutations (mutation_id, household_id, actor_id, device_id, device_seq, name, status, result)
  values (v_id, p_household, auth.uid(), p_device, v_seq, v_name, 'invalid', v_result)
  on conflict (mutation_id) do nothing;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Public entry point
-- ---------------------------------------------------------------------------------------------
create or replace function public.apply_mutations(p_request jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_household uuid;
  v_device    uuid;
  v_list      jsonb := p_request -> 'mutations';
  v_m         jsonb;
  v_r         jsonb;
  v_results   jsonb := '[]'::jsonb;
  v_head      bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Contract errors raise (HTTP 400 from PostgREST): the client must not retry them blindly.
  v_household := (p_request ->> 'householdId')::uuid;
  v_device    := (p_request ->> 'deviceId')::uuid;
  if v_household is null or v_device is null or jsonb_typeof(v_list) is distinct from 'array'
     or jsonb_array_length(v_list) not between 1 and 50 then
    raise exception 'invalid apply_mutations request' using errcode = '22023';
  end if;
  if octet_length(p_request::text) > 262144 then
    raise exception 'apply_mutations request larger than 256 KB' using errcode = '54000';
  end if;

  if not private.is_member(v_household) then
    select coalesce(jsonb_agg(jsonb_build_object('id', e ->> 'id', 'status', 'forbidden')), '[]'::jsonb)
      into v_results from jsonb_array_elements(v_list) e;
    return jsonb_build_object('status', 'not_member', 'serverTime', now(), 'lastSyncId', 0, 'results', v_results);
  end if;

  perform private.lock_household(v_household);

  for v_m in select e from jsonb_array_elements(v_list) e loop
    v_r := private.apply_one(v_household, v_device, v_m);
    v_results := v_results || jsonb_build_array(v_r);
    exit when v_r ->> 'status' in ('retry', 'forbidden');
  end loop;

  select s.last_sync_id into v_head from private.household_sync s where s.household_id = v_household;
  return jsonb_build_object('status', 'ok', 'serverTime', now(), 'lastSyncId', coalesce(v_head, 0),
                            'results', v_results);
end;
$$;

-- Grants: helpers are reachable only through apply_mutations (same caller, invoker rights).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('resolve_id', 'lww_split', 'clock_for', 'result', 'arg_int', 'apply_one',
                        'm_household_rename', 'm_member_update_self', 'm_pantry_create', 'm_pantry_update',
                        'm_category_create', 'm_category_update', 'm_set_deleted', 'm_product_create',
                        'm_product_update', 'check_stock_target', 'm_stock_single', 'm_stock_transfer',
                        'm_stock_revert', 'm_grocery_create', 'm_grocery_update')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end;
$$;

revoke all on function public.apply_mutations(jsonb) from public, anon;
grant execute on function public.apply_mutations(jsonb) to authenticated;
