# 05 - Open Food Facts bulk data and seeding a slim French catalogue

Date of research: 2026-11-10. Goal: pre-load a reference catalogue of French supermarket products (E.Leclerc, Carrefour, Marque Repère, long-conservation groceries and household products) into Supabase Postgres (free plan), with the live Open Food Facts (OFF) API as fallback.

Legend: **VERIFIED** = read from the cited page during this research. **UNVERIFIED** = from a search snippet, a third-party page, my own estimate, or a page that could not be fetched (503 / bot block).

Research limits: `world.openfoodfacts.org/stores/leclerc`, `world.openfoodfacts.org/country/france`, the OFF wiki (`wiki.openfoodfacts.org/*`, bot-blocked by Anubis) and the DuckDB Hugging Face page (redirect) could not be read. Items that depended on them are marked UNVERIFIED.

---

## 1. Bulk exports available

### 1.1 Food database (world.openfoodfacts.org)

Source: https://world.openfoodfacts.org/data (VERIFIED via fetch of the page)

| Export | URL | Size | Update frequency | Schema notes |
|---|---|---|---|---|
| MongoDB dump (all products) | https://static.openfoodfacts.org/data/openfoodfacts-mongodbdump.gz | not stated on page (UNVERIFIED) | "Database dumps and exports are generated nightly." | Field definitions in https://static.openfoodfacts.org/data/data-fields.txt. Checksums: https://static.openfoodfacts.org/data/gz-sha256sum , https://static.openfoodfacts.org/data/gz-md5sum |
| JSONL dump (all products) | https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz | not stated (UNVERIFIED) | nightly | One JSON object per line; same data as the MongoDB dump. Page recommends DuckDB. |
| CSV dump, food (tab-separated, UTF-8) | https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz | ~0.9 GB compressed, ~9 GB uncompressed (VERIFIED on page) | nightly (page lists under nightly exports) | Tab separator. Fields in data-fields.txt. |
| Delta files (daily) | index: https://static.openfoodfacts.org/data/delta/index.txt ; files: https://static.openfoodfacts.org/data/delta/{filename} | not stated | daily; **previous 14 days only** | Filenames contain UNIX timestamps of first/last change. Import with `mongoimport` in alphabetical order after extraction. **Delta files cannot signal deleted products**; deletions need a full MongoDB dump. |
| Parquet (Hugging Face) | https://huggingface.co/datasets/openfoodfacts/product-database | see 1.3 | Not stated on the page; README says the source JSONL is "provided ... on a daily basis" (VERIFIED) | Simplified version of the JSONL dump, converted with PyArrow; `Debug` and `lc` tags removed (VERIFIED from README). |
| RDF dump | https://world.openfoodfacts.org/data/en.openfoodfacts.org.products.rdf.gz | not stated | not maintained | Page calls it "an experiment, not actively maintained anymore." **Do not use.** |

Images are not part of these dumps. Image download instructions: https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/ (VERIFIED).

### 1.2 Sister databases (same export pattern, per the data page, VERIFIED)

| Database | CSV dump URL | Notes |
|---|---|---|
| Open Beauty Facts | https://static.openbeautyfacts.org/data/en.openbeautyfacts.org.products.csv.gz | Cosmetics. Hugging Face `beauty.parquet` (67.6 MB) |
| Open Pet Food Facts | https://static.openpetfoodfacts.org/data/en.openpetfoodfacts.org.products.csv.gz | Hugging Face `petfood.parquet` (8.31 MB). Not relevant for Cellier. |
| Open Products Facts | https://static.openproductsfacts.org/data/en.openproductsfacts.org.products.csv.gz | Household and non-food products. **This is the relevant source for household items (detergents, cleaners, etc.).** No Parquet file exists on the HF dataset card; use the CSV or the JSONL dump of that site (UNVERIFIED that a JSONL dump exists for Open Products Facts; check `https://world.openproductsfacts.org/data`). |

Open Beauty Facts and Open Pet Food Facts also publish JSONL/MongoDB dumps on their `/data` pages (UNVERIFIED for exact URLs; pattern assumed to match the food site).

### 1.3 Hugging Face `openfoodfacts/product-database` (VERIFIED)

Source: https://huggingface.co/datasets/openfoodfacts/product-database

Repository root (VERIFIED from `/tree/main`):

| File | Size |
|---|---|
| `food.parquet` | **8.04 GB** |
| `beauty.parquet` | 67.6 MB |
| `petfood.parquet` | 8.31 MB |
| `README.md` | 3.19 kB |
| `.gitattributes` | 2.47 kB |

Repository total: 8.12 GB. Dataset viewer: 4.99M rows in `default` config; `food` split ~4.9M rows; `beauty` split ~80.2k rows (VERIFIED from viewer text). Size category 1M-10M rows. Licence: `agpl-3.0` and `odbl` in metadata; README says the database is ODbL and contents are DbCL (VERIFIED).

Column schema as shown by the HF viewer (VERIFIED):

- **string:** `brands`, `categories`, `code`, `compared_to_category`, `creator`, `environmental_score_data`, `environmental_score_grade`, `emb_codes`, `ingredients`, `labels`, `lang`, `last_editor`, `last_modified_by`, `link`, `manufacturing_places`, `nova_groups`, `nutriscore_grade`, `nutrition_data_per`, `origins`, `owner`, `packaging`, `product_quantity`, `product_quantity_unit`, `quantity`, `serving_quantity`, `serving_size`, `stores`
- **int32:** `additives_n`, `complete`, `environmental_score_score`, `ingredients_*_n`, `known_ingredients_n`, `max_imgid`, `nova_group`, `nutriscore_score`, `rev`, `scans_n`, `unique_scans_n`, `unknown_ingredients_n`, `schema_version`, and others
- **int64:** `created_t`, `last_image_t`, `last_modified_t`, `last_updated_t`, `popularity_key`
- **float32:** `completeness`
- **bool:** `no_nutrition_data`, `obsolete`, `packagings_complete`
- **dict:** `categories_properties`
- **list:** all `*_tags` columns (including `countries_tags`, `categories_tags`, `stores_tags`), plus `editors`, `emb_codes_tags`, `generic_name`, `images`, `ingredients_text`, `nutriments`, `packagings`, `photographers`, `product_name`

**Surprise:** `product_name` and `images` are typed as lists in the viewer, not plain strings. In OFF's data model they are arrays of `{lang, text}` / image-object structs. Verify with `DESCRIBE` before writing SQL (see section 3). Also: the HF viewer does **not** list an `image_front_small_url` column; the front-image URL must be built from `images` (section 6).

Usage examples: the HF page lists pandas, Polars and Datasets, but I found no DuckDB example on the page (VERIFIED absence in fetched text). The README has no example code (VERIFIED).

### 1.4 Delta and freshness

- Full dump is nightly; deltas cover the last 14 days only (VERIFIED).
- The HF Parquet is a snapshot; its refresh cadence is UNVERIFIED. Re-download by checking the HF commit date before re-seeding.
- For a seed that does not need deletion handling, a monthly refresh from Parquet is enough. Deleted/obsolete products stay in the catalogue until a full rebuild; filter `obsolete = false` (column exists per schema).

---

## 2. Product counts (French coverage)

### 2.1 Products tagged `en:france` in the food database

- Search snippet (UNVERIFIED, undated): world.openfoodfacts.org country list shows **France at ~1,210,547 products** (356 countries listed). Source: https://world.openfoodfacts.org/countries (appeared in search results, not fetched).
- The country page `https://world.openfoodfacts.org/country/france` returned HTTP 503 during research, so no direct count was read.
- Open Food Facts overall: Wikipedia says the project passed 4 million products in 2025 (UNVERIFIED, from search snippet: https://en.wikipedia.org/wiki/Open_Food_Facts).
- **Recommendation:** run the DuckDB count in section 3 to get the exact `en:france` count on the current Parquet snapshot. Expect well under the 1.2M figure, because the Parquet dump is a *simplified* export and `countries_tags` is what matters.

### 2.2 Store and brand counts (Leclerc / Carrefour / Marque Repère)

- Search snippet (UNVERIFIED, date unknown): a France brand listing shows **Marque Repère ~7,675 products** (another regional page: 7,677), **carrefour ~15,579** and **leclerc ~2,826** as separate brand entries. Sources: https://fr-en.openfoodfacts.org/brands (snippet only).
- Search results show Marque Repère product pages with "Stores: Leclerc" and "Countries where sold: France" (e.g. https://world.openfoodfacts.org/product/3564700027509/marque-repere-tablette-d-or-noisettes-entieres) (VERIFIED in search snippet text). No Marque Repère product with a Carrefour store tag was found.
- An OFF store page exists for Leclerc on Open Products Facts: https://fr-en.openproductsfacts.org/store/leclerc/origins (UNVERIFIED content).
- **Surprise:** the Marque Repère brand is Leclerc's private label; its barcode prefix `3564700…`/`3564706…` is visible in the search results. Use `brands_tags` containing `marque-repere` as the filter, plus `stores_tags` containing `leclerc`. Carrefour brand products are a separate brand set (`carrefour`).
- Exact per-store counts from `stores_tags` could not be read (stores page 503). **UNVERIFIED.** Run the SQL in section 3 to get them.

### 2.3 Open Products Facts (household)

- Open Products Facts `en:france` category count: a search snippet shows France at 134 products within a country list for that site (UNVERIFIED; the snippet may be a sub-category page). Treat household coverage as **small on OPF**, so the household part of the seed will be thin and will mostly come from live API fallback. Verify with the CSV dump.

---

## 3. Filter the Parquet with DuckDB, without downloading all of it

DuckDB reads Parquet over HTTP(S) and the `hf://` protocol with projection pushdown (only the selected column chunks are fetched) and predicate pushdown on row-group statistics. Downloading all 8.04 GB is not needed for a filtered extract, but the `countries_tags` filter still reads that column across the whole file (UNVERIFIED how many bytes this costs; expect a fraction of 8 GB, probably 0.5-2 GB, to be measured on a laptop).

### 3.1 Install and check the schema (no data pulled)

```bash
brew install duckdb        # or: pip install duckdb
duckdb
```

```sql
INSTALL httpfs;
LOAD httpfs;

-- zero-row probe: shows real types, including product_name / images
DESCRIBE SELECT * FROM read_parquet('hf://datasets/openfoodfacts/product-database/food.parquet') LIMIT 0;
```

The `hf://datasets/<owner>/<repo>/<path>` syntax is confirmed by the DuckDB docs (VERIFIED via redirected page content; the exact docs page https://duckdb.org/docs/2.0/core_extensions/httpfs/hugging_face.html was reached). Whether `httpfs` must be `LOAD`ed explicitly depends on the DuckDB version (UNVERIFIED; `LOAD httpfs;` is harmless).

### 3.2 Count French products and the top stores

```sql
SELECT count(*) AS fr_products
FROM read_parquet('hf://datasets/openfoodfacts/product-database/food.parquet')
WHERE list_contains(countries_tags, 'en:france');
```

```sql
-- stores_tags values are slugs; confirm the spelling first (UNVERIFIED: 'leclerc', 'carrefour')
SELECT s AS store_tag, count(*) AS n
FROM read_parquet('hf://datasets/openfoodfacts/product-database/food.parquet'),
     unnest(stores_tags) AS t(s)
WHERE list_contains(countries_tags, 'en:france')
  AND (s LIKE '%leclerc%' OR s LIKE '%carrefour%')
GROUP BY s
ORDER BY n DESC;
```

```sql
-- Marque Repère and Carrefour-brand counts (brands_tags is a list; UNVERIFIED that the column is brands_tags, not brands)
SELECT count(*) AS n
FROM read_parquet('hf://datasets/openfoodfacts/product-database/food.parquet')
WHERE list_contains(countries_tags, 'en:france')
  AND (list_contains(brands_tags, 'marque-repere') OR list_contains(brands_tags, 'carrefour'));
```

Note: the viewer lists `brands` as a string and no `brands_tags` in the shown schema summary; the `*_tags` columns are listed as list type. Confirm with `DESCRIBE` in 3.1 and adjust.

### 3.3 Slim extract for the seed (the main query)

This projects only the needed columns, keeps French products, drops obsolete rows and orders by popularity. The `product_name` and `images` shapes are not confirmed, so the SQL has a commented fallback.

```sql
COPY (
  SELECT
    code                                  AS barcode,
    -- product_name is typed as list in the viewer; prefer the French text
    coalesce(
      list_filter(product_name, x -> x.lang = 'fr')[1].text,   -- if struct {lang,text}
      product_name[1].text
    )                                     AS name_fr,
    brands,
    quantity,
    product_quantity,
    product_quantity_unit,
    categories_tags,
    stores_tags,
    unique_scans_n,
    scans_n,
    popularity_key,
    images                                -- kept only to derive the image path (see section 6)
  FROM read_parquet('hf://datasets/openfoodfacts/product-database/food.parquet')
  WHERE list_contains(countries_tags, 'en:france')
    AND coalesce(obsolete, false) = false
    AND code IS NOT NULL
  ORDER BY popularity_key DESC NULLS LAST, unique_scans_n DESC NULLS LAST
  LIMIT 150000
) TO '/Users/Alexis/Documents/2.PRO/Autoentreprise/basement-inventory/scratch/off_fr_top150k.parquet' (FORMAT parquet);
```

If `product_name` is a plain string in practice, replace the `coalesce(...)` with `product_name AS name_fr`. If `images` is a list of structs, do **not** store it in Postgres; derive the image URL in the app (section 6), and drop the column before writing the CSV for Supabase.

Use a scratch directory inside the project only for the output, and do not commit it.

### 3.4 Export to CSV for COPY (Postgres load)

```sql
COPY (
  SELECT barcode, name_fr, brands, quantity, product_quantity, product_quantity_unit,
         categories_tags, stores_tags, unique_scans_n
  FROM read_parquet('/Users/Alexis/Documents/2.PRO/Autoentreprise/basement-inventory/scratch/off_fr_top150k.parquet')
) TO '/Users/Alexis/Documents/2.PRO/Autoentreprise/basement-inventory/scratch/off_fr_top150k.csv' (FORMAT csv, HEADER true, NULL '');
```

Array columns (`categories_tags`, `stores_tags`) are written by DuckDB as `[a, b]` text. Load them as `text[]` by converting in the staging step (see section 5.3) or store as a single `|`-joined text column to keep the Postgres COPY simple.

### 3.5 Ranking "most scanned"

- `unique_scans_n` (int32) is the number of distinct scanners in OFF's own counter (definition from OFF product-field docs: UNVERIFIED exact semantics).
- `popularity_key` (int64) is OFF's precomputed ranking key; its values include negatives, so it is a score, not a count (VERIFIED from viewer types; definition UNVERIFIED). The OFF search API documents `popularity_key`, `scans_n`, `unique_scans_n` as sort fields (from search snippet of https://openfoodfacts.github.io/openfoodfacts-documentation/docs/Product-Opener/v2/search/get-search, UNVERIFIED on full text).
- Recommended rank: `ORDER BY popularity_key DESC, unique_scans_n DESC`. Keep `unique_scans_n` in the extract so you can re-rank later without re-downloading.

---

## 4. Sizing: Postgres per 100k rows, and the Supabase free plan

### 4.1 Supabase free plan (VERIFIED)

Source: https://supabase.com/docs/guides/platform/org-based-billing (Free plan figures on that page):

- **Database size: 500 MB per project** (VERIFIED)
- File storage: 1 GB (VERIFIED)
- Egress: 5 GB (VERIFIED)
- Monthly active users: 50,000 (VERIFIED)
- Not stated whether free projects pause after inactivity on that page (UNVERIFIED; check the Supabase dashboard before relying on it).

Confirm the current limit in the dashboard before loading, since plans change.

### 4.2 Slim schema

```sql
create table public.off_product (
  barcode         text primary key,             -- EAN-13/EAN-8/UPC as text, keep leading zeros
  name_fr         text not null,
  brand           text,
  quantity        text,
  product_qty     real,
  product_qty_unit text,
  categories      text,                         -- '|'-joined categories_tags, or text[] if preferred
  stores          text,                         -- '|'-joined stores_tags
  scans           int,                          -- unique_scans_n
  rank_score      bigint                        -- popularity_key
);
```

Keep it small. Do **not** store `images`, `nutriments`, `ingredients` or `*_tags` arrays you do not query.

### 4.3 Size estimate (UNVERIFIED: my own estimate, not measured)

Per row (estimate):

- heap tuple header ~24 B + item pointer ~4 B
- barcode text ~14 B
- name_fr ~50 B average (short French product names)
- brand ~15 B, quantity ~10 B, qty real 4 B, unit ~4 B
- categories ~80 B, stores ~25 B
- scans 4 B, rank_score 8 B
- Heap total ≈ 250-300 B per row, plus fillfactor and page overhead, ≈ 0.3-0.35 KB

Indexes (estimate):

- PK on `barcode` (btree text, 13-char): ~35-40 B per row, ~4 MB per 100k
- trigram GIN on `name_fr` (`gin_trgm_ops`): the largest index; typically 1-2x the indexed text. Assume ~100-150 B per row, ~10-15 MB per 100k
- optional btree on `rank_score`: ~12-15 B per row

Total ≈ **0.45-0.55 KB per row**, i.e. **~45-60 MB per 100k rows**, with the trigram index as the main cost. Measure after a 10k-row trial load with `select pg_total_relation_size('off_product');`.

### 4.4 How many rows fit

- Free-plan budget 500 MB. Reserve roughly 150 MB for app data (inventory, households, events, auth tables, and growth), plus Supabase system overhead (UNVERIFIED; typically tens of MB).
- Budget for OFF: ~250-300 MB, which at ~0.5 KB/row is ~500k-600k rows in theory.
- **Recommendation: 100k-150k rows** for the first seed (top by popularity, French, non-obsolete). This keeps the OFF table near 60-90 MB and leaves wide headroom. Expand later only after measuring.
- Stay under ~200k rows until app-data growth is known.

---

## 5. Fastest load path into Supabase

### 5.1 Recommended: COPY via psql

Use the direct Postgres connection (port 5432) or the session pooler (port 5432 on the pooler host). Avoid transaction-mode pooler (6543) for COPY.

```bash
# connection string from Supabase dashboard > Connect (do not commit it)
export SUPA_URL='postgresql://postgres.<project-ref>:<password>@aws-0-eu-west-3.pooler.supabase.com:5432/postgres'
# region eu-west-3 (Paris) is an assumption; use the project's actual region (UNVERIFIED)

psql "$SUPA_URL" -c "\copy public.off_product (barcode, name_fr, brand, quantity, product_qty, product_qty_unit, categories, stores, scans, rank_score) FROM '/Users/Alexis/Documents/2.PRO/Autoentreprise/basement-inventory/scratch/off_fr_top150k_load.csv' WITH (FORMAT csv, HEADER true, NULL '')"
```

Create the table and indexes first, then COPY, then create the trigram index (faster to build after load):

```sql
create extension if not exists pg_trgm;
-- indexes after COPY:
create index off_product_name_trgm on public.off_product using gin (name_fr gin_trgm_ops);
create index off_product_rank_idx on public.off_product (rank_score desc);
analyze public.off_product;
```

Dropping the trigram index before the COPY and recreating it after is the fastest path on a small instance.

### 5.2 Supabase CLI

The Supabase CLI is for migrations and local development, not bulk data. Put the schema in a migration and load the data with psql, not with `supabase db` commands (UNVERIFIED for a `supabase db` bulk-load subcommand; not recommended).

```bash
supabase migration new off_product_schema     # paste the create table + indexes (without the COPY)
supabase db push
```

### 5.3 Batched inserts (fallback)

Use only if COPY is blocked. Batches of 1000 rows with `insert ... on conflict (barcode) do nothing`, 50-100 batches per 100k rows. Slower by an order of magnitude on the free plan.

### 5.4 Staging and idempotency

- Load into a `off_product_staging` table with no indexes, then `insert into off_product select * from off_product_staging on conflict (barcode) do update set ...` to refresh.
- Keep the Parquet snapshot date in a `seed_meta` table so refreshes are traceable.

---

## 6. Image URLs: build them, do not store them

Source: https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/ (VERIFIED).

- Host: `https://images.openfoodfacts.org/images/products/`
- Folder from barcode: pad to 13 digits with leading zeros, split the first 9 digits into three 3-digit folders, then the remaining digits as the last folder.
  - `3435660768163` → `343/566/076/8163`
  - `3168930010883` → `316/893/001/0883`
- Selected image (e.g. front, French): `<key>.<rev>.<size>.jpg`, with key `front_fr`, `rev` taken from the product's `images` entry for that key, and size one of `100`, `200`, `400`, `full`.
  - Example: `https://images.openfoodfacts.org/images/products/316/893/001/0883/front_fr.4.400.jpg`
  - `rev` changes when the image is replaced, so the stored `rev` matters. If `rev` is not known, the path breaks; this is why the seed should keep the `images` field (or the `rev` value) in the extract, *or* the app should fall back to the OFF API for the image.

Recommendation: store nothing for images except optionally `image_rev` (int) for `front_fr`; build the URL in the client with the 400 size. The `images` list column is the source for `rev`; extract it in the DuckDB step with `list_filter` and drop everything else.

Note: the doc says the barcode split is only applied when the code is longer than 8 characters; shorter (EAN-8) codes need padding first (VERIFIED from the doc text).

---

## 7. Live API fallback

- Use the product endpoint `https://world.openfoodfacts.org/api/v2/product/{barcode}.json` with a `fields=` parameter limited to the seed fields (UNVERIFIED exact parameter names; check the OFF API v2 docs before implementing).
- Send a meaningful User-Agent per OFF guidelines (UNVERIFIED wording; check the OFF API docs).

---

## 8. Recommended approach (summary)

1. Use the Hugging Face `food.parquet` with DuckDB, filtered to `en:france`, non-obsolete, ordered by popularity. Do not download the whole 8 GB file if the probe query shows projection pushdown works; if it does not, download once to `scratch/` and filter locally.
2. Keep ~100k-150k rows, columns in section 4.2, indexes on PK and trigram name.
3. Load with `\copy` via psql to the Supabase session pooler, after creating the table.
4. Build image URLs in the app from barcode + `front_fr` rev.
5. Use the live API for anything not in the seed, and for Open Products Facts household items (small French coverage on OPF).

## 9. Surprises and open questions

- The HF Parquet is 8.04 GB, and the `food` split is ~4.9M rows, far more than the 1.2M `en:france` count; the France filter is therefore the key reduction.
- `product_name`, `images` and `*_tags` are list-typed in the viewer, so the SQL must be adapted after `DESCRIBE`.
- No image URL column in the Parquet; the front-image rev must come from `images`.
- Delta files cannot signal deletions.
- Open Products Facts is thin for France (~134 products on the snippet count), so household coverage will mostly come from the API.
- Leclerc's Marque Repère brand is the strongest in-store signal in the OFF data; Carrefour's own brands are a separate brand set.
- Unverified and must be measured: French product count on the current snapshot, per-store counts, DuckDB bytes transferred, Postgres size per 100k rows, and the exact `popularity_key` definition.

## 10. Source URLs

- https://world.openfoodfacts.org/data
- https://huggingface.co/datasets/openfoodfacts/product-database
- https://huggingface.co/datasets/openfoodfacts/product-database/tree/main
- https://huggingface.co/datasets/openfoodfacts/product-database/blob/main/README.md
- https://openfoodfacts.github.io/openfoodfacts-server/api/how-to-download-images/
- https://supabase.com/docs/guides/platform/org-based-billing
- https://duckdb.org/docs/2.0/core_extensions/httpfs/hugging_face.html
- https://openfoodfacts.github.io/openfoodfacts-documentation/docs/Product-Opener/v2/search/get-search (snippet only)
- https://world.openfoodfacts.org/countries (snippet only)
- https://fr-en.openfoodfacts.org/brands (snippet only)
- https://world.openproductsfacts.org/discover (listed, not fetched)
- Not reachable during research (503 or bot block): https://world.openfoodfacts.org/country/france , https://world.openfoodfacts.org/stores/leclerc , https://world.openfoodfacts.org/product-count , https://wiki.openfoodfacts.org/Images , https://wiki.openfoodfacts.org/Open_Food_Facts_Dataset_on_Hugging_Face
