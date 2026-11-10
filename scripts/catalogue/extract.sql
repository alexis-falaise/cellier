-- Catalogue seed, step 1: candidate extract (docs/architecture/05-catalogue.md §10.2 step 3).
-- Run from the project root through scripts/catalogue/extract.sh (DuckDB 1.3 or later: lambda syntax).
-- Reads the Open Food Facts family Parquet files remotely from Hugging Face with column projection
-- (only the columns named below are fetched, never the whole 8 GB food file), plus the Open Products
-- Facts JSONL dump downloaded by extract.sh. Filters: sold in France, not obsolete, 8 to 14 digit
-- code, a name in some language. Check digit, normalisation, category and scoring are done in
-- build-seed.ts with the same code as the catalog-lookup Edge Function.
-- Output: scripts/catalogue/out/candidates.jsonl and scripts/catalogue/out/extract-report.json.

SET enable_progress_bar = false;
SET http_retries = 5;
-- The signed CDN addresses contain '*' characters, which DuckDB would otherwise read as a glob.
SET allow_asterisks_in_http_paths = true;

-- Retailer signals (05 §4.4), used only for the pre-selection; build-seed.ts recomputes them.
CREATE MACRO retailer_signal(stores, brands) AS
  len(list_filter(coalesce(stores, []::VARCHAR[]), lambda s: s LIKE '%leclerc%' OR s LIKE '%carrefour%')) > 0
  OR len(list_filter(coalesce(brands, []::VARCHAR[]), lambda b:
       regexp_replace(b, '^[a-z]{2}:', '') IN ('marque-repere', 'nos-regions-ont-du-talent', 'eco-plus', 'bio-village',
                                              'reflets-de-france', 'simpl')
       OR regexp_replace(b, '^[a-z]{2}:', '') LIKE 'carrefour%')) > 0;

-- First non-empty text of a {lang, text} list for one language ('' = any language).
CREATE MACRO lang_text(l, want) AS
  list_filter(coalesce(l, []), lambda x: nullif(trim(x.text), '') IS NOT NULL
                                         AND (want = '' OR x.lang = want))[1].text;

-- Food, beauty and pet food Parquet in one remote scan; union_by_name fills food_groups_tags with
-- NULL for the two files that lack it. extract.sh sets the variables food_url, beauty_url and
-- petfood_url to the files' direct download (CDN) addresses: every column-chunk range request through
-- hf:// also goes through the Hugging Face resolver, whose anonymous limit (3,000 requests per
-- 5 minutes) a projected scan of the 4,790 row groups exceeds many times over.
CREATE TEMP TABLE parquet_rows AS
SELECT
  CASE filename
    WHEN coalesce(getvariable('food_url'), 'hf://datasets/openfoodfacts/product-database/food.parquet') THEN 'off'
    WHEN coalesce(getvariable('beauty_url'), 'hf://datasets/openfoodfacts/product-database/beauty.parquet') THEN 'obf'
    ELSE 'opff'
  END AS source,
  code,
  lang_text(product_name, 'fr') AS name_fr,
  lang_text(product_name, coalesce(lang, '?')) AS name_lang,
  lang_text(product_name, '') AS name_any,
  lang_text(generic_name, 'fr') AS generic_fr,
  lang_text(generic_name, '') AS generic_any,
  lang,
  brands,
  brands_tags,
  stores_tags,
  categories_tags,
  food_groups_tags,
  quantity,
  product_quantity::VARCHAR AS product_quantity,
  product_quantity_unit,
  coalesce(
    list_filter(images, lambda i: i.key = 'front_fr')[1],
    list_filter(images, lambda i: i.key = 'front_' || coalesce(lang, '?'))[1],
    list_filter(images, lambda i: i.key LIKE 'front\_%' ESCAPE '\')[1]
  ) AS front,
  coalesce(unique_scans_n, 0) AS unique_scans_n,
  coalesce(popularity_key, 0) AS popularity_key,
  last_modified_t
FROM read_parquet([
    coalesce(getvariable('food_url'), 'hf://datasets/openfoodfacts/product-database/food.parquet'),
    coalesce(getvariable('beauty_url'), 'hf://datasets/openfoodfacts/product-database/beauty.parquet'),
    coalesce(getvariable('petfood_url'), 'hf://datasets/openfoodfacts/product-database/petfood.parquet')
  ], union_by_name = true, filename = true)
WHERE list_contains(countries_tags, 'en:france')
  AND coalesce(obsolete, false) = false
  AND regexp_full_match(code, '[0-9]{8,14}');

-- Open Products Facts (household, paper, cleaning): JSONL dump, flat names, images as an object.
CREATE TEMP TABLE opf_raw AS
SELECT *
FROM read_json('scripts/catalogue/out/sources/openproductsfacts-products.jsonl.gz',
  format = 'newline_delimited', ignore_errors = true, maximum_object_size = 67108864,
  columns = {
    code: 'VARCHAR', lang: 'VARCHAR', product_name: 'VARCHAR', product_name_fr: 'VARCHAR',
    generic_name: 'VARCHAR', generic_name_fr: 'VARCHAR', brands: 'VARCHAR', brands_tags: 'VARCHAR[]',
    stores_tags: 'VARCHAR[]', categories_tags: 'VARCHAR[]', countries_tags: 'VARCHAR[]',
    quantity: 'VARCHAR', product_quantity: 'VARCHAR', product_quantity_unit: 'VARCHAR',
    images: 'JSON', unique_scans_n: 'BIGINT', popularity_key: 'BIGINT', last_modified_t: 'BIGINT',
    obsolete: 'VARCHAR'
  });

CREATE TEMP TABLE opf_rows AS
WITH base AS (
  SELECT *,
    list_filter(coalesce(json_keys(images), []::VARCHAR[]), lambda k: k LIKE 'front\_%' ESCAPE '\') AS front_keys
  FROM opf_raw
  WHERE list_contains(countries_tags, 'en:france')
    AND coalesce(lower(obsolete), '') NOT IN ('on', 'true', '1')
    AND regexp_full_match(code, '[0-9]{8,14}')
), keyed AS (
  SELECT *,
    CASE
      WHEN list_contains(front_keys, 'front_fr') THEN 'front_fr'
      WHEN list_contains(front_keys, 'front_' || coalesce(lang, '?')) THEN 'front_' || lang
      ELSE front_keys[1]
    END AS front_key
  FROM base
)
SELECT
  'opf' AS source,
  code,
  nullif(trim(product_name_fr), '') AS name_fr,
  NULL::VARCHAR AS name_lang,
  nullif(trim(product_name), '') AS name_any,
  nullif(trim(generic_name_fr), '') AS generic_fr,
  nullif(trim(generic_name), '') AS generic_any,
  lang,
  brands,
  brands_tags,
  stores_tags,
  categories_tags,
  NULL::VARCHAR[] AS food_groups_tags,
  quantity,
  product_quantity,
  product_quantity_unit,
  CASE WHEN front_key IS NULL THEN NULL ELSE {
    'key': front_key,
    'rev': TRY_CAST(json_extract_string(images, '$."' || front_key || '".rev') AS INTEGER)
  } END AS front,
  coalesce(unique_scans_n, 0) AS unique_scans_n,
  coalesce(popularity_key, 0) AS popularity_key,
  last_modified_t
FROM keyed;

CREATE TEMP TABLE all_rows AS
SELECT source, code, name_fr, name_lang, name_any, generic_fr, generic_any, lang, brands, brands_tags,
       stores_tags, categories_tags, food_groups_tags, quantity, product_quantity, product_quantity_unit,
       front.key AS front_key, front.rev AS front_rev, unique_scans_n, popularity_key, last_modified_t
FROM parquet_rows
UNION ALL
SELECT source, code, name_fr, name_lang, name_any, generic_fr, generic_any, lang, brands, brands_tags,
       stores_tags, categories_tags, food_groups_tags, quantity, product_quantity, product_quantity_unit,
       front.key, front.rev, unique_scans_n, popularity_key, last_modified_t
FROM opf_rows;

-- Pre-selection (05 §10.2): every named row with a retailer signal, every non-food row, and the
-- 300,000 most popular named food rows.
CREATE TEMP TABLE candidates AS
WITH named AS (
  SELECT * FROM all_rows
  WHERE coalesce(name_fr, name_lang, name_any, generic_fr, generic_any) IS NOT NULL
), ranked AS (
  SELECT *,
    retailer_signal(stores_tags, brands_tags) AS has_retailer,
    row_number() OVER (PARTITION BY source = 'off' ORDER BY popularity_key DESC, unique_scans_n DESC, code) AS rank_in_group
  FROM named
)
SELECT * EXCLUDE (rank_in_group)
FROM ranked
WHERE source <> 'off' OR has_retailer OR rank_in_group <= 300000;

COPY (SELECT * FROM candidates ORDER BY source, code)
TO 'scripts/catalogue/out/candidates.jsonl' (FORMAT json);

COPY (
  SELECT
    (SELECT count(*) FROM all_rows) AS france_rows,
    (SELECT count(*) FROM candidates) AS candidate_rows,
    (SELECT map(list(source), list(n)) FROM (SELECT source, count(*) AS n FROM all_rows GROUP BY source)) AS france_by_source,
    (SELECT map(list(source), list(n)) FROM (SELECT source, count(*) AS n FROM candidates GROUP BY source)) AS candidates_by_source,
    (SELECT count(*) FROM candidates WHERE has_retailer) AS candidates_with_retailer_signal,
    now()::VARCHAR AS extracted_at
) TO 'scripts/catalogue/out/extract-report.json' (FORMAT json);
