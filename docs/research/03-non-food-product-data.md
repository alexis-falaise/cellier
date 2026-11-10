# 03 - Non-food product data (household and hygiene), France

Research date: 2026-11-10. Live API calls were made from the research sandbox. Items marked **UNVERIFIED** were not confirmed against a primary source or a live call.

## 1. Summary

- Open Products Facts (OPF) covers household products (lessive, liquide vaisselle, papier toilette). Open Beauty Facts (OBF) covers hygiene (shampoing, dentifrice, gel douche). Open Pet Food Facts (OPetF) is marginal for Cellier.
- All four Open*Facts databases share the same v2/v3 API shape. Each one has its own host and its own `product_type`.
- **A universal lookup exists.** `GET https://world.openfoodfacts.org/api/v3/product/{code}?product_type=all` returns a 302 to the right database host (verified live, see section 4). `product_type=all` is also accepted by the v2 search endpoint.
- The v2 product endpoint does not redirect. A wrong-database hit returns HTTP 404 with `status_verbose: "product found with a different product type: X"`. That message tells you which database to query next.
- Check `status === 1` in the body, not the HTTP code. An unknown barcode returns HTTP 200 with `status: 0`.
- Hit rate for French household products is good in OPF. Hit rate for French hygiene products is good in OBF. Many OBF hits are flagged `en:incorrect-product-type` and need filtering.
- Free fallbacks outside the Open*Facts family are thin. UPCitemdb's free tier (100 requests/day) is the only clearly documented free option. GS1 France and GS1 Verified by GS1 are not usable as a free public API for this app.

## 2. The four databases

| Database | Host | `product_type` | France products (`countries_tags=france`, live count 2026-11-10) |
|---|---|---|---|
| Open Food Facts | world.openfoodfacts.org | `food` | not measured here |
| Open Products Facts | world.openproductsfacts.org | `product` | **15,820** |
| Open Beauty Facts | world.openbeautyfacts.org | `beauty` | **21,338** |
| Open Pet Food Facts | world.openpetfoodfacts.org | `petfood` | **4,897** |

Counts come from `GET /api/v2/search?countries_tags=france&page_size=1`. They are a snapshot and will change.

Sources:
- Product type enum (`all`, `beauty`, `food`, `petfood`, `product`): https://openfoodfacts.github.io/documentation/docs/Product-Opener/v3/products/get-product-by-barcode (via search summary, UNVERIFIED on the page itself)
- Universal scanning API tutorial: https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/scanning-cosmetics-pet-food-and-other-products/

## 3. Endpoints, shape, CORS, limits, licence

### Endpoints (same on all four hosts)
- Product read, v3: `GET /api/v3/product/{code}` (current). Optional `product_type=all`, `fields=...`.
- Product read, v2: `GET /api/v2/product/{code}.json` (still supported, deprecated per the docs).
- Search: `GET /api/v2/search?...` (structured filters). Full-text search is `GET /cgi/search.pl?search_terms=...&json=1` (live, works; the docs call it legacy).
- Taxonomy: `https://{host}/data/taxonomies/categories.json` (OPF 3.6 MB, OBF 228 KB; both HTTP 200). A `product_type.json` taxonomy does not exist (HTTP 404).
- Write: product write endpoints have no documented rate limit (source: OFF API docs below).

Source: https://openfoodfacts.github.io/openfoodfacts-server/api/ (fetched 2026-11-10)

### CORS
- Live: `access-control-allow-origin: *` on v2 and v3 product responses, and on the 302 response. Browser calls work, including through the cross-host redirect (`curl -H "Origin: ..."`, checked).

### Rate limits (official docs)
- Product read: **15 requests/min per IP**. Product writes: no limit.
- Search: **10 requests/min per IP**. The docs advise against as-you-type search.
- Global limits apply regardless of IP and return **HTTP 503**.
- Consequence: many Cellier users behind one NAT share one IP budget. Cache results in Supabase.

### Licence (docs, OFF platform)
- Database: ODbL. Contents: DbCL. Images: CC BY-SA.
- The docs describe Open Food Facts. OPF and OBF run on the same platform, but I did not check their own licence pages. Per-DB licence: **UNVERIFIED**.

## 4. Live barcode tests (French products)

Methods:
- Barcodes found by name search on each database (`cgi/search.pl`), then probed with `GET /api/v2/product/{code}.json` on all four hosts.
- `fields` trimmed in output. Full JSON not stored.

### Hit / miss matrix

| Category | Barcode | Product | OFF (food) | OPF (product) | OBF (beauty) | OPetF | Result |
|---|---|---|---|---|---|---|---|
| Lessive | 3178041361774 | Le Chat "Lessive liquide Sensitive" 1.89 l | 404 diff type | **HIT** | 404 diff type | 404 diff type | Hit in OPF |
| Lessive | 8001841132617 | Dash 2en1 1925 ml | 404 diff type | **HIT** | 404 diff type | 404 diff type | Hit in OPF |
| Liquide vaisselle | 8718951478800 | Paic "Liquide Vaisselle Paic Citron" 750 ml | 404 diff type | **HIT** | 404 diff type | 404 diff type | Hit in OPF |
| Papier toilette | 7322540819342 | Lotus "Papier toilette 2 épaisseurs aqua tube" 12 u | 404 diff type | **HIT** | 404 diff type | 404 diff type | Hit in OPF |
| Shampoing | 3600542525671 | Garnier "Shampooing nutrition profonde" | 404 diff type (beauty) | 404 diff type (beauty) | **HIT** | 404 diff type | Hit in OBF |
| Shampoing | 3600523682676 | Elseve "Shampooing violet déjaunisseur" | 404 diff type (beauty) | 404 diff type (beauty) | **HIT** | 404 diff type | Hit in OBF |
| Shampoing | 3215666810048 | Garnier Ultra Doux camomille | 404 diff type (beauty) | 404 diff type (beauty) | **HIT** | 404 diff type | Hit in OBF |
| Dentifrice | 8718951543553 | Elmex "Anti-caries" | 404 diff type (beauty) | 404 diff type (beauty) | **HIT** (flagged) | 404 diff type | Hit in OBF, data flagged |
| Dentifrice | 6920354812521 | Colgate (brand only) | 404 diff type (beauty) | 404 diff type (beauty) | **HIT** (flagged) | 404 diff type | Hit in OBF, data flagged |
| Dentifrice | 8710522417379 | Signal Integral 8 Charbon 75 ml | 404 diff type (beauty) | 404 diff type (beauty) | **HIT** (flagged)* | 404 diff type | Hit in OBF |

\* Live result for 8710522417379 at OBF: `product_type: beauty`, `categories_tags` contains `en:incorrect-product-type`.

Honest reading:
- Every tested household barcode hit in OPF, and every tested hygiene barcode hit in OBF. No barcode hit in the wrong database.
- The OBF hits for toothpaste are not clean. Several carry `en:incorrect-product-type`, and the Garnier shampoo has only `en:Cosmetic products` as its category. Treat OBF category tags as low-trust and map them yourself.
- Brand name searches (`cgi/search.pl`, live): OPF returned hits for Le Chat (31), Paic (25), Mr Propre (14), Dash (20), Lenor (148), Scotch-Brite (15), Sopalin (9), Lotus (24). OBF returned 0 hits for Mr Propre, Scotch-Brite and Sopalin, which is expected since those are household brands. Brand search is noisy; the cgi search is also rate-limited (10/min).
- I did not test a food product through OPF or OBF. OFF (food) was never queried as the hit path in this run.

### Trimmed JSON, one hit per DB

OPF, detergent (3178041361774), v2:
```json
{"code":"3178041361774","product":{"brands":"Le Chat","categories_tags":["en:household-chemicals","en:liquid-detergent"],"code":"3178041361774","countries_tags":["en:france"],"product_name":"Lessive liquide Sensitive","product_type":"product","quantity":"1.89l"},"status":1,"status_verbose":"product found"}
```

OPF, dishwashing (8718951478800), v2:
```json
{"code":"8718951478800","product":{"brands":"Paic","categories_tags":["fr:Liquide vaisselle","fr:Maison et jardin","fr:Nettoyage maison","fr:Produits de nettoyage pour la maison","fr:Produits ménagers","fr:Savon et détergent à vaisselle"],"code":"8718951478800","countries_tags":["en:france"],"product_name":"Liquide Vaisselle Paic Citron","product_type":"product","quantity":"750ml"},"status":1,"status_verbose":"product found"}
```

OPF, toilet paper (7322540819342), v2:
```json
{"code":"7322540819342","product":{"brands":"Lotus","categories_tags":["en:home-garden","en:household-supplies","en:household-paper-products","en:toilet-papers","en:11 rolls","en:160 sheets","en:2 ply"],"code":"7322540819342","countries_tags":["en:france"],"product_name":"Papier toilette 2 épaisseurs aqua tube","product_type":"product","quantity":"12 u"},"status":1,"status_verbose":"product found"}
```

OBF, shampoo (3600523682676), v2:
```json
{"code":"3600523682676","product":{"brands":"Elseve, L'Oréal","categories_tags":["en:hair","en:shampoos","en:shampoos-for-colored-hair"],"code":"3600523682676","product_name":"Shampooing violet déjaunisseur","product_type":"beauty"},"status":1,"status_verbose":"product found"}
```

OBF, toothpaste (8718951543553), v2 (flagged):
```json
{"code":"8718951543553","product":{"brands":"Elmex","categories_tags":["en:incorrect-product-type","en:non-food-products","en:open-beauty-facts","en:Tooth","en:toothpastes"],"code":"8718951543553","product_name":"ANTI-CARIES - Dentifrice Protection Caries,","product_type":"beauty"},"status":1,"status_verbose":"product found"}
```

Miss on the wrong database (any probe, e.g. OFF for 3600542525671), v2:
```json
{"code":"3600542525671","status":0,"status_verbose":"product found with a different product type: beauty"}
```
HTTP 404.

Unknown barcode on all hosts (0000000000000), v2:
```json
{"code":"00000000","status":0,"status_verbose":"no code or invalid code"}
```
HTTP 200. The code is normalised to 8 digits.

### Universal lookup (the "all-flavours" question)

Live, `product_type=all` on the v3 endpoint, followed with `curl -L`:

```
GET https://world.openfoodfacts.org/api/v3/product/3600542525671?product_type=all
-> HTTP 302  Location: https://world.openbeautyfacts.org/api/v3/product/3600542525671?product_type=all
-> HTTP 200  {"code":"3600542525671","product":{"product_name":"Shampooing nutrition profonde","product_type":"beauty"},"result":{"id":"product_found"},"status":"success"}
```

Same pattern confirmed for:
- `8718951478800` (Paic) asked on OFF, 302 to OPF, HTTP 200, `product_type: product`.
- `8001841132617` (Dash) asked on OFF, 302 to OPF, HTTP 200, `product_type: product`.
- Asked directly on OPF, `product_type=all` returns HTTP 200 with the product (no redirect).

Notes:
- The redirect is cross-host, so a browser `fetch` follows it. The target returns `access-control-allow-origin: *`.
- The docs say that if the barcode is absent from all four databases, the app should ask the user which type it is, then create the product through the write API on the right database. Source: the scanning tutorial above.
- `product_type=all` on the v2 search endpoint is accepted (`/api/v2/search?product_type=all&...` returned results with `product_type` fields). The `brands` filter in my probe appeared not to restrict results (count 4,905,504). **UNVERIFIED**, not investigated further.
- The `product_type` values documented are `all`, `beauty`, `food`, `petfood`, `product`. Other strings are undocumented. **UNVERIFIED**.

## 5. Other free sources for household and hygiene barcodes

| Source | Free terms (what I could confirm) | Status | Notes |
|---|---|---|---|
| **UPCitemdb** (upcitemdb.com) | Free plan, no signup. Docs: **100 combined lookup+search requests/day**, search capped at **40/day** (the plan page says 20). **6 requests/min**, HTTP **429** on burst. Paid DEV plan from $99/mo for 20,000 lookups/day. | Partially verified (docs via search summaries; conflict on the search cap) | Global catalogue, strong on US/UK items. Coverage of French hygiene brands **UNVERIFIED**. Commercial-use terms **UNVERIFIED** (terms page not reached). Sources: https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/ , https://www.upcitemdb.com/wp/docs/main/plan |
| **Barcode Lookup** (barcodelookup.com) | No official free request quota found. Paid from $99/mo for 5,000 calls (search snippet). A free test account exists, limit not stated. | **UNVERIFIED** | Third-party "barcodes-lookup" listings with 500/month free tiers are not the same service. Do not attribute. Source: https://barcodelookup.com/api |
| **Go-UPC** (go-upc.com) | Conflicting. A ShopSavvy comparison says "free tier: none" with a trial key on request. A Parse.bot listing says Free = 100 credits/month, 5 req/min. | **UNVERIFIED** | Official plans page not retrieved. Source to check: https://go-upc.com/plans/api |
| **EAN-Search** (ean-search.org) | API needs a token and account. Per-account credit packages and burst throttles. No numeric free quota in the spec (Jentic summary). | **UNVERIFIED** (no official terms reached) | Coverage of French household items **UNVERIFIED**. Vendor page: https://www.ean-search.org/ean-database-api.html |
| **GS1 Verified by GS1** (replaces GEPIR, which redirects to gs1.org) | Summary says free for all users, **30 queries/day**, advanced access via GS1 Member Organisation. Returns the company that assigned the GTIN plus basic data. | **UNVERIFIED** (gs1.org returned HTTP 403 to my fetch) | Not a public bulk API. Not suitable as a production fallback for Cellier. Source: https://www.gs1.org/services/verified-by-gs1 |
| **GS1 France CodeOnline / CodeOnline Food** | Member-only brand data service. Not a public lookup. Data flows into Verified by GS1. | Verified via search summary only | Not usable for Cellier. Source: https://www.agena3000.com/en/news/do-you-know-codeonline-food |

## 6. Recommended lookup chain

1. **Local cache first.** Supabase table keyed on EAN. Most household barcodes repeat across users. This also protects the 15 req/min per-IP quota.
2. **Open*Facts universal lookup.** One call: `GET https://world.openfoodfacts.org/api/v3/product/{ean}?product_type=all&fields=...`. Follow the 302. Accept only `status === "success"` / `result.id === "product_found"` (v3) or `status === 1` (v2). Map `product_type` to the right taxonomy.
3. **If not found anywhere**, show the manual form. Ask the user for the type (product, beauty), then create the record through the write API on that database. Writes are not rate-limited per the docs, and the product then benefits every user.
4. **Optional paid or trial fallback**, only if misses are common in practice: UPCitemdb free tier (100/day) for a global lookup, called from a Supabase Edge Function so the quota is shared and not exposed in the client. Add a paid key (EAN-Search, Go-UPC or Barcode Lookup) only after confirming terms and French coverage.
5. Do not use Verified by GS1 as a runtime dependency.

Implementation notes:
- Pass `product_type=all` as a query parameter on the v3 product endpoint. Do not rely on v2 for non-food.
- Filter OBF categories that contain `en:incorrect-product-type`, and treat OBF category tags as low-trust.
- Use `fields=` to keep responses small.
- Browser calls are CORS-enabled. Still cache, because of the per-IP limit.

## 7. Open questions (UNVERIFIED)

- Per-database licence pages for OPF and OBF (only the OFF platform licence was read).
- Whether UPCitemdb, Go-UPC, Barcode Lookup and EAN-Search cover the French household and hygiene items Cellier needs. Not tested with API keys.
- Exact `brands` filter behaviour on v2 search with `product_type=all`.
- Whether the `product_type` enum accepts values beyond the five documented.
- Verified by GS1 current daily limit and reuse terms (gs1.org blocked the fetch).
- Current Go-UPC and Barcode Lookup free-tier numbers.
