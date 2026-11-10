# 04 - Open Prices API (Open Food Facts price database)

Research date: 2026-11-10. All "verified" items were checked against the live API (prices.openfoodfacts.org) on that date unless marked otherwise. Items marked **UNVERIFIED** were not confirmed.

## 1. Summary

- Base URL: `https://prices.openfoodfacts.org/api/v1`. The OpenAPI schema is at `/api/schema` (OpenAPI 3.0.3, `info.version` is the placeholder `0.0.0 (api)`, so there is no semantic version). Swagger UI is at `/api/docs`.
- Anonymous GET works on `/prices`, `/prices/stats`, `/locations`, `/products`. Writes need a bearer token.
- CORS is open for browsers: `Access-Control-Allow-Origin` echoes the request Origin, and preflight succeeds.
- Coverage is thin for France. Of the 8 test barcodes, 7 have at least one French-located price, but only 4 of 8 have one dated in the last 6 months. Global totals look large (342,780 prices), but the French share is modest.
- Bulk dumps exist: `prices.jsonl.gz` (about 22.8 MB), regenerated daily. Licence is ODbL, so attribution is required.
- Store filtering by brand does not work server-side. Use `location_id__in` with IDs resolved from `/locations`.

## 2. Endpoints (from the live OpenAPI schema)

| Method | Path | Use |
|---|---|---|
| GET | `/api/v1/prices` | Paginated price list (main endpoint) |
| GET | `/api/v1/prices/stats` | Aggregates (`price__count`, `price__min`, `price__max`, `price__avg`) with the same filters |
| GET | `/api/v1/prices/{id}` | One price |
| GET | `/api/v1/prices/{id}/history` | Edit history |
| GET | `/api/v1/locations` | Store list (filters: `osm_address_country__like`, `osm_name__like`, `price_count__gte`, ...) |
| GET | `/api/v1/locations/{id}` | One store |
| GET | `/api/v1/locations/nearby` | Stores near a point |
| GET | `/api/v1/products` | Products that have prices (`code`, `price_count__gte`) |
| GET | `/api/v1/products/code/{code}` | Product by EAN (returns `price_count`, `product_name`, `brands`) |
| GET | `/api/v1/stats` | Global counters (see section 7) |
| GET | `/api/v1/status` | Returns `{"status":"running"}` |
| POST | `/api/v1/prices` | Create a price (auth) |
| POST | `/api/v1/auth` | Login, returns a token (**UNVERIFIED** exact body; docs say "generate a token through the dedicated Open Prices endpoint") |

Source: https://prices.openfoodfacts.org/api/schema (verified), https://prices.openfoodfacts.org/api/docs (Swagger UI, verified HTTP 200).

## 3. Filters on `GET /api/v1/prices` (verified in schema, and tested live where noted)

Pagination: `page` (1-based), `size`. Live: `size=100` returns 100 items; `size=1000` is silently clamped to 100. Response has `pages` and `total`, so the full set is `pages` requests.

Ordering: `order_by` (free string). Live: `order_by=-created` works. `order_by=-date` returned `date: null` on the top items, so ordering by proof date is unreliable (**UNVERIFIED** why).

Filters that matter for Cellier:

| Need | Param | Notes |
|---|---|---|
| Barcode | `product_code=3017620422003`, or `product_code__in=a,b,c` | Live: works, matches `products/code` `price_count` |
| Store | `location_id=33`, `location_id__in=1,2,3` | Live: `location_id__in` works (61,221 results for the 223 E.Leclerc IDs). Long lists fail (a 12.7 KB URL with 2,666 IDs returned non-JSON, probably nginx 414; **UNVERIFIED** exact limit) |
| Store by name | `location__osm_name__contains` | Schema lists it, but live it returned 0 for "Leclerc" and "Carrefour", which do have prices. **Do not rely on it** |
| OSM brand | none on `/prices` | `osm_brand=Carrefour` is silently ignored (returned the unfiltered total) |
| Country | none on `/prices` | Use `location.osm_address_country_code` client-side, or resolve IDs from `/locations` |
| Geo | `lat`, `lon`, `radius_km` (all three together) | Live: Paris, 20 km returned 81,485 prices |
| Currency | `currency=EUR` | Live: 250,032 EUR prices |
| Date | `date`, `date__gte`, `date__lte`, `date__gt`, `date__lt`, `date__month`, `date__year` | Live: `date__gte=2026-07-01` returned 66,502. Filter is on the proof `date`, not `created` |
| Quality | `price_is_discounted=false`, `discount_type`, `kind=COMMUNITY\|CONSUMPTION`, `proof__type=PRICE_TAG\|RECEIPT\|GDPR_REQUEST\|SHOP_IMPORT`, `duplicate_of__isnull=true` | Exclude duplicates and discounted prices for "typical" |
| Price range | `price__gte`, `price__lte` | |
| Category | `category_tag`, `product__categories_tags__contains` | |

## 4. Response shape (trimmed, real JSON)

Live call: `GET /api/v1/prices?product_code=3017620422003&size=1` (Nutella). Trimmed to the fields Cellier needs. The full response also has nested `product`, `location`, `proof` objects.

```json
{
  "items": [
    {
      "id": 2207,
      "product_id": 238068,
      "location_id": 33,
      "proof_id": 1223,
      "type": "PRODUCT",
      "product_code": "3017620422003",
      "product_name": null,
      "price": 3.21,
      "price_is_discounted": false,
      "price_without_discount": null,
      "discount_type": null,
      "price_per": null,
      "currency": "EUR",
      "location_osm_id": 84818012,
      "location_osm_type": "WAY",
      "date": "2024-01-11",
      "owner": "jbieber",
      "tags": [],
      "created": "2024-01-11T19:02:41.474531Z",
      "updated": "2025-09-09T10:46:16.951783Z",
      "duplicate_of": null,
      "location": {
        "id": 33,
        "type": "OSM",
        "osm_name": "Carrefour Villeurbanne",
        "osm_brand": "Carrefour",
        "osm_tag_key": "shop",
        "osm_tag_value": "supermarket",
        "osm_address_city": "Villeurbanne",
        "osm_address_country": "France",
        "osm_address_country_code": "FR",
        "osm_lat": 45.7695968,
        "osm_lon": 4.8835683,
        "price_count": 1778
      },
      "product": {
        "id": 238068,
        "code": "3017620422003",
        "product_name": "Nutella",
        "price_count": 168
      },
      "proof": {
        "id": 1223,
        "type": "PRICE_TAG",
        "date": "2024-01-11",
        "currency": "EUR"
      }
    }
  ],
  "page": 1,
  "pages": 17,
  "size": 10,
  "total": 168
}
```

TypeScript type (derived from the live response and the schema's `PriceFull`; fields not seen in a live response are marked):

```ts
// Open Prices API v1 - GET /api/v1/prices item (derived 2026-11-10)
export interface OpenPriceLocation {
  id: number;
  type: 'OSM' | 'ONLINE';
  osm_id: number | null;
  osm_type: 'NODE' | 'WAY' | 'RELATION' | null;
  osm_name: string | null;
  osm_display_name: string | null;
  osm_tag_key: string | null;
  osm_tag_value: string | null;
  osm_brand: string | null;             // e.g. "Carrefour", "E.Leclerc", "Centre Commercial E.Leclerc"
  osm_brand_logo_url: string | null;
  osm_address_postcode: string | null;
  osm_address_city: string | null;
  osm_address_country: string | null;   // "France"
  osm_address_country_code: string | null; // "FR"
  osm_lat: number | null;
  osm_lon: number | null;
  price_count: number;
  product_count: number;
}

export interface OpenPriceProduct {
  id: number;
  code: string;                         // EAN
  source: 'off' | 'obf' | 'opf' | 'opff';
  product_name: string | null;
  brands: string | null;
  brands_tags: string[];
  quantity: string | null;
  product_quantity: number | null;
  product_quantity_unit: string | null;
  image_url: string | null;
  price_count: number;
  location_count: number;
}

export interface OpenPriceProof {
  id: number;
  type: 'PRICE_TAG' | 'RECEIPT' | 'GDPR_REQUEST' | 'SHOP_IMPORT';
  date: string | null;                  // YYYY-MM-DD
  currency: string;
  file_path: string | null;
  mimetype: string | null;
  draft: boolean;
}

export interface OpenPrice {
  id: number;
  product_id: number | null;
  location_id: number;
  proof_id: number | null;
  type: 'PRODUCT' | 'CATEGORY';
  product_code: string | null;          // EAN, present when type = PRODUCT
  product_name: string | null;
  category_tag: string | null;
  labels_tags: string[] | null;
  origins_tags: string[] | null;
  price: number;                        // in `currency`, per the product as sold
  price_is_discounted: boolean;
  price_without_discount: number | null;
  discount_type: 'EXPIRES_SOON' | 'LOYALTY_PROGRAM' | 'OTHER' | 'PICK_IT_YOURSELF' | 'QUANTITY' | 'SALE' | 'SEASONAL' | 'SECOND_HAND' | null;
  price_per: 'KILOGRAM' | 'LITER' | 'UNIT' | null;  // enum values from schema PricePerEnum; UNVERIFIED exact set
  currency: string;                     // ISO 4217, "EUR" for France
  location_osm_id: number;
  location_osm_type: 'NODE' | 'WAY' | 'RELATION';
  date: string | null;                  // proof date, YYYY-MM-DD. Can be null (observed)
  receipt_quantity: number | null;
  owner: string | null;
  owner_comment: string | null;
  source: string | null;
  tags: string[];
  created: string;                      // ISO 8601
  updated: string;
  duplicate_of: number | null;
  kind?: 'COMMUNITY' | 'CONSUMPTION';   // filter exists (schema); not seen in live item (UNVERIFIED)
  location: OpenPriceLocation | null;
  product: OpenPriceProduct | null;
  proof: OpenPriceProof | null;
}

export interface OpenPricePage {
  items: OpenPrice[];
  page: number;
  pages: number;
  size: number;   // capped at 100 live
  total: number;
}
```

## 5. Restrict to France and to E.Leclerc / Carrefour

**France.** `GET /api/v1/locations?osm_address_country__like=France&size=100&page=N` returns 2,666 locations, of which 2,482 have at least one price. Use `osm_address_country_code === 'FR'` on each price's `location` to filter client-side. There is no country parameter on `/prices`.

**E.Leclerc.** Resolve IDs client-side: fetch the France location list and keep rows whose `osm_brand` or `osm_name` contains "leclerc" (case-insensitive). Live result: 223 locations. Then `GET /api/v1/prices?location_id__in=<ids comma-separated>`. Keep batches small (about 200 IDs or fewer; **UNVERIFIED** limit) and merge results.

**Carrefour.** Same approach with "carrefour". Live result: 405 locations, which includes Carrefour City, Carrefour Market, and similar banners. Filter on `osm_brand` if the banner must be exact.

`osm_brand` on `/locations` is not filterable server-side (`osm_brand=` is ignored) and `location__osm_name__contains` on `/prices` returned 0 for both banners. Cache the store ID list in the app or pre-load it from the dump.

## 6. Deriving a "typical price" for a barcode

Recommended, based on the live API:

```ts
// Typical price for one EAN in France, last N months.
// Uses only server filters that were verified live, then filters country client-side.
async function typicalPrice(ean: string, monthsBack = 6) {
  const since = new Date(Date.now() - monthsBack * 30.4 * 86400e3).toISOString().slice(0, 10);
  const base = 'https://prices.openfoodfacts.org/api/v1/prices';
  const items: OpenPrice[] = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({
      product_code: ean,
      currency: 'EUR',
      'date__gte': since,
      price_is_discounted: 'false',
      'duplicate_of__isnull': 'true',
      size: '100',
      page: String(page),
    });
    const res = await fetch(`${base}?${q}`);      // anonymous GET, CORS OK
    const body: OpenPricePage = await res.json();
    items.push(...body.items);
    if (page >= body.pages) break;
  }
  const fr = items.filter(i => i.location?.osm_address_country_code === 'FR' && i.date);
  const prices = fr.map(i => i.price).sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  const latest = fr.reduce((a, b) => (a.date! > b.date! ? a : b));
  return { median, n: prices.length, latest: { price: latest.price, date: latest.date, store: latest.location?.osm_brand } };
}
```

Notes:
- `latest` should use `date` (proof date), not `created`.
- `price_is_discounted=false` removes promo prices. Verify this filter in the browser before relying on it (**UNVERIFIED** that it excludes all promos).
- For Cellier, a store-specific price (E.Leclerc only) can be built the same way with `location_id__in` instead of the country filter.

## 7. Coverage (live counts, 2026-11-10)

Global: `GET /api/v1/prices/stats` returns `price__count` 342,780 (avg price 24.71; the average is skewed by outliers, max 604,000). `GET /api/v1/stats` returns `price_location_country_count` 128, `product_count` 4,657,440 (products in OFF, not only those with prices).

France (from `/locations`, client-side):

| Metric | Value | Method |
|---|---|---|
| FR locations | 2,666 | `osm_address_country__like=France` |
| FR locations with ≥1 price | 2,482 | `price_count__gte=1` |
| FR price total (approx.) | 219,904 | Sum of location-level `price_count`. Exact count not obtained (ID list too long for one URL) |
| E.Leclerc FR locations | 223 | name/brand match |
| E.Leclerc prices (exact) | 61,221 | `location_id__in` |
| E.Leclerc prices last 6 months | 7,341 | `location_id__in` + `date__gte=2026-05-10` |
| Carrefour FR locations | 405 | name/brand match |
| Carrefour prices (exact) | 35,877 | `location_id__in` |
| Carrefour prices last 6 months | 6,470 | same |

Test barcodes. "Total" = all countries. "FR" = `location.osm_address_country_code === 'FR'`. "6m" = FR and `date >= 2026-05-10`. Medians are over FR prices (all dates, and 6 months). Source: full pagination of `/prices?product_code=…&size=100`, script saved at the scratchpad (not in the repo).

| EAN | Product (OFF name) | Total | FR | FR 6m | Median FR all | Median FR 6m | Latest FR (date, price) |
|---|---|---|---|---|---|---|---|
| 3017620422003 | Nutella | 168 | 159 | 13 | 3.54 | 3.84 | 2026-11-05, 4.05 |
| 3274080005003 | isabelle (Cristaline water) | 17 | 17 | 0 | 0.19 | - | 2026-02-22, 0.18 |
| 5449000000996 | Coca-Cola Original | 2 | 1 | 0 | 0.99 | - | 2024-11-15, 0.99 |
| 3228857000166 | 100% mie complet (Harrys) | 24 | 24 | 4 | 1.99 | 2.25 | 2026-08-19, 2.55 |
| 3168930010265 | Cruesli mélange de noix | 26 | 26 | 2 | 3.95 | 3.29 | 2026-08-24, 3.12 |
| 3083681071403 | (not in DB) | 0 | 0 | 0 | - | - | - |
| 3760020507350 | Pur beurre de cacahuète (Jardin Bio) | 25 | 24 | 4 | 4.17 | 3.93 | 2026-09-16, 3.99 |
| 8000500310427 | Biscuits Nutella x22 | 49 | 46 | 0 | 3.09 | - | 2026-04-30, 3.00 |

Result for the 8 barcodes:
- At least one price, any country: 7 of 8 (87.5%).
- At least one FR price: 7 of 8 (87.5%).
- At least one FR price in the last 6 months: 4 of 8 (50%).
- Medians for 3274080005003 and 5449000000996 are not meaningful (few or old prices). The Isabelle price is 0.19, which looks like a per-unit or mismatched product, so treat it as suspicious.

Caveat: the sample is 8 common barcodes, so it is biased toward popular products (Nutella has 168 prices). Coverage for the long tail (store brands, fresh produce) is probably much lower. **UNVERIFIED** on a random sample.

## 8. Rate limits

- No rate limit is documented in the schema, the API guide page (https://openfoodfacts.github.io/open-prices/guides/API/), or the docs page. The guide says only "Some endpoints require authentication."
- Live: 30 sequential GETs to `/api/v1/status` all returned 200. No `X-RateLimit-*` or `Retry-After` headers were seen on `/prices` responses.
- Third-party (dltHub) quotes OFF product-API limits (100/min for product GETs, 10/min for search). Those are for the main OFF product database, not Open Prices, and are **UNVERIFIED** here.
- Be polite: cache, batch by `location_id__in`, and pre-load dumps for the bulk path.

## 9. CORS from a browser

Verified with `Origin: https://example.com`:
- `GET /api/v1/prices?size=1` returns `access-control-allow-origin: https://example.com` and `access-control-allow-credentials: true`.
- Preflight `OPTIONS` returns 200 with `access-control-allow-methods: DELETE, GET, OPTIONS, PATCH, POST, PUT`, `access-control-allow-headers: accept, authorization, content-type, user-agent, x-csrftoken, x-requested-with, x-user-agent`, and `max-age: 86400`.

So a PWA can call the API directly from the browser. Note `allow-credentials: true` with an echoed origin, which means any site can read the public data; that is fine for public reads.

## 10. Authentication

- Reads: anonymous GET works (verified live on `/prices`, `/prices/stats`, `/locations`, `/products`, `/stats`, `/status`).
- Writes: `POST` and `PATCH`/`DELETE` need a token. Schema security scheme is HTTP bearer (`Authorization: Bearer <token>`). Token is generated via the Open Prices auth endpoint; the exact path and body are **UNVERIFIED** (the schema lists `/api/v1/auth`, but I did not call it).
- Pre-production host is `prices.openfoodfacts.net` (per the API guide). Not used here.

## 11. Licence

- Data: **ODbL** (Open Database Licence). Shown as the licence tag on the Hugging Face dataset page and on the data guide (https://openfoodfacts.github.io/open-prices/guides/data/). Requirements: attribution to Open Food Facts / Open Prices, and share-alike on derived databases. The guide also says "contributing back any product you add using this SDK."
- Code: repo states AGPL-3.0 (https://github.com/openfoodfacts/open-prices). **UNVERIFIED** exact licence text in the repo; the fetch summary is the only source.

## 12. Bulk dumps (pre-loading)

Source: https://openfoodfacts.github.io/open-prices/guides/data/ (regenerated daily by `dump_db_task`).

| Dataset | URL | Format | Size (gzip) | Last-Modified |
|---|---|---|---|---|
| Prices | https://prices.openfoodfacts.org/data/prices.jsonl.gz | gzipped JSONL | 22,786,178 B (~22.8 MB) | 2026-11-09 23:08:50 GMT |
| Products (only with ≥1 price) | https://prices.openfoodfacts.org/data/products.jsonl.gz | gzipped JSONL | 20,329,734 B (~20.3 MB) | 2026-11-09 23:14:30 GMT |
| Locations | https://prices.openfoodfacts.org/data/locations.jsonl.gz | gzipped JSONL | 1,246,645 B (~1.2 MB) | 2026-11-09 23:11:41 GMT |
| Proofs | https://prices.openfoodfacts.org/data/proofs.jsonl.gz | gzipped JSONL | not checked | not checked |
| Hugging Face | https://huggingface.co/datasets/openfoodfacts/open-prices | Parquet | not stated | not stated |

- Hugging Face dataset card: 343k rows, licence tag `odbl`, size category 100K-1M (verified via fetch summary).
- Dump field names and join keys (prices to locations by `location_osm_id`/`location_id`) are **UNVERIFIED**: I did not download the file. The uncompressed size is **UNVERIFIED**.
- Plan for Cellier: on a schedule, download `locations.jsonl.gz` (about 1.2 MB) to build the France and store ID list, then `prices.jsonl.gz` (about 23 MB) for offline lookup by EAN, filtering `country_code === 'FR'`. Check sizes before shipping to the PWA.

## 13. Alternative free price sources for France

- **Open Food Facts itself**: no prices, product data only.
- **Caddy Malin observatory** (Licence Ouverte 2.0, Etalab): an independent household panel of French grocery prices built from real receipts, with about 15,000 EAN-level observations, published monthly. Found in search results; the site (caddymalin.fr) did not resolve from this environment, so the licence and access method are **UNVERIFIED**. It is aggregated panel data, not a live shelf-price database. Source: https://www.data.gouv.fr/organizations/caddy-malin (search result).
- **AGRIBALYSE (ADEME)**: environmental impact data, Etalab licence, not prices. Source: https://www.data.gouv.fr/dataservices/api-impacts-environnementaux-agribalyse-r
- **Fuel price open data (Etalab)**: exists but is fuel only, not food. Not relevant.
- No official French government shelf-price API for barcodes was found. **UNVERIFIED** that none exists (INSEE and DGCCRF were not checked in depth).

## 14. Surprises

1. `/prices` has no `osm_brand` filter, and `location__osm_name__contains` silently returns 0 for real stores. Store filtering must go through `location_id__in`.
2. Only about 4 of 8 common barcodes have a FR price in the last 6 months, so the "last N months" median often has no data.
3. `size` is capped at 100 and the API silently clamps larger values.
4. `order_by=-date` puts `date: null` rows first (**UNVERIFIED** cause).
5. A 12.7 KB `location_id__in` query (2,666 IDs) failed with a non-JSON response.
6. Some prices look like outliers (Isabelle at 0.19 EUR; `price__max` = 604,000 globally). Filter by a sane range before use.

## 15. Sources

- API schema (verified): https://prices.openfoodfacts.org/api/schema
- Swagger UI (verified HTTP 200): https://prices.openfoodfacts.org/api/docs
- API guide: https://openfoodfacts.github.io/open-prices/guides/API/
- Data guide and dumps: https://openfoodfacts.github.io/open-prices/guides/data/
- Repo: https://github.com/openfoodfacts/open-prices
- Hugging Face dataset: https://huggingface.co/datasets/openfoodfacts/open-prices
- Caddy Malin (search result, UNVERIFIED): https://www.data.gouv.fr/organizations/caddy-malin
