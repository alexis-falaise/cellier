# 05 — Product catalogue: barcode lookup, normalisation, categories, seed, prices, licence

Status: architecture, binding for implementation. Contract: `docs/architecture/contracts/catalogue.ts`
(types and constants named in this document live there). Written 2026-11-10.

Inputs: `docs/BRIEF.md`, `00-decisions.md`, research notes 02, 03, 04, 05, 06, 07, 08, 09, and the migrations
`20261110120200_reference_data.sql` (tables `category_templates`, `catalog_products`, function `search_catalog`) and
`20261110120300_inventory_tables.sql` (table `products`). Section 13 lists what was verified live for this document
and how. Section 14 lists the points the architecture owner must decide.

---

## 0. Defined terms

- **GTIN**: Global Trade Item Number. In Cellier, always the **canonical 14-digit form**: the decoded digits padded
  on the left with zeros to 14 digits (type `Gtin` in `contracts/domain.ts`). EAN-13, EAN-8, UPC-A and UPC-E all
  normalise to it.
- **Open Food Facts family**: the four sister databases run by the Open Food Facts association on the same
  software: Open Food Facts (food, source code `off`), Open Beauty Facts (`obf`), Open Products Facts (household and
  other non-food, `opf`) and Open Pet Food Facts (`opff`).
- **Universal endpoint**: `GET https://world.openfoodfacts.org/api/v3/product/{code}?product_type=all`, which answers
  for a food product and redirects (HTTP 302) to the sister database that holds a non-food product.
- **Catalogue**: the global table `public.catalog_products`, shared by every household, written only by the seed
  pipeline and the Edge Function with the service-role key, read by signed-in users.
- **Catalogue row**: one row of the catalogue; in TypeScript a `CatalogProduct` (camelCase).
- **Household product**: one row of `public.products`, owned by a household. It copies values from a catalogue row
  when it is created and is the source of truth for display afterwards.
- **Device cache**: the per-device IndexedDB object store `catalogue-cache` holding catalogue rows already seen
  (maximum 2,000 entries, least recently used eviction).
- **Shared catalogue code**: the dependency-free TypeScript under `supabase/functions/_shared/catalogue/`, imported by
  the Edge Function (Deno) and by the seed scripts (Node 24 through `tsx`).
- **Rules artefact**: the generated file `supabase/functions/_shared/catalogue/category-rules.json`
  (`CategoryRulesArtefact`).
- **Restricted circulation number**: a barcode in a range that GS1 reserves for a retailer's or a company's internal
  use (in-store weighed goods, internal codes). It identifies nothing outside that store.
- **Seed**: the monthly bulk load of the catalogue from the Open Food Facts family dumps.
- **Plausible price**: an Open Prices observation that passes the filters of section 7.2.

---

## 1. Overview

```
 scanner (zxing-wasm worker)                      manual add
        │ ScannedCode {text, symbology}                │ text query
        ▼                                              ▼
 (1) src/domain/gtin.ts  ──invalid/restricted──► manual entry      search_catalog(p_query, p_limit)
        │ Gtin                                                       (section 9)
        ▼
 (2) local store: household products by gtin ──hit──► "already in your pantry"
        │ miss
     device cache (IndexedDB, 2,000 rows, LRU) ──hit──► product form pre-filled
        │ miss
 (3) PostgREST: select catalog_products where gtin = ? ──hit──► pre-filled (+ written to device cache)
        │ miss
 (4) Edge Function catalog-lookup ──► Open Food Facts universal endpoint (+ Open Prices)
        │                                 normalise, map category, upsert (service role)
        ├─ found ──► pre-filled (+ device cache)
        └─ not found / unavailable / offline
        ▼
 (5) manual entry: name + category (quantity optional)
```

Code layout:

| Path | Role | Runs in |
|---|---|---|
| `supabase/functions/_shared/catalogue/gtin.ts` | GTIN parsing (canonical implementation) | Browser, Deno, Node |
| `src/domain/gtin.ts` | `export * from '../../supabase/functions/_shared/catalogue/gtin.ts'` | Browser |
| `supabase/functions/_shared/catalogue/quantity.ts` | Quantity parsing (section 4.3) | Deno, Node |
| `supabase/functions/_shared/catalogue/normalise.ts` | Open Food Facts record → `CatalogProduct` (section 4) | Deno, Node |
| `supabase/functions/_shared/catalogue/category.ts` | `mapCategory` (section 5.3) | Deno, Node |
| `supabase/functions/_shared/catalogue/category-rules.json` | Rules artefact (generated) | Deno, Node |
| `supabase/functions/_shared/catalogue/retailers.ts` | Leclerc and Carrefour store and brand signals | Deno, Node |
| `supabase/functions/_shared/catalogue/prices.ts` | Plausible-price selection (section 7.2) | Deno, Node |
| `supabase/functions/_shared/catalogue/images.ts` | Image URL building (section 4.5) | Deno, Node |
| `supabase/functions/_shared/catalogue/row.ts` | `toCatalogProduct(row)`, `toSeedRecord(product)` | Browser, Deno, Node |
| `supabase/functions/catalog-lookup/index.ts` | Edge Function (section 6) | Deno |
| `scripts/catalogue/*.ts`, `scripts/catalogue/sql/*.sql` | Rules build, seed, prices, reclassification (sections 5, 7, 10) | Developer machine or GitHub Actions |

Rules for the shared code:

- No imports other than relative imports between these files, with explicit `.ts` extensions (Deno requires them;
  the client `tsconfig.json` sets `allowImportingTsExtensions: true`, which is allowed because it already has
  `noEmit`). Only globals common to Deno, Node 24 and browsers: `fetch`, `AbortSignal.timeout`, `URL`,
  `TextEncoder`, `Intl`, `String.prototype.normalize`.
- The JSON artefact is imported with an import attribute: `import rules from './category-rules.json' with { type: 'json' };`
  (supported by Deno 2 and Node 24). The browser never imports it: the client does not map categories (binding
  decision), so the artefact never enters the PWA bundle. `gtin.ts` and `row.ts` must not import it.
- Pure functions only (no I/O) except `off-fetch.ts` and `prices-fetch.ts`, which wrap `fetch` and are used by the
  Edge Function only.
- Unit tests in Vitest (`supabase/functions/_shared/catalogue/*.test.ts`), run by `pnpm test`. The same tests are
  the specification of the examples in this document.

---

## 2. The catalogue table

`public.catalog_products` is fixed by migration `20261110120200_reference_data.sql`. Meaning of each column, as the
code must fill it:

| Column | Filled from | Rule |
|---|---|---|
| `gtin` | parsed code | 14 digits, valid check digit, never a restricted circulation number |
| `name` | product name | Section 4.1. Required: a record without a usable name is not stored |
| `brand` | `brands` | First brand of the comma-separated list, trimmed, at most 120 characters |
| `quantity_label` | `quantity` | The printed text, whitespace collapsed, at most 60 characters (cut at a word boundary) |
| `net_quantity`, `net_unit`, `pack_count` | `quantity`, `product_quantity`, `product_quantity_unit` | Section 4.3 |
| `category_key`, `category_rule` | category mapping | Section 5 |
| `image_url` | front image | Section 4.5 |
| `source` | database that answered | `off`, `obf`, `opf`, `opff`. `manual` is reserved and never written by this design (section 12.4) |
| `store_tags` | `stores_tags`, `brands_tags` | Section 4.4 |
| `popularity` | `unique_scans_n` | Integer, 0 when absent |
| `price_cents`, `price_observed_on`, `price_chain` | Open Prices | Section 7 |
| `search_text` | generated by Postgres | Never written |
| `source_modified_at` | `last_modified_t` (Unix seconds) | Converted to a timestamp; used by the conditional upsert |
| `created_at`, `updated_at` | Postgres defaults and trigger | Never written |

Invariants the code guarantees beyond the SQL checks: `net_quantity`, `net_unit` and `pack_count` are either all
null or `net_quantity` and `net_unit` are both set (with `pack_count` at least 1); `category_key` is never null when
written (worst case `autre`); `category_rule` always starts with the rules version (section 5.6).

The catalogue is read-only for clients. It must have row level security enabled with a single `select` policy for
`authenticated` and no write policy; that is **not** in the migrations today (section 14, item 1).

---

## 3. Barcode parsing (`gtin.ts`)

### 3.1 What the scanner hands over

The scanner worker returns `ScannedCode { text, symbology, scannedAt }`. `symbology` is mapped from the zxing-wasm
`format` string (`EAN13` → `ean_13`, `EAN8` → `ean_8`, `UPCA` → `upc_a`, `UPCE` → `upc_e`); digits typed by the user
are `manual`. The symbology is needed for one reason only: an 8-digit UPC-E and an EAN-8 cannot be told apart from the
digits. Research 08 enables only `EAN13`, `EAN8`, `UPCA` and runs its own checksum guard that rejects UPC-E; both must
change (section 14, item 6). The scanner's own checksum guard becomes a call to `parseGtin`, so there is one checksum
implementation.

### 3.2 Algorithm

`parseGtin(code: ScannedCode | string): GtinParseResult`:

1. Trim; remove spaces and hyphens (typed input). If anything other than digits remains → `invalid_format`.
2. If the symbology is `upc_e`, or the input is `manual` with 8 digits starting `0` or `1` whose EAN-8 check fails
   but whose UPC-E expansion succeeds: expand UPC-E to UPC-A with the GS1 zero-suppression table of research 09
   section 3 and compare the printed check digit with the computed one. Failure → `invalid_format`
   (expansion impossible) or `invalid_checksum`.
3. Accept lengths 8, 12, 13 and 14 only; anything else → `invalid_format`.
4. Check digit: GS1 mod 10 (weights 3 and 1 from the rightmost data digit). Failure → `invalid_checksum`.
5. Pad to 14 digits: `gtin = digits.padStart(14, '0')`.
6. Restricted circulation (binding rule): take the 13-digit form `gtin.slice(1)` when the indicator digit
   `gtin[0]` is `0`; if it starts with `02` or with `2` followed by any digit (prefixes 20 to 29) →
   `restricted_circulation`. This covers EAN-13 `02…` and `2…`, and UPC-A starting `2` (number system 2).
7. Otherwise → `ok: true` with `gtin`, `sourceLength` and `offCode` (section 3.3).

Examples (unit tests):

| Input | Symbology | Result |
|---|---|---|
| `3017620422003` | ean_13 | ok, gtin `03017620422003`, offCode `3017620422003` |
| `3017620422004` | ean_13 | `invalid_checksum` |
| `034000470693` | upc_a | ok, gtin `00034000470693`, offCode `0034000470693` |
| `73513537` | ean_8 | ok, gtin `00000073513537`, offCode `73513537` |
| `04252614` | upc_e | expands to `042100005264`, ok, gtin `00042100005264` |
| `2123456000005` (valid check) | ean_13 | `restricted_circulation` |
| `0212345000004` (valid check) | ean_13 | `restricted_circulation` |
| `12345` | manual | `invalid_format` |

### 3.3 The code sent to Open Food Facts

Open Food Facts normalises codes on its side (codes of 7 digits or fewer, after removing leading zeros, are padded to
8; codes of 9 to 12 digits are padded to 13). `offCode` reproduces that: strip leading zeros, pad to 8 if 8 digits or
fewer remain, otherwise to 13; a GTIN-14 whose indicator digit is not 0 is sent as 14 digits. The design does not
depend on this being exact: a live call with the 14-digit form `03017620422003` returned the product with
`status: "success_with_warnings"` and warning `different_normalized_product_code` (verified 2026-11-10). Seed rows use
the dump's `code` padded to 14, so the same product gets the same key on both paths.

### 3.4 Restricted ranges beyond the binding rule (proposal)

GS1 also reserves company-internal ranges that the binding rule does not list: EAN-8 codes starting with `0` or `2`
(RCN-8, "Restricted Circulation Numbers within a company", GS1-8 prefixes 000-099 and 200-299) and EAN-13 codes
starting with `04` (UPC-A number system 4, company-internal). A retailer can print these on its own-brand items, and
they mean nothing outside that retailer. The parser implements them behind `GTIN_RESTRICTED_EXTENSION_ENABLED`
(false by default) so the owner can switch them on without a code change elsewhere (section 14, item 5). Until then
such codes go through the normal chain; the cost is one wasted lookup and a possible wrong match in another country.

Restricted codes are never sent to the server, never written to the catalogue and never cached. The scan flow offers
manual entry (section 8.3). The household product created by hand keeps `gtin = null` for them (a restricted code
does not identify a product reliably, and the household natural key `unique (household_id, gtin)` would wrongly merge
different weighed items).

---

## 4. Normalisation of an Open Food Facts record

`normalise(record, source): NormaliseResult` in `normalise.ts` takes the fields below, whether they come from the
API (`/api/v3/product/{code}` with `fields=`) or from a dump line, and returns either a `CatalogProduct` or a draft
without a name.

Fields requested from the API (one `fields=` list, also the column projection of the seed extract):

```
code,product_type,product_name,product_name_fr,generic_name,generic_name_fr,brands,brands_tags,quantity,
product_quantity,product_quantity_unit,categories_tags,food_groups_tags,pnns_groups_1,pnns_groups_2,
stores_tags,countries_tags,image_front_small_url,unique_scans_n,last_modified_t,obsolete
```

### 4.1 Name

Take the first non-empty value among `product_name_fr`, `product_name`, `generic_name_fr`, `generic_name`. In the
Hugging Face Parquet, `product_name` and `generic_name` are lists of `{lang, text}`: take the `fr` entry, then the
entry whose `lang` equals the product's `lang`, then the first entry. Then: Unicode NFC, trim, collapse whitespace,
remove a trailing run of `*`, `!` or `_` characters only if letters remain, cut at 200 characters on a word boundary.
Names made only of digits or of one character are rejected. No other rewriting (no title case): the name is shown as
contributed, which keeps the content a faithful DbCL extract.

If no usable name remains, the record is not stored. The Edge Function returns `not_found` with a `draft` holding the
brand, quantity, category guess and image, so the manual form is pre-filled; the user supplies the name.

### 4.2 Brand

First element of `brands` split on commas (`"Ferrero, Nutella"` → `Ferrero`), trimmed, at most 120 characters, null
if empty.

### 4.3 Quantity: `quantity_label`, `net_quantity`, `net_unit`, `pack_count`

Meaning (fixed by the SQL): `net_quantity` is the content of **one element** in `net_unit`; `pack_count` is the number
of elements in the pack; total content = `net_quantity × pack_count`. `net_unit` is `g`, `ml` or `piece`.

Inputs: `quantity` (free text as printed, for example `"6 x 1 l"`), `product_quantity` (Open Food Facts' computed
**total** for the pack, a number on the API and a string in the Parquet dump) and `product_quantity_unit` (`g` or
`ml` on the products checked; other values are converted or ignored).

Algorithm (`parseQuantity(input): QuantityParse`):

1. `quantity_label` = `quantity` with whitespace collapsed, cut to 60 characters on a word boundary; null if empty.
2. Prepare a working copy: lower case, `,` as decimal separator turned into `.`, remove the estimated-sign mark `℮`
   and a lone trailing `e` after a unit (`"400 g e"`), replace `×` and `*` by `x`.
3. **Multipack** pattern, searched anywhere (also inside parentheses):
   `(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(unit)` → `pack_count` = first number, element measure = second number and unit.
   A nested form `(\d+)\s*x\s*(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(unit)` multiplies the two counts. A count form
   `(\d+)\s*x\s*(\d+)\s*(count noun)` gives `pack_count` = product of the two numbers, `net_quantity` 1, `piece`.
4. **Single measure** pattern `(\d+(?:\.\d+)?)\s*(unit)\b` → `pack_count` 1.
5. **Count** pattern `(\d+)\s*(count noun)\b` → `net_unit` `piece`, `net_quantity` 1, `pack_count` = the number.
6. If steps 3 to 5 found nothing, and `product_quantity` is a positive number with a unit that converts to `g` or
   `ml` → `net_quantity` = that number converted, `pack_count` 1, method `product_quantity`.
7. Otherwise all three are null (method `none`); `quantity_label` is still kept.

Units and conversions: `kg` ×1000 → g; `g`, `gr`, `gramme(s)` → g; `mg` ÷1000 → g; `l`, `litre(s)`, `liter(s)`
×1000 → ml; `dl` ×100 → ml; `cl` ×10 → ml; `ml` → ml. Ounces (`oz`, `fl oz`) are not converted (ambiguous, rare in
France): they fall through to step 6.

Count nouns (separable elements a household takes out one by one): `u`, `unité(s)`, `pièce(s)`, `pcs`, `rouleau(x)`,
`roll(s)`, `sachet(s)`, `capsule(s)`, `dosette(s)`, `tablette(s)`, `pastille(s)`, `couche(s)`, `lingette(s)`,
`œuf(s)`/`oeuf(s)`, `bouteille(s)`, `canette(s)`, `brique(s)`, `pot(s)`, `boîte(s)`, `filtre(s)`, `éponge(s)`,
`sac(s)`, `pile(s)`. Not counted (not separable or not stock units): `lavage(s)`, `dose(s)`, `feuille(s)`,
`portion(s)`, `wash(es)`; they are ignored, so `"30 lavages"` alone gives null measures.

Sanity: `net_quantity` must be at least 0.001 and below 1,000,000 after conversion, `pack_count` between 1 and 999;
otherwise the three fields are null. When both a parsed label and `product_quantity` exist in the same unit family
and the label total differs from `product_quantity` by more than 10 percent, the label wins (it is what the user
reads on the pack) and the disagreement is counted in the seed report.

Examples (unit tests):

| `quantity` | `product_quantity`, unit | Result (`net_quantity`, `net_unit`, `pack_count`) | Method |
|---|---|---|---|
| `6 x 1 l` | 6000, ml | 1000, ml, 6 | label_multipack |
| `500 g` | 500, g | 500, g, 1 | label_single |
| `4 x 125 g` | 500, g | 125, g, 4 | label_multipack |
| `75 cl` | 750, ml | 750, ml, 1 | label_single |
| `12 rouleaux` | none | 1, piece, 12 | label_count |
| `12 u` (Lotus toilet paper, live) | none | 1, piece, 12 | label_count |
| `240 g (8 x 30 g)` (live) | 240, g | 30, g, 8 | label_multipack |
| `400 g e` (Nutella, live) | 400, g | 400, g, 1 | label_single |
| `1.89l` (Le Chat, live) | 1890, ml | 1890, ml, 1 | label_single |
| `1,5 L` | none | 1500, ml, 1 | label_single |
| `6 x 33 cl` | 1980, ml | 330, ml, 6 | label_multipack |
| `2 x 6 rouleaux` | none | 1, piece, 12 | label_multipack (count form) |
| `30 lavages` | none | null, null, null | none |
| empty | 1890, ml | 1890, ml, 1 | product_quantity |

### 4.4 Store tags and retailer signals

`store_tags` holds `leclerc` and/or `carrefour` and is used only for ranking (search tie-break through popularity
and the seed selection). Rules in `retailers.ts`, a code constant versioned with the code:

- `leclerc` if any `stores_tags` value, lower-cased and accent-folded, contains `leclerc`, or if `brands_tags`
  contains `marque-repere`, `nos-regions-ont-du-talent`, `eco-plus` or `bio-village`.
- `carrefour` if any `stores_tags` value contains `carrefour`, or if `brands_tags` contains a tag starting with
  `carrefour` (`carrefour`, `carrefour-bio`, `carrefour-classic`, `carrefour-extra`, …), `reflets-de-france` or
  `simpl`.
- The GS1 company prefixes `3564700` (Scamark, Leclerc) and `3560070` (Carrefour) are hints only: they add the tag
  only when the brand list is empty (a prefix alone is weak evidence, research 07).

The brand slugs other than `marque-repere` and `carrefour` are UNVERIFIED against the live data; the seed report
prints the count of products per signal so a slug that matches nothing is visible at the first run.

### 4.5 Image URL

- Live path: `image_front_small_url` as returned (200 px). Verified live: the host follows the database
  (`images.openfoodfacts.org`, `images.openproductsfacts.org`, …).
- Seed path (the Parquet has no URL column, only the `images` list of `{key, rev, sizes, …}`; JSONL dumps have the
  same `images` object): pick key `front_fr`, else `front_<lang>`, else the first `front_*`; build
  `https://images.{database host}/images/products/{folder}/{key}.{rev}.200.jpg`, where `folder` is the code padded
  to 13 digits split as `3/3/3/rest` (`3017620422003` → `301/762/042/2003`); codes of 8 digits or fewer are not
  split (research 05 section 6). No image → null.
- Only the URL is stored. Cellier never copies, resizes or re-hosts the images (section 12.3). The service worker
  caches the images it displays (runtime cache, research 21).

### 4.6 Other fields

`popularity` = `unique_scans_n` (0 when absent). `source_modified_at` = `last_modified_t` seconds as a UTC
timestamp. `source` from `product_type` (`food` → `off`, `beauty` → `obf`, `product` → `opf`, `petfood` → `opff`)
on the live path, from the dump file on the seed path. Records with `obsolete` true (or the string `"on"`) are
skipped by the seed; the live path stores them (the user is holding the product).

---

## 5. Category mapping

### 5.1 Artefact and source

Two files:

- `scripts/catalogue/category-rules.source.json` (`CategoryRulesSource`): the human-edited rule table of research 06
  section 6.1 (tiers 0 to 2 as category → tags, pnns maps, name regular expressions, database defaults), plus a
  food-group map and the list of ignored tags. This is the only file a person edits.
- `supabase/functions/_shared/catalogue/category-rules.json` (`CategoryRulesArtefact`): generated, committed, never
  edited by hand. Its fields are defined in the contract; in short: `format`, `version`, `builtAt`, `taxonomies`
  (URL, SHA-256, Last-Modified and entry count of each input), `categories` (the 28 slugs), `tagRules` (inverted to
  tag → category per tier), `ancestors` (pruned ancestor map), `depth`, `synonyms`, `ignoredTags`, `foodGroups`,
  `pnns2`, `pnns1`, `nameRegexes`, `databaseDefaults`, `finalFallback`.

Why a food-group map was added to the research table: the Hugging Face Parquet has **no** `pnns_groups_1`,
`pnns_groups_2` or `categories_hierarchy` columns (verified on the dataset schema, section 13), while both the
Parquet and the API carry `food_groups_tags`, whose level-1 and level-2 values are the PNNS groups in slug form
(`en:sugary-snacks`, `en:sweets`, `en:fruit-juices`, …, verified in `food_groups.full.json`). The food-group map is
the research pnns map with slugified keys (`"Sweets": "chocolat"` → `"en:sweets": "chocolat"`), plus
`en:dehydrated-soups` and `en:fresh-soups` → `plats`. The live path also requests `pnns_groups_1/2` but uses them
only when `food_groups_tags` is empty, so the seed and the live path give the same answer for the same record.
Likewise, both paths use `categories_tags` (which already contains the ancestors), never `categories_hierarchy`.

### 5.2 Build script `scripts/catalogue/build-category-rules.ts`

Command: `pnpm tsx scripts/catalogue/build-category-rules.ts [--offline]`

Inputs (downloaded to `.cache/catalogue/taxonomies/`, which is git-ignored, unless `--offline` reuses them):

| Taxonomy | URL | Size on 2026-11-10 |
|---|---|---|
| food | `https://static.openfoodfacts.org/data/taxonomies/categories.json` | 4,947,634 bytes, 14,946 entries |
| products | `https://static.openproductsfacts.org/data/taxonomies/categories.json` | 3.6 MB, 5,560 entries |
| beauty | `https://static.openbeautyfacts.org/data/taxonomies/categories.json` | 228 KB, 199 entries |
| petfood | `https://static.openpetfoodfacts.org/data/taxonomies/categories.json` | 27 KB, 30 entries |
| food_groups | `https://static.openfoodfacts.org/data/taxonomies/food_groups.full.json` | 24 KB |

Steps:

1. Load the source file and the five taxonomies. Merge the four category taxonomies into one graph (a tag present in
   several files keeps the union of its parents).
2. Validate: every rule tag exists in the merged graph; no tag appears twice across tiers or categories; every
   category key belongs to the 28 slugs, which the script reads from `contracts/domain.ts` `CATEGORY_KEYS` and checks
   against the `insert into public.category_templates` statement of the migration (parsed with a regular
   expression). Every `foodGroups` key exists in `food_groups.full.json`. Every name regular expression compiles with
   flags `iu`. Any failure stops the build with a list of the problems.
3. Compute `depth` (longest path to a root) for every tag.
4. Compute `ancestors`: for each tag, a breadth-first walk up the parents, keeping only ancestors that carry a rule
   in any tier, ordered by distance then alphabetically; tags with an empty list that are not rule tags are dropped.
5. Compute `synonyms`: for every kept tag, slugify its `name.fr` and `name.en` (lower case, accents folded, every run
   of non-alphanumeric characters → `-`, trimmed) and map `fr:<slug>` and `en:<slug>` to the tag, unless the slug is
   itself a canonical tag or is ambiguous (two tags with the same slug: both dropped and listed in the build log).
6. Increment `version` when the content (everything except `builtAt` and `taxonomies.*.lastModified`) differs from the
   committed artefact. The script reads the committed artefact and writes the new version number back into the
   source file too, so the two stay in step.
7. Write the artefact with sorted keys (stable diffs), and print: number of rule tags, ancestor entries, synonyms,
   and file size. The build fails above 3 MB (the Edge Function bundle loads it at cold start).
8. Run the regression sample: `scripts/catalogue/fixtures/category-sample.jsonl` (the 15 products of research 06
   section 7, to be extended to 100 random French products, section 14 item 11) through `mapCategory`; print
   mismatches; fail if the agreement drops compared with the committed baseline.

The script needs network only for step 1. It is run by a developer when the source file changes, and by the monthly
workflow (section 10.4) which opens a pull request if only the taxonomies changed the artefact.

### 5.3 Algorithm (`mapCategory(input, rules): CategoryMappingResult`)

1. **Canonicalise tags.** For each `categoriesTags` value: lower-case the prefix and slugify the rest; drop it if it
   is in `ignoredTags` (for example `en:incorrect-product-type`, `en:non-food-products`, `en:open-beauty-facts` is
   **not** ignored because the database default needs it); keep it if it is a key of `depth`; otherwise look it up in
   `synonyms`; otherwise drop it. Example: `fr:Liquide vaisselle` → `fr:liquide-vaisselle`, a canonical tag under
   `en:dish-detergent-soap`.
2. **Order** the canonical tags by `depth` descending; ties keep the later position in the original list first.
3. **Tiers 0, 1, 2**, in this order. Within a tier, for each tag in order: if the tag itself has a rule in the tier,
   it matches; otherwise walk `ancestors[tag]` nearest first and take the first ancestor with a rule in the tier.
   The first tag that yields a match decides the tier, trace `tier<n>:<rule tag>`. Tier 0 (baby, pet, cleaning,
   hygiene, paper, pharmacy) wins over tier 1 (frozen, canned), which wins over tier 2 (product type).
4. **Food groups**: the deepest `foodGroupsTags` value with an entry in `foodGroups` (level 2 before level 1),
   trace `fg:<tag>`. Values starting `en:unknown-food-group` are ignored.
5. **pnns** (live path only, and only if `foodGroupsTags` is empty): `pnns2[pnnsGroups2]`, then
   `pnns1[pnnsGroups1]`, ignoring `unknown`; trace `pnns2:<value>` or `pnns1:<value>`.
6. **Name regular expressions** in order against the name; trace `name:<index>`.
7. **Database default** (`databaseDefaults[source]`: `obf` → `hygiene`, `opff` → `animaux`, `opf` → none), trace
   `db:<source>`.
8. **Fallback**: `autre`, trace `fallback`.

Every trace is prefixed with the rules version and a vertical bar: `v1|tier2:en:red-wines`. Traces never exceed 120
characters (a longer rule tag is cut, which cannot happen with the current tags).

Worked examples (from research 06 and the live probes, unit tests):

| Product | Tags (abridged) | Result | Trace |
|---|---|---|---|
| Nutella | `en:spreads`, `en:hazelnut-spreads`, … | `petit_dej` | `v1\|tier2:en:hazelnut-spreads` |
| Bordeaux rouge | … `en:red-wines`, `en:bordeaux-wines` | `vin` | `v1\|tier2:en:bordeaux-wines` |
| Frozen pizza | `en:frozen-pizzas`, `en:pizzas` | `surgeles` | `v1\|tier1:en:frozen-pizzas` |
| Le Chat detergent (OPF, live) | `en:household-chemicals`, `en:liquid-detergent` | `entretien` | `v1\|tier0:en:household-chemicals` |
| Lotus toilet paper (OPF, live) | `en:household-supplies`, `en:toilet-papers` | `papier` | `v1\|tier0:en:toilet-papers` (deeper than `en:household-supplies`) |
| Naturnes baby jar | none | `bebe` | `v1\|name:0` |
| OBF toothpaste, noise tags only | `en:non-food-products`, `en:Dents` | `hygiene` | `v1\|name:2` |

### 5.4 From catalogue category to household category

There is no mapping table in the database. When a household product is created from a catalogue row, the client
picks the household category whose `templateKey` equals `catalogProduct.categoryKey` and whose `deletedAt` is null.
If none exists (the household deleted that category, or `categoryKey` is null), it picks the live category whose
`templateKey` is `autre`; if that is gone too, `categoryId` is null ("Sans catégorie"). The user can change it in the
same form before saving. The household's choice is stored on the household product only; it never flows back to
the catalogue.

### 5.5 Versioning

- `version` in the source and in the artefact: a positive integer, starting at 1, incremented by the build script on
  any content change (section 5.2 step 6).
- The version is part of every stored trace (`v3|…`), so the database itself tells which rows were mapped by an old
  version: `select count(*) from catalog_products where category_rule not like 'v3|%'`.
- The Edge Function and the seed scripts import the same artefact, so a deployment of the function and a seed run
  with the same commit produce the same mapping.

### 5.6 Re-applying a rule change to existing rows

The catalogue stores the mapping result but not the input tags, so re-mapping needs the source records again
(section 14, item 3 proposes a column that would avoid this). Procedure, script
`scripts/catalogue/reclassify.ts` (run after a rules change is merged, and automatically by the monthly workflow
after the seed load):

1. `psql -c "\copy (select gtin, source from public.catalog_products where category_rule is null or category_rule not like 'v<N>|%') to '.cache/catalogue/reclassify-gtins.csv' csv header"`.
2. DuckDB joins that list against the candidate extract of the latest seed run (section 10.2, step 3) and, for codes
   not in it (rows created by the Edge Function for products outside the France filter), against the four full
   dumps by `code` (no country filter; projection on `code`, `categories_tags`, `food_groups_tags`, names).
3. Node runs `mapCategory` on each record and writes `.cache/catalogue/reclassify.csv` (`gtin, category_key,
   category_rule`).
4. `psql -f scripts/catalogue/sql/reclassify.sql`: `\copy` into a temporary table, then
   `update public.catalog_products c set category_key = r.category_key, category_rule = r.category_rule from r
   where c.gtin = r.gtin and (c.category_key, c.category_rule) is distinct from (r.category_key, r.category_rule)`.
5. Rows found in no dump keep their old values (they will be re-mapped when the Edge Function next fetches them, or
   stay as they are); the script prints their count.

Household products are not touched: they copied the category when they were created and the household's choice
wins. A rule change affects only products created afterwards.

---

## 6. Edge Function `catalog-lookup`

### 6.1 Deployment and authentication

- Path `supabase/functions/catalog-lookup/index.ts`; `supabase/config.toml` has `[functions.catalog-lookup]
  verify_jwt = true`, so the gateway rejects calls without a valid user access token with HTTP 401 before the
  function runs. The function additionally reads the user id (`sub`) from the verified token (through
  `supabase.auth.getUser(token)` or the JWT claims) for rate limiting, and refuses the `anon` role with 401. Check at
  implementation time whether the project uses the new asymmetric JWT signing keys, in which case Supabase's current
  guidance for `verify_jwt` must be re-read.
- Secrets: the service-role key (`SUPABASE_SERVICE_ROLE_KEY`, provided by the platform) is used only inside the
  function to upsert the catalogue and to call the gate function of section 6.6. It never leaves the function.
- The function index may import `@supabase/supabase-js` (npm specifier); the shared catalogue code may not.
- Outbound User-Agent on every upstream call: `Cellier/<app version> (falaiseal@gmail.com)`, the format required by
  Open Food Facts (`AppName/Version (ContactEmail)`, verified on the API introduction page). The contact address is a
  configuration value (`CATALOGUE_CONTACT` secret), not hard-coded.

### 6.2 Request

```
POST /functions/v1/catalog-lookup
Authorization: Bearer <user access token>
apikey: <publishable key>
Content-Type: application/json

{"gtin":"03017620422003"}
```

The client calls it through `supabase.functions.invoke('catalog-lookup', { body: { gtin } })` with an
`AbortSignal.timeout(9000)`. POST is used because `functions.invoke` defaults to it and the answer must never be
cached by an intermediary (it depends on the caller's rate-limit state); the device cache does the caching.

### 6.3 Processing

1. Method other than POST → 405 (`OPTIONS` answers the CORS preflight with 204 and the headers of section 6.5).
   Body over 1 KiB → 413. Not JSON or no string `gtin` → 400 `invalid_request`.
2. `parseGtin(gtin)`: failure → 400 `invalid_gtin` or `restricted_gtin`. No upstream call, no gate call.
3. **Gate**: one call to `private.catalog_lookup_gate(user_id, gtin)` (section 6.6). It returns one of `rate_limited`
   (with seconds to wait) → 429; `cached_miss` → 200 `not_found` with `cached: true`; `upstream_budget_exhausted`
   (with seconds) → 503 `upstream_unavailable`; `admit`.
4. **Catalogue re-check**: `select … from catalog_products where gtin = $1` with the service role. A hit (another
   household added it since the client's step 3) → 200 `found`, origin `catalogue`, `persisted: true`.
5. **Upstream product call**: `GET https://world.openfoodfacts.org/api/v3/product/{offCode}?product_type=all&fields=…`
   with `redirect: 'follow'` (the 302 to the sister host is followed inside the same timeout of 4.5 s). In parallel,
   the Open Prices call of section 7.4 (timeout 2.5 s).
6. **Interpret** (verified live, section 13):
   - HTTP 200 with `status` `success` or `success_with_warnings` and `result.id` `product_found` → found.
   - HTTP 404 with `status` `failure` and `result.id` `product_not_found` → not found in any of the four databases.
     (Note: v3 answers "not found" with HTTP 404, unlike v2 which answered HTTP 200 with `status: 0`.)
   - HTTP 404 with an `invalid_code` error → treated as not found (the parser should have stopped it).
   - HTTP 429, any 5xx, a network error or the timeout → **fallback** once: if at least 2.5 s of the 7 s budget remain,
     the same request to `https://world.openproductsfacts.org/api/v3/product/{offCode}?product_type=all&fields=…`
     (verified to answer directly for its own products; for a food product it redirects back to the food host, which
     is the one that failed, so the fallback helps only for non-food products and when the failure is specific to the
     food host). If the fallback also fails → 503 `upstream_unavailable`, `Retry-After: 60`.
   - Any other answer, or a body that does not parse → 502 `upstream_invalid`.
7. **Not found**: insert or refresh the negative-cache entry (`private.catalog_misses`), answer 200 `not_found`,
   `cached: false`, `draft: null`.
8. **Found**: `normalise(record, source)`. No usable name → negative-cache entry is **not** written (the product exists
   and may be completed upstream), answer 200 `not_found` with the `draft`. Otherwise map the category, attach the
   price if the parallel call produced a plausible one, and upsert:

   ```sql
   insert into public.catalog_products (gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count,
     category_key, category_rule, image_url, source, store_tags, popularity, price_cents, price_observed_on,
     price_chain, source_modified_at)
   values (…)
   on conflict (gtin) do update set
     name = excluded.name, brand = excluded.brand, quantity_label = excluded.quantity_label,
     net_quantity = excluded.net_quantity, net_unit = excluded.net_unit, pack_count = excluded.pack_count,
     category_key = excluded.category_key, category_rule = excluded.category_rule, image_url = excluded.image_url,
     source = excluded.source, store_tags = excluded.store_tags, popularity = excluded.popularity,
     source_modified_at = excluded.source_modified_at,
     price_cents = coalesce(excluded.price_cents, catalog_products.price_cents),
     price_observed_on = coalesce(excluded.price_observed_on, catalog_products.price_observed_on),
     price_chain = coalesce(excluded.price_chain, catalog_products.price_chain)
   where catalog_products.source_modified_at is null
      or excluded.source_modified_at > catalog_products.source_modified_at
   returning *;
   ```

   (Done as a single PostgREST `upsert` is not possible because of the `where` clause; the function calls a small
   SQL function `private.catalog_upsert(jsonb)` or uses a direct Postgres connection. Proposed in section 14, item 2.)
   If the gate reported that the catalogue is above its row cap, the upsert is skipped and `persisted: false`.
   Answer 200 `found`, origin `open_food_facts`.
9. Every outcome is logged (one structured line: user id hash, gtin, outcome, upstream status, duration) and
   recorded by the gate table for rate limiting.

### 6.4 Responses

| HTTP | Body (`CatalogLookupResponse`) | When | Client action |
|---|---|---|---|
| 200 | `{outcome:'found', origin, product, persisted}` | Found | Pre-fill, store in device cache |
| 200 | `{outcome:'not_found', cached, draft}` | Absent upstream, or present without name | Manual entry, pre-filled with `draft` |
| 400 | `{outcome:'error', code:'invalid_request' \| 'invalid_gtin' \| 'restricted_gtin'}` | Bad input | Should not happen (client parses first); manual entry |
| 401 | gateway body | Missing or expired token | Refresh the session once and retry, else manual entry |
| 405, 413 | error | Programming error | Manual entry, report to logs |
| 429 | `{code:'rate_limited', retryAfter}` + `Retry-After` | Per-user limit | Manual entry, "Réessayer plus tard" |
| 502 | `{code:'upstream_invalid'}` | Unparseable upstream answer | Manual entry, retry offered |
| 503 | `{code:'upstream_unavailable', retryAfter}` + `Retry-After` | Open Food Facts down, rate-limited or slow, or global budget used | Manual entry, lookup queued for later (section 8.4) |
| 500 | `{code:'internal'}` | Bug, database error | Manual entry, retry offered |

Headers on every answer: `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`,
`Access-Control-Allow-Origin: <the app origin>` (the production Vercel domain and, for preview deployments, a
configured list; never `*`), `Access-Control-Allow-Headers: authorization, apikey, content-type, x-client-info`,
`Access-Control-Allow-Methods: POST, OPTIONS`, `Vary: Origin`.

### 6.5 Timeouts

Total budget inside the function: 7 s. Upstream product call: 4.5 s including the redirect. Fallback host: only if
2.5 s remain. Open Prices: 2.5 s, in parallel, started with the product call; the answer waits for it, so it never delays the
answer beyond the later of the product call and 2.5 s (a price that times out is dropped; the monthly refresh will
add it). Client: 9 s, after which the scan flow shows the manual form with the
lookup queued.

### 6.6 Abuse limits and their storage

Limits (`CATALOG_LOOKUP_LIMITS`): 40 lookups per user per 10 minutes and 300 per user per day (a large shopping
unpack is about 50 new products); at most 10 upstream product calls per minute across all users (Open Food Facts
allows 15 per minute per IP, and the function's outbound IP is shared with other tenants of the platform, so Cellier
keeps a margin); negative cache of 72 hours for codes absent everywhere, so repeated scans of an unknown product do
not reach Open Food Facts; soft cap of 200,000 catalogue rows (estimated from `pg_class.reltuples`), above which
found products are returned but not stored. Only syntactically valid, non-restricted GTINs can reach the gate.

These counters need two small private tables and one function that do not exist in the migrations (section 14,
item 2). Proposed shape:

- `private.catalog_lookup_log (id bigint identity, user_id uuid, gtin text, outcome text, upstream boolean,
  created_at timestamptz default now())`, indexes `(user_id, created_at)` and `(created_at) where upstream`; rows
  older than 2 days deleted by a daily `pg_cron` job.
- `private.catalog_misses (gtin text primary key, checked_at timestamptz, miss_count int)`; entries older than 30 days
  deleted by the same job.
- `private.catalog_lookup_gate(p_user uuid, p_gtin text) returns jsonb`, security definer, executable by
  `service_role` only, which counts, decides and inserts the log row atomically (advisory lock on a constant for
  the global budget).

Until they exist, the function enforces the limits per isolate in memory, which is weak (isolates are recycled and
several run in parallel) and must not ship to more than the owner's household.

### 6.7 When Open Food Facts is down or rate-limits

Nothing breaks: the scan flow shows the manual form at once with whatever the household and device cache know,
saves the product with its GTIN and no catalogue link, and queues the GTIN for a later lookup (section 8.4). A 503 or
429 is never cached as "not found". The catalogue seed means most products in scope are found at step 3 without ever
calling the function.

---

## 7. Prices

### 7.1 Source

Open Prices (Open Food Facts association), licence ODbL. Bulk dumps regenerated daily (verified):
`https://prices.openfoodfacts.org/data/prices.jsonl.gz` (22.8 MB) and `…/locations.jsonl.gz` (1.2 MB). Fields used
(verified on the first lines of the dumps): price rows `product_code`, `type`, `price` (a decimal **string**, for
example `"1.250"`), `price_is_discounted`, `price_per`, `currency`, `date`, `location_id`, `duplicate_of`; locations
`id`, `osm_brand`, `osm_name`, `osm_address_country_code`. Join: `prices.location_id = locations.id`.

### 7.2 Plausible price and selection (`prices.ts`, shared)

Per GTIN (the dump's `product_code` padded to 14 digits):

1. Keep observations with `type = 'PRODUCT'`, `currency = 'EUR'`, location country `FR`, `price_is_discounted` false,
   `duplicate_of` null, `date` not null, not in the future and not older than `PRICE_INGEST_MAX_AGE_DAYS` (548 days),
   `price_per` null or `UNIT` (prices per kilogram or per litre are not pack prices).
2. Absolute bounds: 0.05 € ≤ price ≤ 500 €.
3. Outliers: with 3 or more remaining observations, compute the median of those dated within the last 365 days (or
   of all if fewer than 3 are that recent) and drop observations outside `[median / 3, median × 3]`. With 1 or 2
   observations no relative filter is possible; they are kept but a single observation is used only if it is at most
   365 days old.
4. Chain: `leclerc` if `osm_brand` or `osm_name` contains "leclerc" (case-insensitive, accents folded), `carrefour` if
   it contains "carrefour" (all banners: City, Market, Contact…), else `other`.
5. Choose the most recent observation; when several fall within 7 days of the most recent date, prefer `leclerc`,
   then `carrefour`, then `other`, then the one closest to the median.
6. Output `price_cents` = round(price × 100), `price_observed_on` = date, `price_chain`.

### 7.3 Monthly refresh `scripts/catalogue/refresh-prices.ts`

Command: `pnpm tsx scripts/catalogue/refresh-prices.ts --out .cache/catalogue/prices.csv` then
`psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/catalogue/sql/load-prices.sql`.

- Downloads the two dumps (about 24 MB), streams the JSONL line by line (no DuckDB needed), applies section 7.2, writes
  `PriceRecord` lines for GTINs only (the load ignores codes absent from the catalogue).
- `load-prices.sql`: `\copy` into a temporary table, then
  `update catalog_products c set price_cents = p.price_cents, price_observed_on = p.price_observed_on, price_chain = p.price_chain from p where c.gtin = p.gtin and (c.price_observed_on is null or p.price_observed_on >= c.price_observed_on)`,
  then `update catalog_products set price_cents = null, price_observed_on = null, price_chain = null where price_observed_on < current_date - 548`.
- Checks printed: rows with a price before and after, share by chain, number of outliers dropped, the 10 largest
  relative changes (for a human eye).

### 7.4 On demand in `catalog-lookup`

Only for a product fetched upstream (step 5 of section 6.3), in parallel with the product call:
`GET https://prices.openfoodfacts.org/api/v1/prices?product_code={offCode}&currency=EUR&price_is_discounted=false&duplicate_of__isnull=true&order_by=-created&size=50`
with the same User-Agent and a 2.5 s timeout. The returned items embed `location`, so section 7.2 applies unchanged.
It costs one request per new product, has no documented rate limit, and failing it changes nothing. Rows already in
the catalogue rely on the monthly refresh.

### 7.5 What the user sees

- A catalogue price is shown only if `price_observed_on` is at most 365 days old (`PRICE_DISPLAY_MAX_AGE_DAYS`),
  always with its date and chain: « 3,84 € · relevé le 05/11/2026 chez Carrefour · Open Prices ». Older prices are
  not shown at all.
- When a household product is created from a catalogue row with a displayable price, `price_cents` is copied and
  `price_source` = `'catalog'`. Otherwise both stay null.
- Any user edit of the price sets `price_source` = `'user'`; it wins for good (later catalogue refreshes never
  overwrite a household product, which copies at creation only).

---

## 8. Client lookup chain and scan outcomes

### 8.1 Steps

`lookupScan(code: ScannedCode): Promise<ScanOutcome>` in `src/catalogue/lookup.ts`:

1. **Parse** with `parseGtin`. `invalid_checksum` and `invalid_format` → those outcomes (the continuous scanner
   normally discards them silently and keeps scanning; they surface only for typed codes).
   `restricted_circulation` → `variable_measure`.
2. **Household**: the store's index of household products by `gtin`, tombstones included (the natural key
   `unique (household_id, gtin)` includes tombstones). Live product → `found_household`. Tombstoned product → the
   flow restores it with `product.restore` instead of creating a new one (`restoredFromTombstone: true`), because a
   `product.create` with the same GTIN would violate the unique key.
3. **Device cache**: `catalogue-cache.get(gtin)`; hit → `found_catalogue` via `device_cache`, `lastUsedAt` updated.
   If the entry is older than 30 days and the device is online, step 4 runs in the background to refresh it.
4. **Catalogue select** (online only): `supabase.from('catalog_products').select(CATALOG_SELECT_COLUMNS).eq('gtin', gtin).maybeSingle()`
   with a 4 s timeout; hit → `found_catalogue` via `database`, written to the device cache.
5. **Edge Function** (online and signed in): section 6. `found` → `found_online` (written to the device cache);
   `not_found` → `not_found` with the draft; 429, 5xx, 401 after a refresh attempt, or timeout →
   `lookup_unavailable`.
6. Offline at step 4 or 5 (`navigator.onLine` false, or a network `TypeError`) → `offline`.

Device cache store: object store `catalogue-cache` in the app's IndexedDB database, key path `gtin`, index
`lastUsedAt`. After each insert, if the count exceeds 2,000, delete the 200 entries with the smallest `lastUsedAt`
(one cursor pass). Not-found answers are cached in memory only (per session), so the same unknown code scanned twice
in a row does not call the function twice.

### 8.2 Creating the household product

From a catalogue row: `product.create` with `name`, `brand`, `gtin` and `catalogGtin` = the row's GTIN,
`netQuantity`, `netUnit`, `packCount`, `imageUrl`, `categoryId` chosen as in section 5.4, `priceCents` and
`priceSource` as in section 7.5. The user confirms the quantity to add (stepper, default 1) and may edit any field
before saving. From manual entry: name and category required, quantity optional, `gtin` set to the parsed GTIN when
there is one (not for variable-measure codes), `catalogGtin` null.

### 8.3 Outcomes the scanner UI must handle

| Outcome | Meaning | UI behaviour (French strings live in `fr.ts`) |
|---|---|---|
| `found_household` | Already a household product | Tray item with the product; stepper adds stock; « Déjà dans votre inventaire » |
| `found_catalogue` | Known to Cellier | Tray item pre-filled; one tap to confirm |
| `found_online` | Fetched from Open Food Facts now | Same as above, plus the attribution line (section 12.2) |
| `not_found` | Unknown everywhere | Manual form (name, category, optional quantity), pre-filled from `draft` if any; GTIN kept |
| `variable_measure` | In-store weighed or priced item | Manual form, GTIN not kept; « Article pesé en magasin : saisissez le nom » |
| `invalid_checksum` | Misread | Ignored during continuous scanning; for typed digits « Code invalide, vérifiez les chiffres » |
| `invalid_format` | Not a product barcode | Same as above |
| `offline` | No network, not known locally | Manual form with GTIN kept; « Hors ligne : fiche complétée au retour du réseau » |
| `lookup_unavailable` | Service busy or down | Manual form with GTIN kept; « Base produits indisponible, réessai automatique » |

A lookup must never block the tray: the tray item appears at once with a pending state and is filled when the
outcome arrives (optimistic UI, research 19).

### 8.4 Deferred enrichment

For `offline` and `lookup_unavailable`, the GTIN and the new product id are stored in an IndexedDB store
`pending-lookups` (at most 200 entries). When the app is online and visible, entries are looked up one at a time
(respecting `Retry-After`). On a hit, the client issues one `product.update` that fills only the fields the user left
empty (brand, quantity fields, image, price with `priceSource 'catalog'`) and sets `catalogGtin`; the name and the
category the user chose are never replaced. Entries older than 14 days are dropped.

---

## 9. Manual add: catalogue search

- Function: `public.search_catalog(p_query text, p_limit integer default 20)`, `security invoker`, `stable`. Each
  word of the normalised query must appear as a substring of `search_text` (accent-insensitive, case-insensitive);
  results are ordered by trigram similarity, then popularity, then GTIN; the limit is clamped to 1-50.
- Client: `supabase.rpc('search_catalog', { p_query, p_limit: 20 })`.
  - Minimum length: 3 characters after trimming (`CATALOGUE_SEARCH.minChars`), stricter than the SQL minimum of 2,
    because a `like '%xx%'` pattern of fewer than 3 characters cannot use the trigram index and scans the whole table.
  - Debounce: 200 ms after the last keystroke; the previous request is aborted with an `AbortController`; a 4 s
    timeout; results of an older query are discarded if they arrive late.
  - Before the network answer, the list shows household products matched locally with MiniSearch (diacritic
    folding), then the device-cache rows matched the same way; catalogue results are appended below, de-duplicated
    by GTIN, under a section « Catalogue ».
  - Offline: only the local sections are shown, with « Recherche catalogue indisponible hors ligne ».
  - Selecting a catalogue result goes through section 8.2 (and writes the row to the device cache). The last row of
    the list is always « Créer “<texte saisi>” » for manual entry.
- Every catalogue result shows a small source line (section 12.2).

---

## 10. Seeding pipeline

### 10.1 Environment

- Runs on a developer machine or in GitHub Actions, never in the browser. Tools: DuckDB CLI (1.1 or later, with the
  `httpfs` extension), Node 24 with `tsx` (dev dependency), `psql` 16 or later. Nothing is installed by the scripts.
- Secret: `SUPABASE_DB_URL`, the **session pooler** connection string (port 5432) of the `postgres` role, which
  bypasses row level security like the service role. Never committed; in Actions it is a repository secret. The
  transaction pooler (port 6543) must not be used: temporary tables and `\copy` need one session.
- Working directory `.cache/catalogue/` (git-ignored). Each run writes `.cache/catalogue/run-<yyyy-mm-dd>/`.

### 10.2 Steps

| # | Command | Inputs | Outputs | Checks (the step fails if one fails) |
|---|---|---|---|---|
| 1 | `pnpm tsx scripts/catalogue/fetch-sources.ts` | URLs below | `sources/` files and `manifest.json` (URL, bytes, SHA-256, Last-Modified, Hugging Face commit id) | Every file present, size within ±50 % of the previous run's manifest |
| 2 | `pnpm tsx scripts/catalogue/build-category-rules.ts --offline` | taxonomies from step 1, rules source | rules artefact (only if changed) | Section 5.2 validations |
| 3 | `duckdb -c ".read scripts/catalogue/sql/extract.sql"` (run directory passed in the `CELLIER_RUN_DIR` environment variable, read with `getenv`) | `hf://datasets/openfoodfacts/product-database/food.parquet`, `beauty.parquet` (downloaded), Open Products Facts and Open Pet Food Facts JSONL dumps | `candidates.jsonl` (about 250k-350k lines) and `extract-report.json` | Schema probe (`DESCRIBE`) matches the expected columns; France count printed; non-empty output for each source |
| 4 | `pnpm tsx scripts/catalogue/build-seed.ts --in candidates.jsonl --prices prices.csv --out seed.csv` | step 3, step 5 output if present | `seed.csv` (`SeedRecord`), `seed-report.json` | Rows between 100,000 and 150,000; GTINs unique, 14 digits, valid, not restricted; every `category_key` among the 28; `autre` share below 15 % (warning above 10 %); quantity parsed on at least 60 % of food rows (warning) |
| 5 | `pnpm tsx scripts/catalogue/refresh-prices.ts --out prices.csv` | Open Prices dumps | `prices.csv` | Section 7.3 |
| 6 | `psql "$SUPABASE_DB_URL" -f scripts/catalogue/sql/size-report.sql` | live database | printed sizes | Database below 380 MB before the load; projected catalogue size (current size + new rows × measured bytes per row) below 150 MB |
| 7 | `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/catalogue/sql/load.sql` | `seed.csv` | upserted rows | Transaction commits; counts inserted / updated / unchanged printed |
| 8 | `pnpm tsx scripts/catalogue/reclassify.ts` | live database, step 3 output, dumps | updated categories | Section 5.6 |
| 9 | `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/catalogue/sql/load-prices.sql` | `prices.csv` | updated prices | Section 7.3 |
| 10 | `psql "$SUPABASE_DB_URL" -f scripts/catalogue/sql/post-checks.sql` | live database | report | `analyze` done; `pg_total_relation_size('public.catalog_products')` below 150 MB; 10 fixture GTINs found with the expected category; `search_catalog('nutella', 5)` returns the Ferrero row first |

Source URLs of step 1: the Hugging Face food Parquet is read remotely by DuckDB (`hf://`, 8.04 GB, only the projected
columns are fetched), `beauty.parquet` (67.6 MB) is downloaded, `https://static.openproductsfacts.org/data/openproductsfacts-products.jsonl.gz`
(41 MB) and `https://static.openpetfoodfacts.org/data/openpetfoodfacts-products.jsonl.gz` (19 MB) are downloaded,
the taxonomies of section 5.2, and the Open Prices dumps of section 7.1. All were checked to exist on 2026-11-10.

**Step 3, extract.** One SQL file, four `select`s with the same output columns (`source`, `code`, names, `brands`,
`brands_tags`, `stores_tags`, `quantity`, `product_quantity`, `product_quantity_unit`, `categories_tags`,
`food_groups_tags`, front image key and revision, `lang`, `unique_scans_n`, `popularity_key`, `last_modified_t`),
`union all`, filtered by:

- `list_contains(countries_tags, 'en:france')`, `coalesce(obsolete, false) = false`, `code` matching `^[0-9]{8,14}$`;
- a name present in at least one language;
- a pre-selection to keep the output small: every row with a retailer signal (section 4.4, written in SQL with the
  same lists), every non-food row, and food rows ranked in the top 300,000 by `popularity_key` then `unique_scans_n`.

The `product_name` list is flattened to `name_fr` and `name_any` in SQL; the front image key and `rev` are extracted
from `images` with `list_filter`. Everything else (normalisation, category, scoring) is done in TypeScript, so the
rules are written once. If the remote read of the 8 GB Parquet proves slow or fails, `fetch-sources.ts --download-food`
downloads it once to the run directory (the GitHub-hosted runner has about 14 GB free; the pipeline deletes it after
step 3).

**Step 4, selection.** For each candidate: `normalise`, `mapCategory`, retailer tags, then a score:

```
score = log10(1 + unique_scans_n)
      + 1.5 if store_tags contains leclerc or carrefour
      + 1.0 if the brand is a Leclerc or Carrefour own brand
      multiplied by the category weight:
        1.0  conserves, feculents, epicerie_sucree, petit_dej, cafe, condiments, chocolat, apero, soft, jus, eau,
             vin, biere, surgeles, bebe, animaux, entretien, hygiene, papier, pharmacie
        0.6  laitier, plats, pain, viande, poisson, autre
        0.3  legumes, fruits
      minus 0.3 if no quantity could be parsed
```

The weights encode the brief's bias toward long-conservation groceries and household products without excluding
fresh products. Non-food rows (`obf`, `opf`, `opff`) are capped at 30,000 (best scores first); then all rows are
sorted by score and cut at the target of 130,000 (hard cap 150,000, set by `--max-rows`). The report prints counts by
source, category, retailer tag, quantity method, and the score threshold.

**Step 7, load.** `scripts/catalogue/sql/load.sql`:

```sql
\set ON_ERROR_STOP on
begin;
create temporary table catalog_stage (like public.catalog_products including defaults) on commit drop;
alter table catalog_stage drop column search_text, drop column created_at, drop column updated_at;
\copy catalog_stage (gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count, category_key, category_rule, image_url, source, store_tags, popularity, price_cents, price_observed_on, price_chain, source_modified_at) from '.cache/catalogue/current/seed.csv' with (format csv, header true, null '')

-- content columns: only when the source record is newer (binding rule)
insert into public.catalog_products as c (gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count,
  category_key, category_rule, image_url, source, store_tags, popularity, price_cents, price_observed_on,
  price_chain, source_modified_at)
select gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count, category_key, category_rule,
  image_url, source, store_tags, popularity, price_cents, price_observed_on, price_chain, source_modified_at
from catalog_stage
on conflict (gtin) do update set
  name = excluded.name, brand = excluded.brand, quantity_label = excluded.quantity_label,
  net_quantity = excluded.net_quantity, net_unit = excluded.net_unit, pack_count = excluded.pack_count,
  category_key = excluded.category_key, category_rule = excluded.category_rule, image_url = excluded.image_url,
  source = excluded.source, store_tags = excluded.store_tags, popularity = excluded.popularity,
  source_modified_at = excluded.source_modified_at
where c.source <> 'manual'
  and (c.source_modified_at is null or excluded.source_modified_at > c.source_modified_at);

-- ranking signals derived by Cellier (not source content): refreshed even when the record did not change
update public.catalog_products c
set popularity = s.popularity, store_tags = s.store_tags
from catalog_stage s
where c.gtin = s.gtin and (c.popularity, c.store_tags) is distinct from (s.popularity, s.store_tags);
commit;
analyze public.catalog_products;
```

Prices are loaded by step 9, not by this upsert. `current` is a symbolic link to the run directory. The temporary
table is created in the same session as `\copy`, hence the session pooler. On a first load into an empty table it is
faster to drop `catalog_products_search_trgm_idx` before and recreate it after; `load.sql --first` (a separate file
`load-first.sql`) does that.

**Pruning.** Rows are never deleted by the seed: household products reference them (`catalog_gtin … on delete set
null` would silently unlink them). When the catalogue exceeds 175,000 rows, `scripts/catalogue/sql/prune.sql` deletes
rows not present in the latest seed, not referenced by any household product, with `popularity` below the seed's
score threshold and `updated_at` older than 180 days, least popular first, down to 160,000.

### 10.3 Size estimate and hard cap

Estimate per row, from the column definitions (to be replaced by the measured value after the first load):

| Part | Bytes per row |
|---|---|
| Tuple header, null bitmap, line pointer | about 32 |
| `gtin` (15), `name` (about 45), `brand` (about 15), `quantity_label` (about 10) | about 85 |
| `net_quantity`, `net_unit`, `pack_count`, `category_key`, `category_rule` (about 25) | about 50 |
| `image_url` (about 95: host, folder, key, revision) | about 95 |
| `source`, `store_tags` (empty array about 24, one tag about 40), `popularity` | about 40 |
| Price columns | about 15 |
| `search_text` (normalised name and brand, about 60) | about 60 |
| Three timestamps | 24 |
| **Heap total, with page fill** | **about 430** |
| Primary key B-tree on `gtin` | about 40 |
| Trigram GIN index on `search_text` (60 characters give about 60 trigrams; compressed posting lists) | about 150 to 250 |
| B-tree on `category_key` (deduplicated, low cardinality) | about 10 |
| **Total** | **about 630 to 730** |

For 130,000 rows: about 82 to 95 MB; for the hard cap of 150,000: about 95 to 110 MB. Hard cap on the table:
**150 MB** for `pg_total_relation_size('public.catalog_products')` (heap, TOAST and indexes), checked before (projected)
and after (measured) every load. With the household data, auth tables, the change log and Supabase's own overhead,
this keeps the database under about 300 MB of the 500 MB free-plan limit. If the measured size per row after the
first load exceeds 900 bytes, the target is lowered so the cap holds (the build script takes `--max-rows`).

Egress is not a concern: a search answer is about 20 rows × 600 bytes; a lookup is under 2 KB. Images are served by
Open Food Facts, not by Supabase.

### 10.4 Schedule (GitHub Actions)

Workflow `.github/workflows/catalogue-refresh.yml`: `schedule: cron '17 3 3 * *'` (monthly, 03:17 UTC on the 3rd)
and `workflow_dispatch` (with an input `dry_run` that stops after step 6). Runner `ubuntu-latest`, timeout 120
minutes, secret `SUPABASE_DB_URL`. The workflow installs DuckDB from its release archive and uses the repository's
pnpm and Node versions. Run reports (`manifest.json`, `extract-report.json`, `seed-report.json`, the price report and
post-checks) are uploaded as workflow artefacts and kept 90 days. If step 2 changed the rules artefact, the workflow
does not load: it opens a pull request with the new artefact and stops, so a rules change is always reviewed and the
Edge Function is redeployed with the same artefact before the catalogue is re-mapped.

---

## 11. Data flows into household products (summary)

| Household product field | From catalogue | After creation |
|---|---|---|
| `name`, `brand`, `net_quantity`, `net_unit`, `pack_count`, `image_url` | Copied | Editable, never refreshed from the catalogue |
| `category_id` | Household category with `template_key = category_key` | Editable |
| `price_cents`, `price_source` | Copied if at most 365 days old, `'catalog'` | User edit → `'user'`, wins |
| `gtin`, `catalog_gtin` | Both = catalogue GTIN | `catalog_gtin` set null if the catalogue row is ever deleted |

---

## 12. Licences and attribution

### 12.1 What applies

| Data | Licence | Verified |
|---|---|---|
| Open Food Facts family database (all four) | Open Database License (ODbL) 1.0 | Open Food Facts licence tutorial and terms of use page |
| Individual contents (each product's facts) | Database Contents License (DbCL) 1.0 | Same pages |
| Product photos | Creative Commons Attribution-ShareAlike (the linked deed is 3.0); covers only the photo and its contributors, not the brand's packaging design or trademarks | Same pages |
| Open Prices database | ODbL; "mention the source of your data", "avoid combining non free data you can't release legally as open data" | Open Prices data guide |

The per-site licence pages of Open Beauty Facts, Open Products Facts and Open Pet Food Facts were not read; they run on
the same platform and their dumps are published on the same terms (research 03). Treat them as ODbL until shown
otherwise (section 14, item 9).

### 12.2 Attribution duties and exact French text

Terms of use (verified): re-users must mention the licence and attribute authorship to Open Food Facts with a link to
openfoodfacts.org, and when the data concerns a specific product, link to that product's page.

**About screen** (« Réglages › À propos › Données produits »), verbatim:

> Les informations produits (noms, marques, quantités, catégories d'origine et photos) proviennent d'Open Food Facts,
> Open Beauty Facts, Open Products Facts et Open Pet Food Facts, des bases de données collaboratives, libres et
> ouvertes. © Les contributeurs d'Open Food Facts.
>
> Base de données : Open Database License (ODbL) 1.0. Contenus : Database Contents License (DbCL) 1.0.
> Photos : Creative Commons Attribution – Partage dans les mêmes conditions (CC BY-SA) 3.0 ; les marques et
> emballages visibles sur les photos restent la propriété de leurs titulaires.
>
> Les prix indicatifs proviennent d'Open Prices, base ouverte de relevés de prix d'Open Food Facts, sous licence ODbL.
> Ils peuvent être anciens ou inexacts.
>
> Le catalogue de Cellier est une base dérivée de ces données. Il est disponible sous la même licence (ODbL) :
> [Télécharger le catalogue].
>
> Cellier n'est ni affilié à Open Food Facts, ni à E.Leclerc, ni à Carrefour, ni approuvé par eux.

with links on « Open Food Facts » (`https://world.openfoodfacts.org`), the three sister names, each licence name
(the official licence URLs), « Open Prices » (`https://prices.openfoodfacts.org`) and « Télécharger le catalogue »
(section 12.3).

**Where the data is shown**:

- Product sheet and the confirmation sheet after a scan, when the product came from the catalogue
  (`catalogGtin` not null): a footnote line « Source : Open Food Facts · ODbL » (the database name follows
  `source`: Open Beauty Facts, Open Products Facts, Open Pet Food Facts), linking to the product page
  `https://world.open{food|beauty|products|petfood}facts.org/product/{offCode}`.
- Under a product photo: « Photo : contributeurs Open Food Facts · CC BY-SA » (same database name rule).
- Next to a catalogue price: « Open Prices » in the price line of section 7.5.
- Catalogue section of the search results: one footer line « Catalogue : Open Food Facts et bases sœurs · ODbL ».
- A household product the user created by hand, or whose fields were all edited, shows no attribution.

### 12.3 Share-alike consequences

- `public.catalog_products` is a **derivative database** of the Open Food Facts family (selection, normalisation,
  derived fields such as the category mapping and parsed quantities) and of Open Prices. Showing it to users in the
  app is a public use of a produced work, so Cellier must offer the derivative database itself under ODbL, or the
  means to re-create it (ODbL section 4.6).
- Chosen way (proposal, section 14 item 8): the monthly workflow exports the table
  (`\copy (select gtin, name, brand, quantity_label, net_quantity, net_unit, pack_count, category_key, category_rule, image_url, source, store_tags, popularity, price_cents, price_observed_on, price_chain, source_modified_at from public.catalog_products order by gtin) to … csv header`,
  gzip, about 10 MB) and publishes it with a README stating the ODbL, the sources and the build method (the
  `scripts/catalogue/` code and the rules artefact) as a GitHub release asset of a public repository, or in a public
  Supabase Storage bucket. The About screen links to it.
- Keep the catalogue in its own table and keep household data out of it. Household tables (products, stock, movements)
  are independent works that only copy individual contents (DbCL) at creation; they are not offered, published or
  shared, and they must never be merged back into the catalogue.
- Nothing that is not openly licensed may enter `catalog_products` (no scraped retailer data, no commercial barcode
  API, no user input), otherwise the table could no longer be published under ODbL.

### 12.4 What the app must not do

1. Call Open Food Facts or Open Prices from the PWA (binding: only the Edge Function and the scripts call them).
2. Write user-entered products into the catalogue, or send them to Open Food Facts, without an explicit, separate
   contribution feature and the user's consent. (`source = 'manual'` is reserved for such a future feature and is
   never written by this design.)
3. Show catalogue data without the attribution of section 12.2, or remove the links.
4. Suggest that Open Food Facts, E.Leclerc or Carrefour endorse Cellier; use their logos or trademarks as app
   branding.
5. Copy, crop, re-host or alter product photos (only hot-link the published 200 px rendition and cache it in the
   service worker).
6. Scrape retailer websites or call their internal APIs, or use paid scraping services (research 07).
7. Exceed the Open Food Facts rate limits or send requests without the identifying User-Agent.
8. Present prices as current shelf prices: always show the observation date and the chain, never a price older than
   365 days.

---

## 13. Verification log (2026-11-10)

| Item | How | Result |
|---|---|---|
| Universal endpoint URL and behaviour | `curl -A "Cellier/0.1 (…)"` on `/api/v3/product/{code}?product_type=all&fields=…` for Nutella, Le Chat detergent, an absent and an invalid code | Food: 200, `status: success`. Detergent: 302 to `world.openproductsfacts.org` with the query preserved, then 200. Absent valid code: **HTTP 404**, `status: failure`, `result.id: product_not_found`. Invalid code: 404 with `invalid_code` |
| `fields` on v3 | Same calls | Only requested fields are returned; `food_groups_tags`, `brands_tags`, `generic_name_fr`, `last_modified_t`, `unique_scans_n`, `product_type` available |
| 14-digit code accepted | `/api/v3/product/03017620422003` | 200, `success_with_warnings`, `different_normalized_product_code` |
| Rate limits and User-Agent | WebFetch of `openfoodfacts.github.io/openfoodfacts-server/api/` | 15 product reads per minute per IP, 10 searches per minute per IP; global limits answer 503; User-Agent `AppName/Version (ContactEmail)`; v3 (latest 3.6) recommended. The page does not mention `product_type=all` (behaviour verified live instead) |
| Parquet schema | Hugging Face dataset tree API and `datasets-server` info | `food.parquet` 8.04 GB, `beauty.parquet` 67.6 MB, `petfood.parquet` 8.3 MB, no Open Products Facts Parquet. `product_name` and `generic_name` are lists of `{lang, text}`; `product_quantity` is a string; `images` is a list of `{key, imgid, rev, sizes…}`; `brands_tags`, `stores_tags`, `countries_tags`, `categories_tags`, `food_groups_tags` exist; **no** `pnns_groups_*`, `categories_hierarchy` or `product_type` columns |
| Sister dumps | `curl -I` | Open Products Facts JSONL 41 MB and CSV 6.4 MB, Open Pet Food Facts JSONL 19 MB, Open Beauty Facts JSONL 106 MB, all regenerated 2026-11-10 |
| Open Prices dumps | First lines of `prices.jsonl.gz` and `locations.jsonl.gz` | Field names as in section 7.1; `price` is a decimal string; join on `location_id` |
| Taxonomy files | Download and inspection | No synonym field (names only), hence the slug-based `synonyms` map; `fr:liquide-vaisselle` is a canonical Open Products Facts tag |
| Food groups | `food_groups.full.json` | Level 1 and 2 tags equal the PNNS groups in slug form |
| Licences | WebFetch of the licence tutorial, the terms of use and the Open Prices data guide | As in section 12.1 and 12.2 |
| GS1 RCN-8 | Web search summarising the GS1 GTIN-8 synopsis and General Specifications | GS1-8 prefixes 000-099 and 200-299 are restricted circulation within a company (section 3.4); gs1.org documents themselves were not opened |

Not verified, and designed so it does not matter: the exact Open Food Facts behaviour for a non-food product when the
food host is down (the fallback is best effort); the brand slugs of section 4.4 other than `marque-repere` and
`carrefour` (the seed report exposes a slug that matches nothing); the per-row size (measured after the first load,
with the cap enforced on the measurement); `pnns_groups_1` exact strings (only used when food groups are absent).

---

## 14. Issues for the architecture owner

1. **No row level security on `catalog_products` and `category_templates`.** Supabase exposes tables in `public` to
   the `anon` and `authenticated` roles through PostgREST with the default grants; without RLS any signed-in (or
   anonymous) client can insert, update or delete catalogue rows. Add `enable row level security`, a `select` policy
   `to authenticated using (true)` on both, and revoke `insert, update, delete` from `anon, authenticated`.
2. **Missing database objects for the Edge Function**: the rate-limit log, the negative cache and the gate function of
   section 6.6, and a way to run the conditional upsert of section 6.3 (`private.catalog_upsert(jsonb)` executable by
   `service_role`), since PostgREST's upsert cannot express "only when `source_modified_at` is newer".
3. **The catalogue keeps no input tags**, so re-applying a rule change needs the dumps again (section 5.6), and rows
   added by the Edge Function for products absent from the dumps cannot be re-mapped. Options: add
   `category_tags text[]` (about 150 bytes per row, about 20 MB at 130k rows) or accept the dump-based procedure.
   Also there is no rules-version column; the design encodes it in `category_rule` as a `v<N>|` prefix, which slightly
   changes the trace format of the binding example (`tier2:en:red-wines` becomes `v1|tier2:en:red-wines`).
4. **Binding upsert rule versus derived columns.** "Update only when `source_modified_at` is newer" would freeze
   Cellier-derived values (category, popularity, store tags) on unchanged records. The design keeps the rule for
   content columns and refreshes the derived ones separately (section 10.2 step 7, section 5.6). Confirm.
5. **Restricted ranges are incomplete.** Besides 02 and 20-29, GS1 reserves EAN-8 prefixes 0 and 2 (RCN-8) and
   EAN-13 prefix 04 for company-internal use. Implemented behind a flag, off by default (section 3.4). Decide.
6. **Scanner configuration does not deliver UPC-E.** Research 08 restricts zxing formats to EAN-13, EAN-8 and UPC-A and
   its checksum guard rejects UPC-E, while the binding chain includes UPC-E. The scanner must enable `UPCE`, pass the
   format to `parseGtin`, and drop its own checksum function.
7. **Shared outbound IP and the 15-per-minute limit.** Open Food Facts limits product reads per IP; Edge Functions
   egress from shared platform addresses, so other Supabase customers may consume the same budget and Cellier could
   see 429/503 it did not cause. Mitigations in the design: the seed (most lookups end at step 3), a 10-per-minute
   global budget, the negative cache, and graceful manual entry. Consider writing to `reuse@openfoodfacts.org` to
   declare the app and its User-Agent.
8. **ODbL share-alike requires publishing the catalogue.** The design proposes a monthly public export (GitHub release of
   a public repository or a public Storage bucket, about 10 MB) linked from the About screen. Choose where; a private
   repository alone does not satisfy it.
9. **Sister-database licences** (Open Beauty Facts, Open Products Facts, Open Pet Food Facts) were not read on their own
   sites; assumed identical (ODbL / DbCL / CC BY-SA). Confirm before release.
10. **`search_catalog` with short words.** The function accepts a 2-character query and words of any length; a
    `like '%xy%'` pattern cannot use the trigram index and scans the table (150k rows, tens of milliseconds, acceptable
    but wasteful). The client requires 3 characters; consider enforcing `char_length(w) >= 3` for at least one word
    in SQL too.
11. **Category quality is untested on a random sample.** Research 06 validated 15 hand-picked products, two of them
    fixed after the fact. Before the first seed, add 100 random French products to the regression fixture and record
    the share of `autre`.
12. **`products.price_cents` has an upper bound (10,000,000) that `catalog_products.price_cents` lacks.** Harmless
    with the 500 € plausibility bound, but the two checks should match.
