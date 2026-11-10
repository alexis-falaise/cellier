-- Cellier migration 03: global reference data. Category templates (the 28 default categories)
-- and the shared product catalogue seeded from the Open Food Facts family (ODbL).
-- Both are read-only for clients.

-- Default categories. `key` is the stable slug shared with the design system, which maps each
-- slug to an icon and a colour token (docs/design). Labels are French; source: research/06.
create table public.category_templates (
  key        text primary key check (key ~ '^[a-z_]{2,32}$'),
  name       text not null,
  sort_order smallint not null unique
);

insert into public.category_templates (key, name, sort_order) values
  ('legumes',         'Légumes',                         1),
  ('fruits',          'Fruits',                          2),
  ('feculents',       'Pâtes, riz & céréales',           3),
  ('poisson',         'Poisson',                         4),
  ('viande',          'Viande & charcuterie',            5),
  ('laitier',         'Produits laitiers & œufs',        6),
  ('pain',            'Pain & viennoiseries',            7),
  ('apero',           'Apéritifs & snacks salés',        8),
  ('epicerie_sucree', 'Épicerie sucrée',                 9),
  ('chocolat',        'Chocolat & confiserie',          10),
  ('petit_dej',       'Petit-déjeuner & tartinables',   11),
  ('conserves',       'Conserves',                      12),
  ('surgeles',        'Surgelés',                       13),
  ('plats',           'Plats préparés & soupes',        14),
  ('soft',            'Boissons sans alcool',           15),
  ('jus',             'Jus & nectars',                  16),
  ('eau',             'Eaux',                           17),
  ('vin',             'Vins',                           18),
  ('biere',           'Bières, cidres & spiritueux',    19),
  ('cafe',            'Café & thé',                     20),
  ('condiments',      'Condiments, sauces & huiles',    21),
  ('bebe',            'Bébé',                           22),
  ('animaux',         'Animaux',                        23),
  ('entretien',       'Entretien & nettoyage',          24),
  ('hygiene',         'Hygiène & beauté',               25),
  ('papier',          'Papier & jetables',              26),
  ('pharmacie',       'Pharmacie & compléments',        27),
  ('autre',           'Autre',                          28);

-- Shared catalogue, keyed by the 14-digit GTIN (EAN-13, EAN-8, UPC-A and UPC-E normalised).
-- Written only by the seed pipeline and the catalog-lookup Edge Function (service role).
create table public.catalog_products (
  gtin              text primary key check (gtin ~ '^[0-9]{14}$'),
  name              text not null check (char_length(name) between 1 and 200),
  brand             text check (brand is null or char_length(brand) <= 120),
  quantity_label    text check (quantity_label is null or char_length(quantity_label) <= 60),  -- as printed, e.g. '6 x 1 l'
  net_quantity      numeric(12, 3) check (net_quantity is null or net_quantity > 0),          -- per unit, in net_unit
  net_unit          text check (net_unit in ('g', 'ml', 'piece')),
  pack_count        smallint check (pack_count is null or pack_count between 1 and 999),     -- elements per pack
  category_key      text references public.category_templates (key) on update cascade on delete set null,
  category_rule     text check (category_rule is null or char_length(category_rule) <= 120),  -- mapping trace, e.g. 'v1|tier2:en:red-wines'
  category_tags     text[] not null default '{}',   -- Open Food Facts category tags kept to re-apply rule changes
  image_url         text check (image_url is null or char_length(image_url) <= 500),
  source            text not null check (source in ('off', 'obf', 'opf', 'opff', 'manual')),
  store_tags        text[] not null default '{}',   -- e.g. {leclerc,carrefour}; used for ranking only
  popularity        integer not null default 0,     -- Open Food Facts unique_scans_n
  price_cents       integer check (price_cents is null or price_cents between 0 and 10000000),
  price_observed_on date,
  price_chain       text check (price_chain is null or price_chain in ('leclerc', 'carrefour', 'other')),
  search_text       text generated always as (
                      private.normalize_name(coalesce(name, '') || ' ' || coalesce(brand, ''))
                    ) stored,
  source_modified_at timestamptz,                   -- last_modified_t from Open Food Facts
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- Trigram index for name search (manual add, search-as-you-type).
create index catalog_products_search_trgm_idx
  on public.catalog_products using gin (search_text extensions.gin_trgm_ops);
-- Foreign key index.
create index catalog_products_category_key_idx on public.catalog_products (category_key);

create trigger catalog_products_set_updated_at
  before update on public.catalog_products
  for each row execute function private.set_updated_at();

-- Catalogue search for manual add. Matches every word (substring, accent-insensitive) and ranks
-- by trigram similarity, then by popularity. Served by catalog_products_search_trgm_idx.
create or replace function public.search_catalog(p_query text, p_limit integer default 20)
returns setof public.catalog_products
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select private.normalize_name(p_query) as norm
  )
  select c.*
  from public.catalog_products c, q
  where char_length(q.norm) >= 3
    -- at least one word of 3+ characters, so the trigram index can serve the query
    and exists (select 1 from regexp_split_to_table(q.norm, ' ') as w where char_length(w) >= 3)
    and c.search_text like all (array(
      -- escape LIKE wildcards typed by the user
      select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      from regexp_split_to_table(q.norm, ' ') as w where w <> ''
    ))
  order by extensions.similarity(c.search_text, q.norm) desc, c.popularity desc, c.gtin
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.search_catalog(text, integer) from public, anon;
grant execute on function public.search_catalog(text, integer) to authenticated;
