-- Catalogue seed, step 4: load scripts/catalogue/out/seed.csv into public.catalog_products
-- (docs/architecture/05-catalogue.md §10.2 step 7). Run through scripts/catalogue/load.sh, from the
-- project root, on the session pooler (temporary table and \copy need one session).
-- Touches only public.catalog_products and a temporary staging table. Idempotent: a second run with the
-- same file inserts and updates nothing. Variable dry_run (true/false) rolls back instead of committing.

\set ON_ERROR_STOP on
\pset footer off
\timing off

-- Pre-check (05 §10.2 step 6): database size before the load.
select pg_size_pretty(pg_database_size(current_database())) as database_size_before,
       pg_size_pretty(pg_total_relation_size('public.catalog_products')) as catalogue_size_before,
       (select count(*) from public.catalog_products) as catalogue_rows_before;

begin;
set local statement_timeout = 0;
set local lock_timeout = '10s';
set local maintenance_work_mem = '128MB';

-- First load into an empty table: build the trigram index once at the end instead of row by row (05 §10.2).
select count(*) = 0 as first_load from public.catalog_products \gset
\if :first_load
  \echo 'first load: dropping catalog_products_search_trgm_idx, recreated after the insert'
  drop index if exists public.catalog_products_search_trgm_idx;
\endif

create temporary table catalog_stage (
  gtin               text primary key,
  name               text not null,
  brand              text,
  quantity_label     text,
  net_quantity       numeric(12, 3),
  net_unit           text,
  pack_count         smallint,
  category_key       text,
  category_rule      text,
  category_tags      text[] not null,
  image_url          text,
  source             text not null,
  store_tags         text[] not null,
  popularity         integer not null,
  price_cents        integer,
  price_observed_on  date,
  price_chain        text,
  source_modified_at timestamptz
) on commit drop;

\copy catalog_stage (gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count, category_key, category_rule, category_tags, image_url, source, store_tags, popularity, price_cents, price_observed_on, price_chain, source_modified_at) from 'scripts/catalogue/out/seed.csv' with (format csv, header true, null '')

select count(*) as staged_rows from catalog_stage;

-- Content columns only when the source record is newer; rows created by hand ('manual') are never
-- overwritten. Prices are not touched here (loaded separately, 05 §7.3).
with upserted as (
  insert into public.catalog_products as c (gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count,
    category_key, category_rule, category_tags, image_url, source, store_tags, popularity, source_modified_at)
  select gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count, category_key, category_rule,
    category_tags, image_url, source, store_tags, popularity, source_modified_at
  from catalog_stage
  on conflict (gtin) do update set
    name = excluded.name, brand = excluded.brand, quantity_label = excluded.quantity_label,
    net_quantity = excluded.net_quantity, net_unit = excluded.net_unit, pack_count = excluded.pack_count,
    category_key = excluded.category_key, category_rule = excluded.category_rule,
    category_tags = excluded.category_tags, image_url = excluded.image_url, source = excluded.source,
    store_tags = excluded.store_tags, popularity = excluded.popularity,
    source_modified_at = excluded.source_modified_at
  where c.source <> 'manual'
    and (c.source_modified_at is null or excluded.source_modified_at > c.source_modified_at)
  returning (xmax = 0) as inserted
)
select count(*) filter (where inserted) as inserted,
       count(*) filter (where not inserted) as updated,
       (select count(*) from catalog_stage) - count(*) as unchanged_or_skipped
from upserted;

-- Ranking signals derived by Cellier (not source content): refreshed even when the record did not change.
with refreshed as (
  update public.catalog_products c
  set popularity = s.popularity, store_tags = s.store_tags
  from catalog_stage s
  where c.gtin = s.gtin and c.source <> 'manual'
    and (c.popularity, c.store_tags) is distinct from (s.popularity, s.store_tags)
  returning 1
)
select count(*) as ranking_refreshed from refreshed;

\if :first_load
  create index catalog_products_search_trgm_idx
    on public.catalog_products using gin (search_text extensions.gin_trgm_ops);
\endif

\if :dry_run
  \echo 'dry run: rolling back'
  rollback;
\else
  commit;
  analyze public.catalog_products;
\endif

-- Post-checks (05 §10.2 step 10).
select count(*) as catalogue_rows,
       count(*) filter (where category_key = 'autre') as autre_rows,
       count(*) filter (where category_key is null) as null_category_rows,
       pg_size_pretty(pg_total_relation_size('public.catalog_products')) as catalogue_total_size,
       pg_total_relation_size('public.catalog_products') / greatest(count(*), 1) as bytes_per_row,
       pg_size_pretty(pg_database_size(current_database())) as database_size_after
from public.catalog_products;

select source, count(*) as rows from public.catalog_products group by source order by 2 desc;

select category_key, count(*) as rows from public.catalog_products group by category_key order by 2 desc;

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'catalog_products' order by 1;

select gtin, name, brand, category_key from public.search_catalog('nutella', 5);
