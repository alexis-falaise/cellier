-- Cellier migration: notifications name what is missing, not which product.
--
-- «Café moulu : plus que 1», not «Café moulu Colombie 250 g : plus que 1». A product with a kind is
-- named after it (first letter capitalised, as `listName` does on the client), and the digest lists
-- a kind once: every product of a low kind is low with the kind's total (private.evaluate_low_stock),
-- so listing each of them repeated the same line.
--
-- Only the `name` values and the number of digest lines change; the payload shape is the same, so
-- the send-push Edge Function needs no redeploy.

-- The name of a product on the lists and in notifications: its kind, else its own name.
create or replace function private.list_name(p_name text, p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(upper(left(k, 1)) || substr(k, 2), p_name)
  from (select nullif(regexp_replace(btrim(p_kind), '\s+', ' ', 'g'), '') as k) s;
$$;

create or replace function private.notification_claim_impl(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        private.notification_outbox;
  v_items      jsonb := '[]'::jsonb;
  v_recipients jsonb;
  v_product    jsonb;
  v_digest     jsonb;
begin
  for v_row in
    with due as (
      select o.id from private.notification_outbox o
      where o.status = 'pending' and o.not_before <= now()
      order by o.id
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
      for update skip locked
    )
    update private.notification_outbox o
       set status = 'sending', attempts = o.attempts + 1, claimed_at = now()
      from due where o.id = due.id
    returning o.*
  loop
    v_product := null;
    v_digest  := null;

    if v_row.kind = 'running_low' then
      -- Re-check at send time: a restock inside the debounce window cancels the alert.
      select jsonb_build_object('id', p.id, 'name', private.list_name(p.name, p.kind), 'totalQuantity', l.total_quantity,
                                'minQuantity', coalesce(p.min_quantity, 1))
        into v_product
      from public.products p
      join private.low_stock_state l on l.household_id = p.household_id and l.product_id = p.id and l.is_low
      where p.household_id = v_row.household_id and p.id = v_row.product_id and p.deleted_at is null;
      if v_product is null then
        update private.notification_outbox set status = 'skipped', last_error = 'no longer low' where id = v_row.id;
        continue;
      end if;
    else
      select jsonb_build_object(
        -- One line per kind: every product of a low kind is low, with the kind's total.
        'lowProducts', coalesce((
          select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'totalQuantity', x.total_quantity)
                           order by x.name)
          from (
            select distinct on (coalesce(p.kind_key, p.id::text))
                   p.id, private.list_name(p.name, p.kind) as name, l.total_quantity
            from private.low_stock_state l
            join public.products p on p.household_id = l.household_id and p.id = l.product_id and p.deleted_at is null
            where l.household_id = v_row.household_id and l.is_low
            order by coalesce(p.kind_key, p.id::text), p.id
          ) x), '[]'::jsonb),
        'runningOutSoon', coalesce((
          select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'runOutAt', x.run_out_at)
                           order by x.run_out_at)
          from (
            select distinct on (coalesce(p.kind_key, p.id::text))
                   p.id, private.list_name(p.name, p.kind) as name, f.run_out_at
            from public.product_forecasts f
            join public.products p on p.household_id = f.household_id and p.id = f.product_id
                                  and p.deleted_at is null and p.low_alert
            where f.household_id = v_row.household_id and f.run_out_at < now() + interval '3 days'
              and f.computed_at > now() - interval '7 days'
              and not exists (select 1 from private.low_stock_state l
                              where l.household_id = f.household_id and l.product_id = f.product_id and l.is_low)
            order by coalesce(p.kind_key, p.id::text), f.run_out_at
          ) x), '[]'::jsonb),
        'nextTripOn', (select hf.next_trip_on from public.household_forecasts hf
                       where hf.household_id = v_row.household_id and hf.computed_at > now() - interval '7 days'))
        into v_digest;
    end if;

    v_recipients := private.recipients_for(v_row.household_id, v_row.kind,
                                           case when v_row.kind = 'running_low' then v_row.actor_id end);
    if jsonb_array_length(v_recipients) = 0 then
      update private.notification_outbox set status = 'skipped', last_error = 'no recipients' where id = v_row.id;
      continue;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'outboxId', v_row.id,
      'kind', v_row.kind,
      'householdId', v_row.household_id,
      'householdName', (select h.name from public.households h where h.id = v_row.household_id),
      'product', v_product,
      'digest', v_digest,
      'recipients', v_recipients));
  end loop;

  return jsonb_build_object('items', v_items);
end;
$$;
