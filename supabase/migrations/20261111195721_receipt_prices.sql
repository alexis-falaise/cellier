-- Cellier migration 16: purchase prices and receipts.
--
-- A purchase price is recorded on the restock movement it paid for: `price_cents` is the unit price
-- paid, `receipt_id` groups the lines of one scanned receipt, `receipt_label` keeps the receipt's
-- own wording (so the next receipt with the same label is matched to the same product) and `store`
-- names the shop. The price history of a product is therefore its priced restocks that were not
-- reverted, and it syncs with the ledger (append-only, no new entity).
--
-- `source 'receipt'` marks movements written by «Scanner le ticket»; `price_source 'receipt'` marks a
-- product price taken from the latest receipt.
--
-- The snapshot keeps every priced restock (not only the last 120 days) so the price history and its
-- median / average survive a resync.

alter table public.stock_movements
  add column price_cents   integer check (price_cents is null or price_cents between 0 and 10000000),
  add column receipt_id    uuid,
  add column receipt_label text check (receipt_label is null or char_length(btrim(receipt_label)) between 1 and 120),
  add column store         text check (store is null or char_length(btrim(store)) between 1 and 60),
  add constraint stock_movements_price_on_restock check (
    kind = 'restock' or (price_cents is null and receipt_id is null and receipt_label is null and store is null));

alter table public.stock_movements drop constraint stock_movements_source_check;
alter table public.stock_movements add constraint stock_movements_source_check
  check (source is null or source in ('scan', 'swipe', 'stepper', 'put_away', 'form', 'undo', 'receipt'));

alter table public.products drop constraint products_price_source_check;
alter table public.products add constraint products_price_source_check
  check (price_source in ('catalog', 'user', 'receipt'));

-- Price history of a product, newest first; also serves the snapshot's "every priced restock".
create index stock_movements_price_idx on public.stock_movements (household_id, product_id, created_at desc)
  where price_cents is not null;
-- One receipt's lines.
create index stock_movements_receipt_idx on public.stock_movements (household_id, receipt_id)
  where receipt_id is not null;

grant insert (price_cents, receipt_id, receipt_label, store) on public.stock_movements to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Pull shape
-- ---------------------------------------------------------------------------------------------

create or replace function private.j_movement(r public.stock_movements)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'seq', r.seq, 'householdId', r.household_id,
    'pantryId', r.pantry_id, 'productId', r.product_id, 'kind', r.kind, 'counted', r.counted,
    'requestedDelta', r.requested_delta, 'appliedDelta', r.applied_delta,
    'quantityAfter', r.quantity_after, 'transferId', r.transfer_id, 'revertsId', r.reverts_id,
    'actorId', r.actor_id, 'source', r.source, 'clientAt', r.client_at, 'createdAt', r.created_at,
    'priceCents', r.price_cents, 'receiptId', r.receipt_id, 'receiptLabel', r.receipt_label,
    'store', r.store);
$$;

-- ---------------------------------------------------------------------------------------------
-- Write path: stock.add takes the optional purchase fields
-- ---------------------------------------------------------------------------------------------

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
  v_price   integer;
  v_receipt uuid;
  v_label   text;
  v_store   text;
  v_gone    jsonb;
  v_mv      record;
begin
  if p_name = 'stock.add' then
    v_kind := 'restock';
    v_req  := private.arg_int(p_args, 'quantity', 1, 9999);
    if p_args ->> 'priceCents' is not null then
      v_price := private.arg_int(p_args, 'priceCents', 0, 10000000);
    end if;
    v_receipt := nullif(p_args ->> 'receiptId', '')::uuid;
    v_label   := nullif(btrim(p_args ->> 'receiptLabel'), '');
    v_store   := nullif(btrim(p_args ->> 'store'), '');
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
                                      requested_delta, device_id, client_at, source,
                                      price_cents, receipt_id, receipt_label, store)
  values (p_mutation, p_household, v_pantry, v_product, v_kind, v_counted, v_req, p_device, p_client_at,
          p_args ->> 'source', v_price, v_receipt, v_label, v_store)
  returning requested_delta, applied_delta, quantity_after into v_mv;

  return private.result(
    case when v_mv.applied_delta = v_mv.requested_delta then 'applied' else 'clamped' end,
    null, null,
    jsonb_build_object('movementId', p_mutation, 'requested', v_mv.requested_delta,
                       'applied', v_mv.applied_delta, 'quantityAfter', v_mv.quantity_after));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Read path: the snapshot keeps every priced restock (price history), plus the 120-day window
-- ---------------------------------------------------------------------------------------------

create or replace function public.pull_changes(p_household uuid, p_since bigint, p_limit integer default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_head    bigint;
  v_pruned  bigint;
  v_limit   integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_to      bigint;
  v_upserts jsonb;
  v_deletes jsonb := '[]'::jsonb;
  v_empty   jsonb := jsonb_build_object('household', '[]'::jsonb, 'member', '[]'::jsonb,
                       'pantry', '[]'::jsonb, 'category', '[]'::jsonb, 'product', '[]'::jsonb,
                       'stock', '[]'::jsonb, 'movement', '[]'::jsonb, 'grocery', '[]'::jsonb,
                       'overwrite', '[]'::jsonb);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household is null or p_since is null or p_since < 0 then
    raise exception 'invalid pull_changes request' using errcode = '22023';
  end if;

  if not private.is_member(p_household) then
    return jsonb_build_object('status', 'not_member', 'mode', 'delta', 'toSyncId', p_since,
      'headSyncId', 0, 'hasMore', false, 'serverTime', now(), 'upserts', v_empty, 'deletes', '[]'::jsonb);
  end if;

  select s.last_sync_id, s.pruned_through into v_head, v_pruned
  from private.household_sync s where s.household_id = p_household;
  v_head   := coalesce(v_head, 0);
  v_pruned := coalesce(v_pruned, 0);

  -- ------------------------------------------------------------------ snapshot
  if p_since = 0 then
    v_upserts := jsonb_build_object(
      'household', (select coalesce(jsonb_agg(private.j_household(h)), '[]'::jsonb)
                    from public.households h where h.id = p_household),
      'member',    (select coalesce(jsonb_agg(private.j_member(m)), '[]'::jsonb)
                    from public.household_members m where m.household_id = p_household),
      'pantry',    (select coalesce(jsonb_agg(private.j_pantry(p)), '[]'::jsonb)
                    from public.pantries p where p.household_id = p_household),
      'category',  (select coalesce(jsonb_agg(private.j_category(c)), '[]'::jsonb)
                    from public.categories c where c.household_id = p_household),
      'product',   (select coalesce(jsonb_agg(private.j_product(p)), '[]'::jsonb)
                    from public.products p where p.household_id = p_household),
      'stock',     (select coalesce(jsonb_agg(private.j_stock(s)), '[]'::jsonb)
                    from public.stock s where s.household_id = p_household),
      'movement',  (select coalesce(jsonb_agg(private.j_movement(m) order by m.seq), '[]'::jsonb)
                    from public.stock_movements m
                    where m.household_id = p_household
                      and (m.created_at > now() - interval '120 days' or m.price_cents is not null
                           or (m.reverts_id is not null and exists (
                                 select 1 from public.stock_movements r
                                 where r.id = m.reverts_id and r.price_cents is not null)))),
      'grocery',   (select coalesce(jsonb_agg(private.j_grocery(g)), '[]'::jsonb)
                    from public.grocery_entries g
                    where g.household_id = p_household
                      and ((g.checked_at is null and g.dismissed_at is null and g.deleted_at is null)
                           or g.updated_at > now() - interval '60 days')),
      'overwrite', (select coalesce(jsonb_agg(private.j_overwrite(o) order by o.created_at), '[]'::jsonb)
                    from public.field_overwrites o
                    where o.household_id = p_household and o.created_at > now() - interval '30 days'));
    return jsonb_build_object('status', 'ok', 'mode', 'snapshot', 'toSyncId', v_head, 'headSyncId', v_head,
      'hasMore', false, 'serverTime', now(), 'upserts', v_upserts, 'deletes', '[]'::jsonb);
  end if;

  -- ------------------------------------------------------------------ resync
  if p_since < v_pruned or p_since > v_head then
    return jsonb_build_object('status', 'resync_required', 'mode', 'delta', 'toSyncId', p_since,
      'headSyncId', v_head, 'hasMore', false, 'serverTime', now(), 'upserts', v_empty, 'deletes', '[]'::jsonb);
  end if;

  -- ------------------------------------------------------------------ delta page
  select max(l.sync_id) into v_to
  from (select c.sync_id from private.change_log c
        where c.household_id = p_household and c.sync_id > p_since
        order by c.sync_id limit v_limit) l;
  v_to := coalesce(v_to, p_since);

  -- Casts are guarded by CASE so a stock key ('<uuid>:<uuid>') is never cast to uuid.
  with keys as materialized (
    select d.entity, d.row_id,
           case when d.entity <> 'stock' then d.row_id::uuid end as uid,
           case when d.entity = 'stock' then split_part(d.row_id, ':', 1)::uuid end as pantry_uid,
           case when d.entity = 'stock' then split_part(d.row_id, ':', 2)::uuid end as product_uid
    from (select distinct c.entity, c.row_id
          from private.change_log c
          where c.household_id = p_household and c.sync_id > p_since and c.sync_id <= v_to) d
  )
  select jsonb_build_object(
    'household', (select coalesce(jsonb_agg(private.j_household(h)), '[]'::jsonb)
                  from public.households h
                  where h.id = p_household and exists (select 1 from keys k where k.entity = 'household')),
    'member',    (select coalesce(jsonb_agg(private.j_member(m)), '[]'::jsonb)
                  from keys k join public.household_members m
                    on m.household_id = p_household and m.user_id = k.uid
                  where k.entity = 'member'),
    'pantry',    (select coalesce(jsonb_agg(private.j_pantry(p)), '[]'::jsonb)
                  from keys k join public.pantries p on p.id = k.uid and p.household_id = p_household
                  where k.entity = 'pantry'),
    'category',  (select coalesce(jsonb_agg(private.j_category(c)), '[]'::jsonb)
                  from keys k join public.categories c on c.id = k.uid and c.household_id = p_household
                  where k.entity = 'category'),
    'product',   (select coalesce(jsonb_agg(private.j_product(p)), '[]'::jsonb)
                  from keys k join public.products p on p.id = k.uid and p.household_id = p_household
                  where k.entity = 'product'),
    'stock',     (select coalesce(jsonb_agg(private.j_stock(s)), '[]'::jsonb)
                  from keys k join public.stock s
                    on s.household_id = p_household
                   and s.pantry_id = k.pantry_uid
                   and s.product_id = k.product_uid
                  where k.entity = 'stock'),
    'movement',  (select coalesce(jsonb_agg(private.j_movement(m) order by m.seq), '[]'::jsonb)
                  from keys k join public.stock_movements m on m.id = k.uid and m.household_id = p_household
                  where k.entity = 'movement'),
    'grocery',   (select coalesce(jsonb_agg(private.j_grocery(g)), '[]'::jsonb)
                  from keys k join public.grocery_entries g on g.id = k.uid and g.household_id = p_household
                  where k.entity = 'grocery'),
    'overwrite', (select coalesce(jsonb_agg(private.j_overwrite(o) order by o.created_at), '[]'::jsonb)
                  from keys k join public.field_overwrites o on o.id = k.uid and o.household_id = p_household
                  where k.entity = 'overwrite')),
  -- Rows that were logged but no longer exist: hard deletes (members leaving, cascades).
  (select coalesce(jsonb_agg(jsonb_build_object('entity', k.entity, 'id', k.row_id)), '[]'::jsonb)
   from keys k
   where (k.entity = 'member' and not exists (
            select 1 from public.household_members m where m.household_id = p_household and m.user_id = k.uid))
      or (k.entity = 'stock' and not exists (
            select 1 from public.stock s where s.household_id = p_household
              and s.pantry_id = k.pantry_uid and s.product_id = k.product_uid))
      or (k.entity in ('pantry', 'category', 'product', 'movement', 'grocery') and not exists (
            select 1 from public.pantries p where k.entity = 'pantry' and p.id = k.uid
            union all select 1 from public.categories c where k.entity = 'category' and c.id = k.uid
            union all select 1 from public.products p where k.entity = 'product' and p.id = k.uid
            union all select 1 from public.stock_movements m where k.entity = 'movement' and m.id = k.uid
            union all select 1 from public.grocery_entries g where k.entity = 'grocery' and g.id = k.uid)))
  into v_upserts, v_deletes;

  return jsonb_build_object('status', 'ok', 'mode', 'delta', 'toSyncId', v_to, 'headSyncId', v_head,
    'hasMore', v_to < v_head, 'serverTime', now(), 'upserts', v_upserts, 'deletes', v_deletes);
end;
$$;
