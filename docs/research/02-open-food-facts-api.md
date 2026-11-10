# Open Food Facts API for barcode lookup

Research date: 2026-11-10. Live calls were made against `https://world.openfoodfacts.org` from a shell (no browser). Items marked **UNVERIFIED** were not confirmed by a live call or by a primary page that I could open.

## 1. Recommendation

- **Use v2 for the product read** with the path `/api/v2/product/{barcode}.json`. It is the version I hit live and it returns the exact shape below. The docs call v2 "deprecated but still supported" and v3 (latest v3.6) "current and recommended for new integrations" (https://openfoodfacts.github.io/openfoodfacts-server/api/).
- **Pin v3.6 only if we want the newer envelope.** `GET /api/v3.6/product/{barcode}` works live. Its `product` object carries only the requested fields. Its envelope is `{code, errors, product, result, status: "success", warnings}`, which differs from v2's `status: 1`.
- The v2 read path is the one to implement now. Re-check the v3 field selection before switching, because the `fields` behaviour differs by version.

## 2. Endpoints

| Purpose | URL | Verified |
|---|---|---|
| Product by barcode (v2, recommended now) | `GET https://world.openfoodfacts.org/api/v2/product/{barcode}.json?fields=...` | Live, 200 |
| Product by barcode (v3.6) | `GET https://world.openfoodfacts.org/api/v3.6/product/{barcode}?fields=...` | Live, 200 |
| Legacy text search (`cgi/search.pl`) | `GET https://world.openfoodfacts.org/cgi/search.pl?search_terms=nutella&search_simple=1&action=process&json=1&page_size=2&fields=code,product_name` | Live, 200 (returned `count: 1086`) |
| Search v2 | `GET https://world.openfoodfacts.org/api/v2/search?categories_tags=en:spreads&fields=...&page_size=2` | Live, **503** on both attempts (see gotchas) |
| Product page (for "view on OFF" links) | `https://world.openfoodfacts.org/product/{barcode}` | From docs, UNVERIFIED |
| Staging read | `https://world.openfoodfacts.net/api/v2/product/{barcode}.json` (HTTP basic auth `off` / `off`) | From docs, UNVERIFIED live |

**Fields filter.** Pass `fields=` as a comma-separated list. Every live call I made used it. Example used for the three products:

```
fields=code,product_name,product_name_fr,generic_name,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,categories_tags,categories_hierarchy,pnns_groups_1,pnns_groups_2,stores,stores_tags,countries_tags,image_front_small_url,image_url,packaging,nutriscore_grade,ecoscore_grade
```

Unknown or absent fields are simply omitted from `product`. `status`/`status_verbose` are always returned at the top level.

**Required header.** Send a `User-Agent` that identifies the app: `AppName/Version (contact)` (https://openfoodfacts.github.io/openfoodfacts-server/api/). My curl with a generic UA also returned 200, so a missing UA is not blocked today. Treat it as required anyway.

## 3. Live responses (trimmed, fields filter applied)

### 3.1 Nutella, `3017620422003`, v2

```json
{"code":"3017620422003","product":{
  "brands":"Ferrero, Nutella",
  "categories_tags":["en:breakfasts","en:spreads","en:sweet-spreads","fr:pates-a-tartiner","en:hazelnut-spreads","en:confectionary-based-spreads","fr:Nutella"],
  "countries_tags":["en:belgium","en:france","en:germany","en:luxembourg"],
  "ecoscore_grade":"f",
  "generic_name":"Hazelnut And Cocoa Spread",
  "image_front_small_url":"https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.200.jpg",
  "image_url":"https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.400.jpg",
  "nutriscore_grade":"e",
  "packaging":"pot: clear glass (recycle in glass bin), lid: plastic (recycle in sorting bin), seal: aluminium (recycle in sorting bin), jar: clear glass (recycle)",
  "pnns_groups_1":"Sugary snacks","pnns_groups_2":"Sweets",
  "product_name":"Nutella","product_name_fr":"Nutella",
  "product_quantity":400,"product_quantity_unit":"g","quantity":"400 g e",
  "stores":"Aldi, Auchan, Carrefour, Casino, Intermarché, Leclerc, Lidl, Super U",
  "stores_tags":["Aldi","Auchan","Carrefour","Casino","Intermarché","Leclerc","Lidl","Super U"]
},"status":1,"status_verbose":"product found"}
```

Note: no `serving_size` or `serving_quantity` on this product.

### 3.2 Cristaline / "isabelle" water, `3274080005003`, v2

```json
{"code":"3274080005003","product":{
  "brands":"Cristaline",
  "categories_tags":["en:beverages-and-beverages-preparations","en:beverages","en:waters","en:spring-waters","en:unsweetened-beverages"],
  "countries_tags":["en:belgium","en:cote-d-ivoire","en:france","en:germany","en:guadeloupe","en:italy","en:luxembourg","en:mali","en:martinique","en:netherlands","en:new-caledonia","en:switzerland","en:united-kingdom","en:united-states"],
  "ecoscore_grade":"not-applicable",
  "generic_name":"Eau De Source",
  "image_front_small_url":"https://images.openfoodfacts.org/images/products/327/408/000/5003/front_en.797.200.jpg",
  "image_url":"https://images.openfoodfacts.org/images/products/327/408/000/5003/front_en.797.400.jpg",
  "nutriscore_grade":"a",
  "packaging":"HdpeFilm-packet,Aluminium-can,PpFilm-wrapper,ldpe-film",
  "pnns_groups_1":"Beverages","pnns_groups_2":"Waters and flavored waters",
  "product_name":"isabelle","product_name_fr":"isabelle",
  "product_quantity":1500,"product_quantity_unit":"ml","quantity":"1500 ml",
  "serving_quantity":1500,"serving_size":"1,5L",
  "stores":"Intermarché, auchan, carrefour, e-leclerc, leclerc, lidl, super-u",
  "stores_tags":["Intermarché","auchan","carrefour","e-leclerc","leclerc","lidl","super-u"]
},"status":1,"status_verbose":"product found"}
```

Note: `product_name` is the brand-like "isabelle", and `serving_size` is free text `"1,5L"` (comma decimal).

### 3.3 Carrefour gluten-free brownies, `3560070976867`, v2

```json
{"code":"3560070976867","product":{
  "brands":"Carrefour",
  "categories_tags":["en:snacks","en:specific-products","en:sweet-snacks","en:biscuits-and-cakes","en:products-for-specific-diets","en:products-without-gluten","en:cakes","en:chocolate-cakes","en:brownies"],
  "countries_tags":["en:france"],
  "ecoscore_grade":"e",
  "generic_name":"Petits gâteaux au chocolat et aux pépites de chocolat sans gluten à base de farine de riz et amidon de pomme de terre.",
  "image_front_small_url":"https://images.openfoodfacts.org/images/products/356/007/097/6867/front_fr.36.200.jpg",
  "image_url":"https://images.openfoodfacts.org/images/products/356/007/097/6867/front_fr.36.400.jpg",
  "nutriscore_grade":"e",
  "packaging":"",
  "pnns_groups_1":"Sugary snacks","pnns_groups_2":"Biscuits and cakes",
  "product_name":"Brownies No Gluten !*","product_name_fr":"Brownies No Gluten !*",
  "product_quantity":240,"product_quantity_unit":"g","quantity":"240 g (8 x 30 g)",
  "serving_quantity":30,"serving_size":"30 g",
  "stores":"carrefour, carrefour-fr","stores_tags":["carrefour","carrefour-fr"]
},"status":1,"status_verbose":"product found"}
```

Note: the `product_name` contains a literal `!*`. `packaging` is an empty string here.

### 3.4 v3.6 envelope (same barcode as 3.2, `fields=product_name,status`)

```json
{"code":"3274080005003","errors":[],"product":{"product_name":"isabelle"},
 "result":{"id":"product_found","lc_name":"Product found","name":"Product found"},
 "status":"success","warnings":[]}
```

### 3.5 Not found / invalid

- Live: `GET /api/v2/product/abc.json` returns HTTP 200 with `{"code":"","status":0,"status_verbose":"no code or invalid code"}`.
- Live: `GET /api/v2/product/0000000000000.json` returned HTTP 200 with `{"code":"00000000","status":0,"status_verbose":"no code or invalid code"}`. Note the code was normalised.
- **UNVERIFIED:** a well-formed barcode that is absent from the DB should return `status: 0` with `status_verbose: "product not found"`. I did not find a live example of that exact string. Handle both `status: 0` cases the same way.
- Always branch on `status === 1` (v2) or `status === "success"` (v3). Do not rely on HTTP code: "not found" is still HTTP 200.

## 4. TypeScript type for the trimmed product

Every field is optional on purpose. OFF data is crowd-sourced and sparsely filled.

```ts
// Fields requested with ?fields=... (see section 2)
export interface OffProductV2Response {
  code: string;
  status: 0 | 1;                 // 1 = found, 0 = not found / invalid
  status_verbose: string;        // "product found" | "no code or invalid code" | ...
  product?: OffProduct;          // absent when status === 0
}

export interface OffProduct {
  code?: string;
  product_name?: string;         // may be "" or contain odd punctuation, e.g. "Brownies No Gluten !*"
  product_name_fr?: string;
  generic_name?: string;         // free text, can be long
  brands?: string;               // comma-separated: "Ferrero, Nutella"
  quantity?: string;             // free text: "400 g e", "240 g (8 x 30 g)"
  product_quantity?: number | string; // number in docs; in the sample it is a number
  product_quantity_unit?: string; // "g" | "ml" | ...
  serving_size?: string;         // free text: "30 g", "1,5L" (comma decimal)
  serving_quantity?: number;     // absent on Nutella
  categories_tags?: string[];    // "en:spreads", "fr:pates-a-tartiner"
  categories_hierarchy?: string[];
  pnns_groups_1?: string;        // "Sugary snacks", "Beverages"
  pnns_groups_2?: string;        // "Sweets", "Biscuits and cakes"
  stores?: string;               // display string
  stores_tags?: string[];        // mixed case: "Intermarché", "carrefour", "carrefour-fr"
  countries_tags?: string[];     // "en:france"
  image_front_small_url?: string;
  image_url?: string;
  packaging?: string;            // free text, often "" ; NOT an array
  nutriscore_grade?: "a" | "b" | "c" | "d" | "e" | "unknown" | "not-applicable" | string;
  ecoscore_grade?: "a" | "b" | "c" | "d" | "e" | "f" | "unknown" | "not-applicable" | string;
}
```

Notes on the type:
- `product_quantity` is a number in all three samples. Accept `string` too, to be safe. UNVERIFIED for all products.
- `nutriscore_grade` and `ecoscore_grade` appear lowercase. `"not-applicable"` appears for water.
- `expiration_date`, `conservation` and `ingredients_text` were **not** requested in my calls, so I have no live shape for them. Add them to `fields` in a separate test before relying on them. UNVERIFIED.

## 5. Rate limits

From https://openfoodfacts.github.io/openfoodfacts-server/api/ (quoted):

- **Product reads: 15 req/min per IP** ("15 req/min/IP address for all read product queries (`GET /api/v*/product` requests or product page)").
- **Search: 10 req/min per IP** ("10 req/min/IP address for all search queries (`GET /api/v*/search` or `GET /cgi/search.pl` requests)"). The page says "don't use it for a search-as-you-type feature, you would be blocked very quickly".
- Writes: no limit stated.
- Per-user for end-user apps: "If your requests come from your users directly (ex: mobile app), the rate limits apply per user."
- Global limits exist "irrespective of the IP address". Exceeding them returns **HTTP 503**.
- "If you need to fetch more than a few hundred products, we ask you to download the data as a CSV or JSONL file directly."

**Conflict:** one search-engine snippet claimed "100 req/min for all read product queries". This conflicts with the primary page, which says 15. I trust the primary page. The 100 figure is **UNVERIFIED**.

**Implication for Cellier:** 15 reads/min per IP is low if all household users go through one shared server IP (e.g., a Vercel or Supabase function). Scan a barcode, cache the result in our own DB, and never re-fetch a barcode we already have.

## 6. CORS: can the PWA call it directly?

Live check with `Origin: https://example-pwa.vercel.app` returned:

```
HTTP/2 200
access-control-allow-origin: *
access-control-allow-methods: HEAD, GET, PATCH, POST, PUT, OPTIONS
access-control-allow-headers: DNT,User-Agent,X-User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,If-None-Match,Authorization
access-control-max-age: 1728000
```

**Answer: yes, a browser can call `world.openfoodfacts.org/api/v2/product/...` directly.**

Caveats:
- A browser cannot set a custom `User-Agent`. Browsers send their own UA, and the custom UA rule can't be honoured from the client. Route through a server proxy if the identification rule matters to OFF.
- The per-IP rate limit applies to each end user's IP, which is good for a PWA, but limits are per IP so households share none of it.
- I did not test the preflight with a `User-Agent` request header from a browser. UNVERIFIED.

Recommendation: start with direct client calls plus a Supabase cache table keyed by barcode. Add a proxy (Supabase Edge Function) if we hit limits or want a stable UA.

## 7. Staging vs production

- Production: `https://world.openfoodfacts.org` (live-tested).
- Staging: `https://world.openfoodfacts.net`. Staging requires HTTP basic auth, username `off`, password `off`. Staging and production have **separate account databases**. The docs recommend testing writes on staging first.
  Source: https://openfoodfacts.github.io/openfoodfacts-server/api/ (UNVERIFIED live: I did not call staging).
- Do not put staging credentials in the client bundle. Use staging only from a dev machine.

## 8. Search API (French product text search)

- **Legacy, works live:** `GET /cgi/search.pl?search_terms=...&search_simple=1&action=process&json=1&page_size=N&fields=...`. Returned HTTP 200 with `{count, page, page_count, page_size, products:[...], skip}`. Rate-limited at 10 req/min per IP (per the docs above).
- **v2 search:** `GET /api/v2/search?...`. Returned **HTTP 503** twice, once with a 8-second gap. Possibly a global-limit or outage. **UNVERIFIED** whether this is a rate limit or an outage. The docs say 503 means a limit was hit.
- **search-a-licious** (the newer Elasticsearch-backed search service, used by the new website search) was not verified by a live call. UNVERIFIED.
- For French text search, the `search_terms` plus `countries_tags=en:france` filter is the obvious combination. I did not run it.

## 9. Licence and attribution (ODbL)

From https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side and the search snippets:

- **Database:** Open Database License (ODbL).
- **Individual contents:** Database Contents License.
- **Product images:** Creative Commons Attribution-ShareAlike (CC BY-SA). The version is inconsistent across sources (one says CC BY-SA 3.0). Images may also contain third-party graphical elements that are not covered by the licence.
- **Attribution:** the project suggests showing "(c) Open Food Facts contributors" on each screen that uses the data. Link to the product page, which also helps ODbL compliance. The exact wording is in the wiki attribution guidelines (https://wiki.openfoodfacts.org/ODBL_License). UNVERIFIED wording.
- **Share-alike:** if we modify or combine OFF data in a database we publish, the ODbL requires us to share it back. The docs recommend sending modified data back via the API. This matters if we store OFF-derived rows in a shared table that leaves the app.
- **Commercial use:** no explicit statement found. Contact reuse@openfoodfacts.org (named on the licence page). UNVERIFIED.
- **Practical:** keep our own per-household rows separate from any OFF-derived cache. Show the attribution on the scan/product screen and in an About/licences page.

## 10. Contributing a missing product

- Writes need an OFF account. Apps can register a global account so users do not each need one (wiki asks that it be named after the app). Source: https://wiki.openfoodfacts.org/Write_API (from search snippet, UNVERIFIED page content).
- Usage form for developers: the API intro asks developers to fill out a usage form first. Source: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/ (from snippet, UNVERIFIED).
- **v3 write:** `PATCH /api/v3/product/{barcode}` with structured JSON. It creates the product if it does not exist. Asks for a User-Agent identifying the app. Source: https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/patch-api-v3-product-code/ (UNVERIFIED body).
- **Legacy write:** `POST cgi/product_jqm2.pl` with barcode and login params. Source: https://openfoodfacts.github.io/openfoodfacts-server/api/tutorial-off-api (UNVERIFIED).
- **Gotcha:** for brands and labels, use the `add_` prefix (e.g., `add_brands`). Without it, existing values are deleted. Source: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/adding-missing-products/ (UNVERIFIED).
- **Photos:** separate upload endpoint `product_image_upload.pl`. Source: https://openfoodfacts.github.io/documentation/docs/Product-Opener/api/tutorials/tutorial-uploading-photo-to-a-product/ (UNVERIFIED).
- Test on staging first.
- Official Python SDK exists: https://openfoodfacts.github.io/openfoodfacts-python (not used here).

## 11. Gotchas

1. **503 is not "not found".** A 503 means a limit or outage. Back off and retry, and do not cache it as a miss.
2. **HTTP 200 with `status: 0`** is the normal "not found" path. Do not treat HTTP status as the signal.
3. **Sparse data.** Expect many missing fields. Make every field optional and show a manual-entry fallback.
4. **`packaging` is a string, not a list**, and may be `""`.
5. **Mixed-case store and country tags.** Normalise `stores_tags` before comparing.
6. **Decimal commas** in `serving_size` ("1,5L"). Parse with a regex, not `parseFloat`.
7. **Names contain junk** (`"Brownies No Gluten !*"`). Strip for display only.
8. **Per-IP limits** shared across a household's network: cache aggressively.
9. **Search v2 returned 503 in my tests**, while `cgi/search.pl` returned 200. Prefer cgi/search.pl for now, and recheck v2 before choosing.
10. **Test barcode `0000000000000`** comes back as `code: "00000000"`. Treat normalisation as a server behaviour.

## 12. Source URLs

- API intro, versions, rate limits, UA, staging: https://openfoodfacts.github.io/openfoodfacts-server/api/
- v2 reference (linked from intro, page content not extractable): https://openfoodfacts.github.io/openfoodfacts-server/api/ref-v2/
- v3 reference (linked, page content not extractable): https://openfoodfacts.github.io/openfoodfacts-server/api/ref-v3/
- Licence tutorial: https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side
- Licence wiki: https://wiki.openfoodfacts.org/ODBL_License
- Conditions of use (support FAQ, not extractable: TLS cert expired at fetch time): https://support.openfoodfacts.org/help/en-gb/12-api-data-reuse/94-are-there-conditions-to-use-the-api
- Write API wiki: https://wiki.openfoodfacts.org/Write_API
- Adding missing products: https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/adding-missing-products
- v3 PATCH product: https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/patch-api-v3-product-code/
- Python SDK: https://openfoodfacts.github.io/openfoodfacts-python

## 13. Open items (UNVERIFIED)

- Exact "product not found" live response for a valid-but-absent barcode.
- Staging host behaviour (not called).
- Whether v2 search 503 is a rate limit or an outage.
- The "100 req/min" product-read claim (conflicts with primary doc's 15).
- CORS preflight when the client sends a `User-Agent` header (browsers ignore it anyway).
- Shape of `expiration_date`, `conservation`, `ingredients_text`, `nutriments` (not requested).
- search-a-licious endpoint and parameters.
- Image licence version and exact attribution wording.
- Write endpoint bodies and the `add_` prefix rule (from snippet only).
