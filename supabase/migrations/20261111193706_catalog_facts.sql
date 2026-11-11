-- Cellier migration 16: product facts cache (grades, nutrition, composition, labels).
--
-- Facts are too large to seed for the whole catalogue (the catalogue table is already at its size
-- budget; ingredients and nutrition would add about 100 MB for 130k rows). They are fetched from the
-- Open Food Facts family on the first view of an item sheet by the `product-facts` Edge Function and
-- kept here, so each product costs one upstream call per refresh period (30 days when found, 7 days
-- when absent) for every household. Rows exist only for products someone has opened.
--
-- Keyed by GTIN, not by catalogue row: a household product scanned before the catalogue knew it has
-- a GTIN but no catalogue link. Read by any signed-in user, written only by the service role.

create table public.catalog_facts (
  gtin                text primary key check (gtin ~ '^[0-9]{14}$'),
  found               boolean not null,                -- false: absent from every Open*Facts database
  source              text check (source in ('off', 'obf', 'opf', 'opff')),
  -- Food only; null when unknown or not applicable.
  nutriscore_grade    text check (nutriscore_grade in ('a', 'b', 'c', 'd', 'e')),
  nova_group          smallint check (nova_group between 1 and 4),
  ecoscore_grade      text check (ecoscore_grade in ('a-plus', 'a', 'b', 'c', 'd', 'e', 'f')),
  -- Per 100 g (or 100 ml): {energy_kcal, fat, saturated_fat, carbohydrates, sugars, fiber, proteins, salt}.
  nutriments          jsonb not null default '{}' check (jsonb_typeof(nutriments) = 'object'),
  -- {fat, saturated_fat, sugars, salt} → 'low' | 'moderate' | 'high'.
  nutrient_levels     jsonb not null default '{}' check (jsonb_typeof(nutrient_levels) = 'object'),
  ingredients_text    text check (ingredients_text is null or char_length(ingredients_text) <= 5000),
  allergens           text[] not null default '{}',    -- taxonomy tags, e.g. {en:milk,en:nuts}
  traces              text[] not null default '{}',
  additives           text[] not null default '{}',    -- display codes, e.g. {E322,E471}
  labels              text[] not null default '{}',    -- taxonomy tags, e.g. {en:organic,fr:label-rouge}
  analysis            text[] not null default '{}',    -- definite ingredients analysis tags only
  origins             text check (origins is null or char_length(origins) <= 160),
  period_after_opening_months smallint check (period_after_opening_months between 1 and 120),
  source_modified_at  timestamptz,
  fetched_at          timestamptz not null default now()
);

alter table public.catalog_facts enable row level security;
revoke all on public.catalog_facts from public, anon, authenticated;
grant select on public.catalog_facts to authenticated;
create policy catalog_facts_select on public.catalog_facts
  for select to authenticated
  using ((select auth.uid()) is not null);
