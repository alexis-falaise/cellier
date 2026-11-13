-- A seuil of 0 means «no alert threshold»: the product (or its kind) is never running low, so it
-- gets no push and drops out of «Bientôt épuisé» and the courses suggestions
-- (mirrors alertsAt in src/features/forecast/model/threshold.ts). Only the v_min <= 0 branch is new.
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
    when v_min <= 0 then false
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

-- Clear the state of products already at a seuil of 0 (no push: p_notify defaults to false).
select private.evaluate_low_stock(p.household_id, p.id)
from public.products p
where p.min_quantity = 0 and p.deleted_at is null;
