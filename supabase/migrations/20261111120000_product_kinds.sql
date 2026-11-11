-- Cellier migration 15: product kinds, category provenance and the suggested seuil.
--
-- `kind` is the generic product type ('café moulu', 'lait demi-écrémé'): products of one kind are
-- interchangeable, so running low is evaluated on the kind's household total. `kind` and
-- `suggested_min` are set by the classify-product Edge Function (Claude Haiku) or by a member.
-- `category_source` / `kind_source` say who chose the value; a 'user' value is an override that the
-- client applies to every product of the same kind (docs/architecture/05-catalogue.md §5.8).

alter table public.products
  add column kind            text check (kind is null or char_length(btrim(kind)) between 1 and 60),
  add column kind_source     text check (kind_source in ('model', 'user')),
  add column category_source text check (category_source in ('catalog', 'model', 'user')),
  add column suggested_min   integer check (suggested_min is null or suggested_min between 0 and 9999),
  add column kind_key        text generated always as (private.normalize_name(kind)) stored;

create index products_kind_key_idx on public.products (household_id, kind_key) where kind_key is not null;

grant insert (kind, kind_source, category_source, suggested_min) on public.products to authenticated;
grant update (kind, kind_source, category_source, suggested_min) on public.products to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Sync: pull shape and the two product mutations
-- ---------------------------------------------------------------------------------------------

create or replace function private.j_product(r public.products)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'householdId', r.household_id, 'name', r.name, 'brand', r.brand,
    'gtin', r.gtin, 'catalogGtin', r.catalog_gtin, 'categoryId', r.category_id,
    'netQuantity', r.net_quantity, 'netUnit', r.net_unit, 'packCount', r.pack_count,
    'priceCents', r.price_cents, 'priceSource', r.price_source, 'minQuantity', r.min_quantity,
    'usualQuantity', r.usual_quantity, 'lowAlert', r.low_alert, 'imageUrl', r.image_url,
    'kind', r.kind, 'kindSource', r.kind_source, 'categorySource', r.category_source,
    'suggestedMin', r.suggested_min, 'createdAt', r.created_at,
    'updatedAt', r.updated_at, 'deletedAt', r.deleted_at);
$$;

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
                                 min_quantity, usual_quantity, low_alert, image_url,
                                 kind, kind_source, category_source, suggested_min, field_clock)
    values (v_id, p_household, v_name, p_args ->> 'brand', v_gtin, v_catalog, v_category,
            (p_args ->> 'netQuantity')::numeric, p_args ->> 'netUnit', (p_args ->> 'packCount')::smallint,
            (p_args ->> 'priceCents')::integer, p_args ->> 'priceSource',
            (p_args ->> 'minQuantity')::integer, (p_args ->> 'usualQuantity')::integer,
            coalesce((p_args ->> 'lowAlert')::boolean, true),
            p_args ->> 'imageUrl',
            nullif(btrim(p_args ->> 'kind'), ''), p_args ->> 'kindSource', p_args ->> 'categorySource',
            (p_args ->> 'suggestedMin')::integer,
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
           image_url    = coalesce(p.image_url, p_args ->> 'imageUrl'),
           kind         = coalesce(p.kind, nullif(btrim(p_args ->> 'kind'), '')),
           kind_source  = coalesce(p.kind_source, p_args ->> 'kindSource'),
           category_source = coalesce(p.category_source, p_args ->> 'categorySource'),
           suggested_min = coalesce(p.suggested_min, (p_args ->> 'suggestedMin')::integer)
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
    'priceSource', 'minQuantity', 'usualQuantity', 'lowAlert', 'imageUrl',
    'kind', 'kindSource', 'categorySource', 'suggestedMin']);
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
         kind         = case when w.winning ? 'kind' then nullif(btrim(w.winning ->> 'kind'), '') else p.kind end,
         kind_source  = case when w.winning ? 'kindSource' then w.winning ->> 'kindSource' else p.kind_source end,
         category_source = case when w.winning ? 'categorySource' then w.winning ->> 'categorySource' else p.category_source end,
         suggested_min = case when w.winning ? 'suggestedMin' then (w.winning ->> 'suggestedMin')::integer else p.suggested_min end,
         field_clock  = p.field_clock || private.clock_for(w.winning, p_hlc)
   where p.id = v_id;

  return private.result('applied', null, null, jsonb_build_object('rejectedFields', to_jsonb(w.rejected)));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Running low per kind
-- ---------------------------------------------------------------------------------------------
-- A product with a kind is evaluated with its kind: the household total of every live product of
-- the kind, against the kind's seuil = largest member min_quantity, else largest suggested_min,
-- else the default rule on the largest usual quantity. Every member gets the same state; the push
-- goes out once, when the kind turns low (mirrors src/features/forecast/model/kinds.ts).
create or replace function private.evaluate_low_stock(p_household uuid, p_product uuid, p_notify boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_members uuid[];
  v_alert   boolean;
  v_total   integer;
  v_usual   integer;
  v_userMin integer;
  v_sugMin  integer;
  v_min     integer;
  v_clear   integer;
  v_was     boolean;
  v_low     boolean;
begin
  select p.deleted_at, p.kind_key into v_product
  from public.products p where p.household_id = p_household and p.id = p_product;
  if not found then return; end if;

  if v_product.kind_key is not null and v_product.deleted_at is null then
    select array_agg(p.id) into v_members from public.products p
    where p.household_id = p_household and p.kind_key = v_product.kind_key and p.deleted_at is null;
  else
    v_members := array[p_product];
  end if;

  select coalesce(sum(s.quantity), 0)::integer into v_total
  from public.stock s
  join public.pantries pa on pa.household_id = s.household_id and pa.id = s.pantry_id and pa.deleted_at is null
  where s.household_id = p_household and s.product_id = any (v_members);

  -- Usual purchase size: the member's override, else the published forecast; the largest wins.
  select max(coalesce(p.usual_quantity, f.usual_quantity)), max(p.min_quantity), max(p.suggested_min),
         bool_or(p.low_alert) and bool_and(p.deleted_at is null)
    into v_usual, v_userMin, v_sugMin, v_alert
  from public.products p
  left join public.product_forecasts f on f.household_id = p.household_id and f.product_id = p.id
  where p.household_id = p_household and p.id = any (v_members);

  v_min   := coalesce(v_userMin, v_sugMin, greatest(1, ceil(0.25 * v_usual)::integer), 1);
  v_clear := greatest(v_min + 1, ceil(0.5 * coalesce(v_usual, 0))::integer);

  select coalesce(bool_or(l.is_low), false) into v_was from private.low_stock_state l
  where l.household_id = p_household and l.product_id = any (v_members);

  v_low := case
    when not coalesce(v_alert, false) then false
    when v_was then v_total < v_clear
    else v_total <= v_min
  end;

  insert into private.low_stock_state as l (household_id, product_id, is_low, total_quantity, changed_at)
  select p_household, m, v_low, v_total, now() from unnest(v_members) as m
  on conflict (household_id, product_id) do update
    set is_low = excluded.is_low,
        total_quantity = excluded.total_quantity,
        changed_at = case when l.is_low <> excluded.is_low then now() else l.changed_at end;

  if v_low and not v_was and p_notify then
    insert into private.notification_outbox (household_id, kind, product_id, actor_id)
    values (p_household, 'running_low', p_product, auth.uid());
  end if;
end;
$$;

-- A product leaving a kind (rename, deletion) re-evaluates the kind it left as well.
create or replace function private.product_low_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other uuid;
begin
  perform private.evaluate_low_stock(new.household_id, new.id);
  if tg_op = 'UPDATE' and old.kind_key is not null
     and (old.kind_key is distinct from new.kind_key or new.deleted_at is not null) then
    select p.id into v_other from public.products p
    where p.household_id = new.household_id and p.kind_key = old.kind_key and p.id <> new.id
      and p.deleted_at is null
    limit 1;
    if v_other is not null then perform private.evaluate_low_stock(new.household_id, v_other); end if;
  end if;
  return null;
end;
$$;

drop trigger products_running_low on public.products;
create trigger products_running_low
  after update of min_quantity, usual_quantity, low_alert, deleted_at, kind, suggested_min on public.products
  for each row execute function private.product_low_trigger();
