-- Cellier migration 11: running-low evaluation, the notification outbox pipeline, maintenance,
-- and the pg_cron jobs. Pipeline (docs/architecture/04-notifications-forecasting.md):
--   stock change -> private.evaluate_low_stock -> private.notification_outbox (20 s debounce)
--   cron 'cellier-notify' (every minute) -> private.kick_notification_sender -> pg_net POST
--   -> Edge Function send-push -> public.notification_claim / public.notification_complete
--
-- Vault secrets created once by hand, never in a migration:
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'cellier_functions_url');
--   select vault.create_secret('<random 32-byte hex>', 'cellier_internal_secret');

-- ---------------------------------------------------------------------------------------------
-- Running-low state (household total of a product, hysteresis, one outbox row per transition)
-- ---------------------------------------------------------------------------------------------
-- p_notify: only a decrease of the household total may notify. Other callers (product settings,
-- pantry deletion, an increase) update the state silently, so buying one unit never sends a push.
create or replace function private.evaluate_low_stock(p_household uuid, p_product uuid, p_notify boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product record;
  v_total   integer;
  v_usual   integer;
  v_min     integer;
  v_clear   integer;
  v_was     boolean;
  v_low     boolean;
begin
  select p.deleted_at, p.min_quantity, p.usual_quantity, p.low_alert into v_product
  from public.products p where p.household_id = p_household and p.id = p_product;
  if not found then return; end if;

  select coalesce(sum(s.quantity), 0)::integer into v_total
  from public.stock s
  join public.pantries pa on pa.household_id = s.household_id and pa.id = s.pantry_id and pa.deleted_at is null
  where s.household_id = p_household and s.product_id = p_product;

  -- Usual purchase size: the member's override on the product, else the published forecast.
  v_usual := v_product.usual_quantity;
  if v_usual is null then
    select f.usual_quantity into v_usual
    from public.product_forecasts f where f.household_id = p_household and f.product_id = p_product;
  end if;

  v_min   := coalesce(v_product.min_quantity, greatest(1, ceil(0.25 * v_usual)::integer), 1);
  v_clear := greatest(v_min + 1, ceil(0.5 * coalesce(v_usual, 0))::integer);

  select l.is_low into v_was from private.low_stock_state l
  where l.household_id = p_household and l.product_id = p_product;
  v_was := coalesce(v_was, false);

  v_low := case
    when v_product.deleted_at is not null or not v_product.low_alert then false
    when v_was then v_total < v_clear
    else v_total <= v_min
  end;

  insert into private.low_stock_state as l (household_id, product_id, is_low, total_quantity, changed_at)
  values (p_household, p_product, v_low, v_total, now())
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

create or replace function private.stock_low_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The zero row created just before a first movement is not a real change.
  if tg_op = 'INSERT' and new.quantity = 0 then return null; end if;
  perform private.evaluate_low_stock(new.household_id, new.product_id,
                                     tg_op = 'UPDATE' and new.quantity < old.quantity);
  return null;
end;
$$;

create or replace function private.product_low_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.evaluate_low_stock(new.household_id, new.id);
  return null;
end;
$$;

create or replace function private.pantry_low_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product uuid;
begin
  for v_product in
    select s.product_id from public.stock s where s.household_id = new.household_id and s.pantry_id = new.id
  loop
    perform private.evaluate_low_stock(new.household_id, v_product);
  end loop;
  return null;
end;
$$;

create trigger stock_running_low after insert or update of quantity on public.stock
  for each row execute function private.stock_low_trigger();
create trigger products_running_low after update of min_quantity, usual_quantity, low_alert, deleted_at on public.products
  for each row execute function private.product_low_trigger();
create trigger pantries_running_low after update of deleted_at on public.pantries
  for each row when (old.deleted_at is distinct from new.deleted_at)
  execute function private.pantry_low_trigger();

-- ---------------------------------------------------------------------------------------------
-- Sender kick (pg_cron, every minute)
-- ---------------------------------------------------------------------------------------------
create or replace function private.kick_notification_sender()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  -- pg_net never retries: rows stuck in 'sending' go back to 'pending' (or 'failed' after 5 tries).
  update private.notification_outbox
     set status = case when attempts >= 5 then 'failed' else 'pending' end,
         last_error = coalesce(last_error, 'claim timed out')
   where status = 'sending' and claimed_at < now() - interval '5 minutes';

  if not exists (select 1 from private.notification_outbox o
                 where o.status = 'pending' and o.not_before <= now()) then
    return;
  end if;

  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'cellier_functions_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'cellier_internal_secret';
  if v_url is null or v_secret is null then
    raise warning 'cellier: vault secrets cellier_functions_url / cellier_internal_secret are missing';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/send-push',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cellier-secret', v_secret),
    timeout_milliseconds := 5000
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Daily digest (pg_cron hourly; acts only when it is 18:xx in Europe/Paris — DST-proof)
-- ---------------------------------------------------------------------------------------------
create or replace function private.enqueue_daily_digests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_n     integer;
begin
  if extract(hour from (now() at time zone 'Europe/Paris')) <> 18 then
    return 0;
  end if;

  -- Forecasts older than 7 days are ignored (no member opened the app to recompute them).
  insert into private.notification_outbox (household_id, kind, dedupe_key, not_before)
  select h.id, 'digest', 'digest:' || h.id::text || ':' || v_today::text, now()
  from public.households h
  where exists (select 1 from private.low_stock_state l where l.household_id = h.id and l.is_low)
     or exists (select 1 from public.product_forecasts f
                join public.products p on p.household_id = f.household_id and p.id = f.product_id
                                      and p.deleted_at is null and p.low_alert
                where f.household_id = h.id and f.run_out_at < now() + interval '3 days'
                  and f.computed_at > now() - interval '7 days')
     or exists (select 1 from public.household_forecasts hf
                where hf.household_id = h.id and hf.next_trip_on <= v_today + 1
                  and hf.computed_at > now() - interval '7 days')
  on conflict (dedupe_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Service-role RPCs for the send-push Edge Function
-- ---------------------------------------------------------------------------------------------
create or replace function private.recipients_for(p_household uuid, p_kind text, p_exclude uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('userId', m.user_id, 'subscriptions', subs.list)), '[]'::jsonb)
  from public.household_members m
  cross join lateral (
    select jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)) as list
    from public.push_subscriptions ps
    where ps.user_id = m.user_id
      -- per-device preference (design 03 §5)
      and case p_kind when 'running_low' then ps.notify_running_low else ps.notify_digest end
  ) subs
  where m.household_id = p_household
    and subs.list is not null
    and (p_exclude is null or m.user_id <> p_exclude)
    and case p_kind when 'running_low' then m.notify_running_low else m.notify_digest end;
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
      select jsonb_build_object('id', p.id, 'name', p.name, 'totalQuantity', l.total_quantity,
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
        'lowProducts', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'totalQuantity', l.total_quantity)
                           order by p.name)
          from private.low_stock_state l
          join public.products p on p.household_id = l.household_id and p.id = l.product_id and p.deleted_at is null
          where l.household_id = v_row.household_id and l.is_low), '[]'::jsonb),
        'runningOutSoon', coalesce((
          select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'runOutAt', f.run_out_at)
                           order by f.run_out_at)
          from public.product_forecasts f
          join public.products p on p.household_id = f.household_id and p.id = f.product_id
                                and p.deleted_at is null and p.low_alert
          where f.household_id = v_row.household_id and f.run_out_at < now() + interval '3 days'
            and f.computed_at > now() - interval '7 days'
            and not exists (select 1 from private.low_stock_state l
                            where l.household_id = f.household_id and l.product_id = f.product_id and l.is_low)),
          '[]'::jsonb),
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

create or replace function private.notification_complete_impl(p_report jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- 'retry': a transient sender fault (push service 429/5xx); back to pending in one minute,
  -- or 'failed' once the row has been claimed 5 times.
  update private.notification_outbox o
     set status = case when o.attempts >= 5 then 'failed' else 'pending' end,
         not_before = now() + interval '1 minute',
         last_error = r.error
    from jsonb_to_recordset(coalesce(p_report -> 'outbox', '[]'::jsonb))
         as r("outboxId" bigint, status text, error text)
   where o.id = r."outboxId" and r.status = 'retry' and o.status = 'sending';

  update private.notification_outbox o
     set status = r.status,
         sent_at = case when r.status = 'sent' then now() else o.sent_at end,
         last_error = r.error
    from jsonb_to_recordset(coalesce(p_report -> 'outbox', '[]'::jsonb))
         as r("outboxId" bigint, status text, error text)
   where o.id = r."outboxId" and r.status in ('sent', 'skipped', 'failed') and o.status = 'sending';

  delete from public.push_subscriptions ps
   using jsonb_to_recordset(coalesce(p_report -> 'subscriptions', '[]'::jsonb)) as r(id uuid, result text)
   where ps.id = r.id and r.result = 'gone';

  update public.push_subscriptions ps
     set last_success_at = now(), failure_count = 0
    from jsonb_to_recordset(coalesce(p_report -> 'subscriptions', '[]'::jsonb)) as r(id uuid, result text)
   where ps.id = r.id and r.result = 'ok';

  update public.push_subscriptions ps
     set failure_count = ps.failure_count + 1
    from jsonb_to_recordset(coalesce(p_report -> 'subscriptions', '[]'::jsonb)) as r(id uuid, result text)
   where ps.id = r.id and r.result = 'error';

  delete from public.push_subscriptions ps where ps.failure_count >= 10;
end;
$$;

create or replace function public.notification_claim(p_limit integer default 50)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.notification_claim_impl(p_limit);
$$;

create or replace function public.notification_complete(p_report jsonb)
returns void language sql volatile security invoker set search_path = '' as $$
  select private.notification_complete_impl(p_report);
$$;

-- ---------------------------------------------------------------------------------------------
-- Push subscription registration (client). An endpoint belongs to one browser install; when a
-- different account signs in on that device, the row moves to the new account. RLS alone cannot
-- do this because the old row is invisible to the new user.
-- ---------------------------------------------------------------------------------------------
create or replace function private.register_push_subscription_impl(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.push_subscriptions as ps (user_id, endpoint, p256dh, auth, user_agent, last_seen_at)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300), now())
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now(),
        failure_count = case when ps.user_id = excluded.user_id then ps.failure_count else 0 end,
        notify_running_low = case when ps.user_id = excluded.user_id then ps.notify_running_low else true end,
        notify_digest = case when ps.user_id = excluded.user_id then ps.notify_digest else true end
  returning ps.id into v_id;
  return v_id;
end;
$$;

create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns uuid language sql volatile security invoker set search_path = '' as $$
  select private.register_push_subscription_impl(p_endpoint, p_p256dh, p_auth, p_user_agent);
$$;

-- ---------------------------------------------------------------------------------------------
-- Maintenance (pg_cron daily)
-- ---------------------------------------------------------------------------------------------
create or replace function private.prune()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Change log: 30 days. Clients with an older cursor get resync_required and take a snapshot.
  with deleted as (
    delete from private.change_log c where c.changed_at < now() - interval '30 days'
    returning c.household_id, c.sync_id
  ), maxima as (
    select d.household_id, max(d.sync_id) as max_sync_id from deleted d group by d.household_id
  )
  update private.household_sync s
     set pruned_through = greatest(s.pruned_through, m.max_sync_id)
    from maxima m where s.household_id = m.household_id;

  -- Idempotency results: 60 days, longer than any supported offline period.
  delete from private.applied_mutations a where a.created_at < now() - interval '60 days';
  -- Finished notifications: 14 days.
  delete from private.notification_outbox o
   where o.created_at < now() - interval '14 days' and o.status in ('sent', 'skipped', 'failed');
  -- Subscriptions of devices not opened for 120 days.
  delete from public.push_subscriptions ps where ps.last_seen_at < now() - interval '120 days';
  -- Overwrite records: 30 days, like the change log (clients drop older ones locally).
  delete from public.field_overwrites o where o.created_at < now() - interval '30 days';
  -- Invite attempts: 1 day. Invites: 30 days after expiry.
  delete from private.invite_attempts a where a.created_at < now() - interval '1 day';
  delete from public.household_invites i where i.expires_at < now() - interval '30 days';
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function private.evaluate_low_stock(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.stock_low_trigger() from public, anon, authenticated;
revoke all on function private.product_low_trigger() from public, anon, authenticated;
revoke all on function private.pantry_low_trigger() from public, anon, authenticated;
revoke all on function private.kick_notification_sender() from public, anon, authenticated;
revoke all on function private.enqueue_daily_digests() from public, anon, authenticated;
revoke all on function private.recipients_for(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.notification_claim_impl(integer) from public, anon, authenticated;
revoke all on function private.notification_complete_impl(jsonb) from public, anon, authenticated;
revoke all on function private.prune() from public, anon, authenticated;
revoke all on function private.register_push_subscription_impl(text, text, text, text) from public, anon;
grant execute on function private.register_push_subscription_impl(text, text, text, text) to authenticated;
revoke all on function public.register_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;
grant execute on function private.notification_claim_impl(integer) to service_role;
grant execute on function private.notification_complete_impl(jsonb) to service_role;

revoke all on function public.notification_claim(integer) from public, anon, authenticated;
revoke all on function public.notification_complete(jsonb) from public, anon, authenticated;
grant execute on function public.notification_claim(integer) to service_role;
grant execute on function public.notification_complete(jsonb) to service_role;

-- ---------------------------------------------------------------------------------------------
-- pg_cron jobs (UTC). cron.schedule with an existing name replaces that job.
-- ---------------------------------------------------------------------------------------------
select cron.schedule('cellier-notify', '* * * * *', $$ select private.kick_notification_sender(); $$);
select cron.schedule('cellier-digest', '0 * * * *', $$ select private.enqueue_daily_digests(); $$);
select cron.schedule('cellier-prune',  '17 3 * * *', $$ select private.prune(); $$);
