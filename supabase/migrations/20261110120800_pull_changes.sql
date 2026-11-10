-- Cellier migration 09: the read path. `public.pull_changes(p_household, p_since, p_limit)`.
--
-- since = 0          -> snapshot: every row of the household (movements: last 120 days; grocery
--                       entries: open ones and those changed in the last 60 days; overwrites: 30 days).
-- since > 0          -> delta: one page of change_log after `since`, compacted per row, with the
--                       CURRENT row content (or a delete when the row no longer exists).
-- since < pruned     -> resync_required (the client calls again with since = 0).
--
-- The function is STABLE, so every statement in it reads the same snapshot: the cursor returned
-- always matches the rows returned. It is SECURITY INVOKER: RLS applies to every read.
-- Row shapes (camelCase) are the contract in docs/architecture/contracts/domain.ts.

create or replace function private.j_household(r public.households)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'name', r.name, 'createdAt', r.created_at, 'updatedAt', r.updated_at);
$$;

create or replace function private.j_member(r public.household_members)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('householdId', r.household_id, 'userId', r.user_id, 'role', r.role,
    'displayName', r.display_name, 'avatarUrl', r.avatar_url, 'notifyRunningLow', r.notify_running_low,
    'notifyDigest', r.notify_digest, 'joinedAt', r.joined_at);
$$;

create or replace function private.j_pantry(r public.pantries)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'householdId', r.household_id, 'name', r.name, 'icon', r.icon,
    'color', r.color, 'sortOrder', r.sort_order, 'createdAt', r.created_at, 'updatedAt', r.updated_at,
    'deletedAt', r.deleted_at);
$$;

create or replace function private.j_category(r public.categories)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'householdId', r.household_id, 'templateKey', r.template_key,
    'name', r.name, 'icon', r.icon, 'color', r.color, 'sortOrder', r.sort_order,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'deletedAt', r.deleted_at);
$$;

create or replace function private.j_product(r public.products)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'householdId', r.household_id, 'name', r.name, 'brand', r.brand,
    'gtin', r.gtin, 'catalogGtin', r.catalog_gtin, 'categoryId', r.category_id,
    'netQuantity', r.net_quantity, 'netUnit', r.net_unit, 'packCount', r.pack_count,
    'priceCents', r.price_cents, 'priceSource', r.price_source, 'minQuantity', r.min_quantity,
    'usualQuantity', r.usual_quantity, 'lowAlert', r.low_alert, 'imageUrl', r.image_url, 'createdAt', r.created_at,
    'updatedAt', r.updated_at, 'deletedAt', r.deleted_at);
$$;

create or replace function private.j_stock(r public.stock)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('householdId', r.household_id, 'pantryId', r.pantry_id,
    'productId', r.product_id, 'quantity', r.quantity, 'updatedAt', r.updated_at);
$$;

create or replace function private.j_movement(r public.stock_movements)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'seq', r.seq, 'householdId', r.household_id,
    'pantryId', r.pantry_id, 'productId', r.product_id, 'kind', r.kind, 'counted', r.counted,
    'requestedDelta', r.requested_delta, 'appliedDelta', r.applied_delta,
    'quantityAfter', r.quantity_after, 'transferId', r.transfer_id, 'revertsId', r.reverts_id,
    'actorId', r.actor_id, 'source', r.source, 'clientAt', r.client_at, 'createdAt', r.created_at);
$$;

create or replace function private.j_grocery(r public.grocery_entries)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'householdId', r.household_id, 'productId', r.product_id,
    'label', r.label, 'quantity', r.quantity, 'addedBy', r.added_by, 'checkedAt', r.checked_at,
    'checkedBy', r.checked_by, 'dismissedAt', r.dismissed_at, 'createdAt', r.created_at,
    'updatedAt', r.updated_at, 'deletedAt', r.deleted_at);
$$;

create or replace function private.j_overwrite(r public.field_overwrites)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'householdId', r.household_id, 'entity', r.entity,
    'rowId', r.row_id, 'field', r.field, 'oldValue', r.old_value, 'newValue', r.new_value,
    'oldHlc', r.old_hlc, 'newHlc', r.new_hlc, 'actorId', r.actor_id, 'createdAt', r.created_at);
$$;

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
                    where m.household_id = p_household and m.created_at > now() - interval '120 days'),
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

revoke all on function private.j_household(public.households) from public, anon;
revoke all on function private.j_member(public.household_members) from public, anon;
revoke all on function private.j_pantry(public.pantries) from public, anon;
revoke all on function private.j_category(public.categories) from public, anon;
revoke all on function private.j_product(public.products) from public, anon;
revoke all on function private.j_stock(public.stock) from public, anon;
revoke all on function private.j_movement(public.stock_movements) from public, anon;
revoke all on function private.j_grocery(public.grocery_entries) from public, anon;
revoke all on function private.j_overwrite(public.field_overwrites) from public, anon;
grant execute on function private.j_grocery(public.grocery_entries) to authenticated, service_role;
grant execute on function private.j_overwrite(public.field_overwrites) to authenticated, service_role;
grant execute on function private.j_household(public.households) to authenticated, service_role;
grant execute on function private.j_member(public.household_members) to authenticated, service_role;
grant execute on function private.j_pantry(public.pantries) to authenticated, service_role;
grant execute on function private.j_category(public.categories) to authenticated, service_role;
grant execute on function private.j_product(public.products) to authenticated, service_role;
grant execute on function private.j_stock(public.stock) to authenticated, service_role;
grant execute on function private.j_movement(public.stock_movements) to authenticated, service_role;

revoke all on function public.pull_changes(uuid, bigint, integer) from public, anon;
grant execute on function public.pull_changes(uuid, bigint, integer) to authenticated;
