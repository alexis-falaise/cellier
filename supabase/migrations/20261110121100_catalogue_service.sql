-- Cellier migration 12: objects used by the catalog-lookup Edge Function (service role only).
-- Design: docs/architecture/05-catalogue.md §6.3 and §6.6.
--   * private.catalog_lookup_log  — per-user and global rate limiting
--   * private.catalog_misses      — negative cache for codes absent from every Open*Facts database
--   * public.catalog_lookup_gate  — one atomic decision per lookup
--   * public.catalog_upsert       — conditional upsert (only when the upstream record is newer)
--   * public.catalog_record_miss  — write the negative cache

create table private.catalog_lookup_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  gtin       text not null,
  outcome    text not null check (outcome in ('admit', 'cached_miss', 'rate_limited', 'upstream_budget_exhausted')),
  upstream   boolean not null default false,
  created_at timestamptz not null default now()
);
create index catalog_lookup_log_user_idx on private.catalog_lookup_log (user_id, created_at);
create index catalog_lookup_log_upstream_idx on private.catalog_lookup_log (created_at) where upstream;
create index catalog_lookup_log_created_idx on private.catalog_lookup_log (created_at);

create table private.catalog_misses (
  gtin       text primary key check (gtin ~ '^[0-9]{14}$'),
  checked_at timestamptz not null default now(),
  miss_count integer not null default 1
);

alter table private.catalog_lookup_log enable row level security;
alter table private.catalog_misses enable row level security;
revoke all on private.catalog_lookup_log from public, anon, authenticated;
revoke all on private.catalog_misses from public, anon, authenticated;

-- Limits: 40 lookups per user per 10 minutes, 300 per day; 10 upstream calls per minute overall;
-- 72 h negative cache; soft cap of 200,000 catalogue rows (above it, found products are not stored).
create or replace function private.catalog_lookup_gate_impl(p_user uuid, p_gtin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_oldest timestamptz;
  v_rows   real;
begin
  if (select count(*) from private.catalog_lookup_log l
      where l.user_id = p_user and l.created_at > now() - interval '10 minutes') >= 40 then
    select min(l.created_at) into v_oldest from private.catalog_lookup_log l
     where l.user_id = p_user and l.created_at > now() - interval '10 minutes';
    insert into private.catalog_lookup_log (user_id, gtin, outcome) values (p_user, p_gtin, 'rate_limited');
    return jsonb_build_object('decision', 'rate_limited',
      'retryAfter', greatest(1, ceil(extract(epoch from (v_oldest + interval '10 minutes' - now()))))::integer);
  end if;
  if (select count(*) from private.catalog_lookup_log l
      where l.user_id = p_user and l.created_at > now() - interval '1 day') >= 300 then
    insert into private.catalog_lookup_log (user_id, gtin, outcome) values (p_user, p_gtin, 'rate_limited');
    return jsonb_build_object('decision', 'rate_limited', 'retryAfter', 3600);
  end if;

  if exists (select 1 from private.catalog_misses m
             where m.gtin = p_gtin and m.checked_at > now() - interval '72 hours') then
    insert into private.catalog_lookup_log (user_id, gtin, outcome) values (p_user, p_gtin, 'cached_miss');
    return jsonb_build_object('decision', 'cached_miss');
  end if;

  -- Global upstream budget, serialised so two concurrent lookups cannot both take the last slot.
  perform pg_advisory_xact_lock(hashtext('cellier:catalog-upstream'));
  if (select count(*) from private.catalog_lookup_log l
      where l.upstream and l.created_at > now() - interval '1 minute') >= 10 then
    insert into private.catalog_lookup_log (user_id, gtin, outcome)
    values (p_user, p_gtin, 'upstream_budget_exhausted');
    return jsonb_build_object('decision', 'upstream_budget_exhausted', 'retryAfter', 60);
  end if;

  insert into private.catalog_lookup_log (user_id, gtin, outcome, upstream) values (p_user, p_gtin, 'admit', true);
  select c.reltuples into v_rows from pg_catalog.pg_class c where c.oid = 'public.catalog_products'::regclass;
  return jsonb_build_object('decision', 'admit', 'catalogueFull', coalesce(v_rows, 0) > 200000);
end;
$$;

-- p_row: snake_case keys matching public.catalog_products columns (search_text, created_at and
-- updated_at are ignored). Returns the stored row, or null when the existing row is as new or newer.
create or replace function private.catalog_upsert_impl(p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     public.catalog_products := jsonb_populate_record(null::public.catalog_products, p_row);
  v_out public.catalog_products;
begin
  insert into public.catalog_products as c (gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count,
    category_key, category_rule, category_tags, image_url, source, store_tags, popularity, price_cents,
    price_observed_on, price_chain, source_modified_at)
  values (r.gtin, r.name, r.brand, r.quantity_label, r.net_quantity, r.net_unit, r.pack_count,
    r.category_key, r.category_rule, coalesce(r.category_tags, '{}'), r.image_url, r.source,
    coalesce(r.store_tags, '{}'), coalesce(r.popularity, 0), r.price_cents, r.price_observed_on,
    r.price_chain, r.source_modified_at)
  on conflict (gtin) do update set
    name = excluded.name, brand = excluded.brand, quantity_label = excluded.quantity_label,
    net_quantity = excluded.net_quantity, net_unit = excluded.net_unit, pack_count = excluded.pack_count,
    category_key = excluded.category_key, category_rule = excluded.category_rule,
    category_tags = excluded.category_tags, image_url = excluded.image_url, source = excluded.source,
    store_tags = excluded.store_tags, popularity = excluded.popularity,
    source_modified_at = excluded.source_modified_at,
    price_cents = coalesce(excluded.price_cents, c.price_cents),
    price_observed_on = coalesce(excluded.price_observed_on, c.price_observed_on),
    price_chain = coalesce(excluded.price_chain, c.price_chain)
  where c.source_modified_at is null or excluded.source_modified_at > c.source_modified_at
  returning c.* into v_out;

  delete from private.catalog_misses m where m.gtin = r.gtin;
  return case when v_out.gtin is null then null else to_jsonb(v_out) end;
end;
$$;

create or replace function private.catalog_record_miss_impl(p_gtin text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.catalog_misses as m (gtin) values (p_gtin)
  on conflict (gtin) do update set checked_at = now(), miss_count = m.miss_count + 1;
$$;

create or replace function private.catalog_prune()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.catalog_lookup_log l where l.created_at < now() - interval '2 days';
  delete from private.catalog_misses m where m.checked_at < now() - interval '30 days';
$$;

create or replace function public.catalog_lookup_gate(p_user uuid, p_gtin text)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.catalog_lookup_gate_impl(p_user, p_gtin);
$$;
create or replace function public.catalog_upsert(p_row jsonb)
returns jsonb language sql volatile security invoker set search_path = '' as $$
  select private.catalog_upsert_impl(p_row);
$$;
create or replace function public.catalog_record_miss(p_gtin text)
returns void language sql volatile security invoker set search_path = '' as $$
  select private.catalog_record_miss_impl(p_gtin);
$$;

revoke all on function private.catalog_lookup_gate_impl(uuid, text) from public, anon, authenticated;
revoke all on function private.catalog_upsert_impl(jsonb) from public, anon, authenticated;
revoke all on function private.catalog_record_miss_impl(text) from public, anon, authenticated;
revoke all on function private.catalog_prune() from public, anon, authenticated;
grant execute on function private.catalog_lookup_gate_impl(uuid, text) to service_role;
grant execute on function private.catalog_upsert_impl(jsonb) to service_role;
grant execute on function private.catalog_record_miss_impl(text) to service_role;

revoke all on function public.catalog_lookup_gate(uuid, text) from public, anon, authenticated;
revoke all on function public.catalog_upsert(jsonb) from public, anon, authenticated;
revoke all on function public.catalog_record_miss(text) from public, anon, authenticated;
grant execute on function public.catalog_lookup_gate(uuid, text) to service_role;
grant execute on function public.catalog_upsert(jsonb) to service_role;
grant execute on function public.catalog_record_miss(text) to service_role;

select cron.schedule('cellier-catalog-prune', '41 3 * * *', $$ select private.catalog_prune(); $$);
