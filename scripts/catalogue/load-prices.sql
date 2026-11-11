-- Catalogue prices: load scripts/catalogue/out/prices.csv into public.catalog_products
-- (docs/architecture/05-catalogue.md §7.3). Run through scripts/catalogue/load-prices.sh, from the
-- project root, on the session pooler (temporary table and \copy need one session).
-- Touches only the three price columns of public.catalog_products. Idempotent: a second run with the
-- same file updates nothing. Codes absent from the catalogue are ignored. Variable dry_run
-- (true/false) rolls back instead of committing.

\set ON_ERROR_STOP on
\pset footer off
\timing off

select count(*) as catalogue_rows, count(price_cents) as priced_before from public.catalog_products;

begin;
set local statement_timeout = 0;
set local lock_timeout = '10s';

create temporary table price_stage (
  gtin              text primary key,
  price_cents       integer not null check (price_cents between 5 and 50000),
  price_observed_on date not null,
  price_chain       text not null check (price_chain in ('leclerc', 'carrefour', 'other')),
  sample_size       integer not null
) on commit drop;

\copy price_stage (gtin, price_cents, price_observed_on, price_chain, sample_size) from 'scripts/catalogue/out/prices.csv' with (format csv, header true)

select count(*) as staged_rows,
       count(*) filter (where exists (select 1 from public.catalog_products c where c.gtin = s.gtin)) as in_catalogue
from price_stage s;

-- The 10 largest relative changes, for a human eye (before the update).
select c.gtin, left(c.name, 40) as name, c.price_cents as old_cents, s.price_cents as new_cents,
       round(s.price_cents::numeric / c.price_cents, 2) as ratio
from public.catalog_products c
join price_stage s using (gtin)
where c.price_cents > 0 and s.price_cents <> c.price_cents and s.price_observed_on >= c.price_observed_on
order by abs(ln(s.price_cents::numeric / c.price_cents)) desc
limit 10;

-- Never replace a price by an older observation (the Edge Function may have stored a fresher one).
with updated as (
  update public.catalog_products c
  set price_cents = s.price_cents, price_observed_on = s.price_observed_on, price_chain = s.price_chain
  from price_stage s
  where c.gtin = s.gtin
    and (c.price_observed_on is null or s.price_observed_on >= c.price_observed_on)
    and (c.price_cents, c.price_observed_on, c.price_chain)
      is distinct from (s.price_cents, s.price_observed_on, s.price_chain)
  returning 1
)
select count(*) as prices_updated from updated;

-- Prices past the ingest age (PRICE_INGEST_MAX_AGE_DAYS) are removed.
with cleared as (
  update public.catalog_products
  set price_cents = null, price_observed_on = null, price_chain = null
  where price_observed_on < current_date - 548
  returning 1
)
select count(*) as prices_expired from cleared;

\if :dry_run
  \echo 'dry run: rolling back'
  rollback;
\else
  commit;
\endif

select count(*) as catalogue_rows, count(price_cents) as priced_after,
       count(*) filter (where price_observed_on >= current_date - 365) as displayable
from public.catalog_products;

select price_chain, count(*) as rows from public.catalog_products
where price_cents is not null group by price_chain order by 2 desc;
