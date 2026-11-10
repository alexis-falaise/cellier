# E.Leclerc and Carrefour product and price data sources (France)

Research date: 2026-11-10. Scope: official APIs, open datasets, scraping legality, Open Food Facts (OFF) representation, GS1 prefixes, French open-data options, and a recommended way to bias the Cellier catalogue toward these two retailers.

Status legend: **VERIFIED** = read from a fetched or search-returned source in this session. **UNVERIFIED** = not confirmed, or the live check failed.

## 0. Limitations of this research

- **OFF live API was unreachable.** Every request to `world.openfoodfacts.org`, `fr.openfoodfacts.org`, `search.openfoodfacts.org` and `/api/v2/search` returned HTTP 503 (one returned 400) during this session, across roughly 12 attempts spread over the session. **All OFF product counts below are UNVERIFIED.** The only counts quoted are from third-party mirror pages returned by search, and they are brand counts, not `stores_tags` counts.
- The OFF rate-limit wording for search could not be confirmed. The fetched API reference page did not state a search rate limit, so the "about 10 search requests per minute" figure is **UNVERIFIED**.
- The Carrefour and E.Leclerc terms of use (CGU) pages were not read directly. Search returned only adjacent documents. Clause-level statements are therefore **UNVERIFIED**.
- No Bash or shell access was used, per the task constraints.

## 1. Carrefour: official API or open data

| Item | Finding | Status |
|---|---|---|
| Official public developer portal for French product or price data | None found. Search returned third-party pages stating that Carrefour does not publish a general public API for its French catalogue. These are vendor claims, not Carrefour statements. | VERIFIED as "not found"; the vendor claim is UNVERIFIED |
| Seller-side integration | Carrefour marketplace uses **Mirakl**. Access is for sellers, via a Mirakl account and partner onboarding. Not usable for consumer price data. | VERIFIED (third-party integration guides) |
| Partner access | Some partner API keys are issued case by case by a Carrefour representative. | UNVERIFIED |
| Open data on data.gouv.fr | No Carrefour-published price dataset found. | VERIFIED as "not found in search" |
| Third-party scrapers | Apify (studio-amba/carrefour-fr-scraper, $2 per 1,000 results), Parse, Bright Data, Octoparse, Actowiz, Thunderbit, XCrawl. Some advertise bypassing protections. | VERIFIED (listings exist); pricing UNVERIFIED |

Sources:
- https://parse.bot/marketplace/cc2b5dad-f412-4bee-9b32-fd5f482dea10/carrefour-fr-api
- https://apify.com/studio-amba/carrefour-fr-scraper
- https://helpcenter.channable.com/hc/en-us/articles/8506378321426-Setting-up-a-Carrefour-France-API

## 2. E.Leclerc: official API or open data

| Item | Finding | Status |
|---|---|---|
| Official public API for Leclerc Drive or e.leclerc catalogue and prices | None found. | VERIFIED as "not found" |
| Supplier channel | Suppliers use Salsify SupplierXM for "E.Leclerc RBA" product data. This is B2B, not open. | VERIFIED |
| Third-party data | Piloterr wraps the e.leclerc product site by 13-digit EAN and uses an internal Stores API for local price and stock. Apify actors (saswave/leclerc-product-sku-scraper, studio-amba/leclerc-scraper). One listing says it uses **internal APIs that are not publicly documented**. Actowiz sells extraction. | VERIFIED (listings); internal-API claim UNVERIFIED |
| Price index | LSA publishes a monthly drive price index with Wiser. Analysis only, not a downloadable dataset. | VERIFIED (listing) |

Sources:
- https://www.withone.ai/knowledge/piloterr/conn_mod_def%3A%3AGM8OhJKmahE%3A%3AK5v6NLEWSGSsYJW3zib6JA
- https://apify.com/saswave/leclerc-product-sku-scraper
- https://apify.com/studio-amba/leclerc-scraper
- https://salsify.com/hubfs/SupplierXM/EMEA%20-%20Onboarding/Leclerc/@Leclerc%20RBA%20%23guide%20%23utilisateurs.pdf
- https://www.lsa-conso.fr/digital-tech/drive/3/

## 3. Legal position on scraping

**Recommendation: do not scrape carrefour.fr, drive.leclerc, or e.leclerc.** The terms could not be checked directly, so the default is to avoid it. Scraping also carries contract, personal-data and sui generis database risks.

Legal points, as found in search results:

- **Database sui generis right (Code de la propriété intellectuelle, art. L342-1 and L342-2).** The producer of a database with a substantial investment can prohibit extraction or reuse of a substantial part, including repeated systematic extraction that rebuilds a substantial part. Art. L342-3 allows a lawful user to extract insubstantial parts under limits. Source: https://www.legifrance.gouv.fr/codes/id/LEGIARTI000006279253/2006-08-03 (VERIFIED as the code reference). Commentary: https://kohenavocats.fr/?p=2091612 (secondary).
- **Case law cited in search results (secondary sources only, not read in full):** Cass. 1re civ., 13 mai 2014, pourvoi 12-27.691; TGI Paris, 1 Sept 2017 (LBC France v Entreparticuliers, 70,000 EUR damages); CA Paris, 1 Mars 2024 (The Phantom Company, reversed an order). UNVERIFIED in full text.
- **Terms of use.** Carrefour: no scraping clause found in search results; the CGU page itself was not read (UNVERIFIED). E.Leclerc: CGU for location.leclerc (https://www.location.leclerc/documents/cgu-location.pdf) was found but not read in full for an automated-collection clause (UNVERIFIED). Check `robots.txt` and the CGU footer before any use.
- **GDPR.** Loyalty-card and account data are personal data. Scraping any account-linked data is out of scope.
- **Scraping-as-a-service** does not transfer the legal risk to the user.

Conclusion: the defensible position is to use **only open or licensed data** and **not** to scrape the retailer sites.

## 4. Open Food Facts representation

### 4a. stores_tags values

OFF stores field values seen on product pages are free text (for example "Leclerc", "E.Leclerc", "e-leclerc", "Carrefour", "carrefour.fr", "Magasins U", "Cora", "Auchan"). Search results did not show the normalised `stores_tags` slugs in a product page. The tags to test are therefore:

| Tag to query | Expected meaning | Live count | Status |
|---|---|---|---|
| `leclerc` | E.Leclerc generic | UNVERIFIED (API 503) | UNVERIFIED |
| `e-leclerc` | E.Leclerc variant | UNVERIFIED (API 503) | UNVERIFIED |
| `carrefour` | Carrefour generic | UNVERIFIED (API 503) | UNVERIFIED |
| `carrefour-market` | Carrefour Market format | UNVERIFIED (API 503) | UNVERIFIED |

Source for store free-text values: https://world.openfoodfacts.org/product/3560070498260/chapon-carrefour and https://world.openfoodfacts.org/product/3564700785065/x-tense-energy-drink-leclerc (VERIFIED as examples of store/brand fields).

Note: the OFF search query used above is `https://world.openfoodfacts.org/cgi/search.pl?stores_tags=<tag>&search_simple=1&action=process&json=1&page_size=1`. Read `count` from the response. The same API was 503 at the time of research.

### 4b. brands_tags for private labels

| Brand | Owner (per search) | Brand count | Status |
|---|---|---|---|
| leclerc | E.Leclerc | 2826 (asterisk unexplained, French brands page mirror) | UNVERIFIED (mirror, not live) |
| e-leclerc | E.Leclerc | 2408 (mirror) | UNVERIFIED |
| Marque Repère | E.Leclerc | 7677 (Spanish-locale brands page mirror) | UNVERIFIED |
| Nos Régions ont du Talent | E.Leclerc | 1015 (French mirror); about 225 on a Nutri-Score filtered page | UNVERIFIED; the numbers conflict by page |
| Carrefour | Carrefour | UNVERIFIED (not found on mirrors) | UNVERIFIED |
| Carrefour Bio, Carrefour Classic, Simpl, Reflets de France, Eco+ | Carrefour / unknown | not found | UNVERIFIED. "Eco+" was not tied to any brand in results; it may be a Leclerc or Carrefour line, which is unconfirmed. |

Sources: https://fr-en.openfoodfacts.org/brands (mirror), https://fr-ro.openfoodfacts.org/brands (mirror), https://fr-es.openfoodfacts.org/marcas (mirror). The LSA article confirms Nos Régions ont du talent is an E.Leclerc range: https://www.lsa-conso.fr/produits-regionaux-les-tactiques-d-intermarche-e-leclerc-carrefour-ou-cooperative-u-pour-redynamiser-leurs-mdd,461004 (VERIFIED).

Brand tags to query live (once the API is up): `brands_tags=marque-repere`, `brands_tags=nos-regions-ont-du-talent`, `brands_tags=carrefour`, `brands_tags=carrefour-bio`, `brands_tags=carrefour-classic`, `brands_tags=simpl`, `brands_tags=reflets-de-france`, `brands_tags=eco-plus` (slug UNVERIFIED).

## 5. GS1 company prefixes

| Prefix | Attributed to | Evidence | Status |
|---|---|---|---|
| 3564700 | Scamark (E.Leclerc filiale), Leclerc store and private label (Marque Repère, Leclerc, X-Tense) | Many OFF product pages with barcodes 3564700… list Leclerc as store and Scamark or Marque Repère as brand. Examples: https://world.openfoodfacts.org/product/3564700785065/x-tense-energy-drink-leclerc, https://world.openfoodfacts.org/product/3564700572320/gin-london-dry-37-5-vol | VERIFIED as crowd-sourced; not confirmed in GS1 registry (UNVERIFIED) |
| 3560070 | Carrefour private label | OFF pages with barcodes 3560070… list Brands: Carrefour. Examples: https://world.openfoodfacts.org/product/3560070498260/chapon-carrefour, https://world.openfoodfacts.org/product/3560070967902/6-oeufs-de-poules-elevees-en-plein-air-carrefour | VERIFIED as crowd-sourced; not confirmed in GS1 registry (UNVERIFIED) |
| 3245… | Carrefour (per the brief) | Not verified in this session. Example OFF product: https://world.openfoodfacts.org/product/3245412416620/brownie-gout-chocolat-noisettes-carrefour (barcode 3245412416620, brand Carrefour). Note that 3245 is a broad French-origin range, so a prefix match alone is weak evidence. | UNVERIFIED |

Verify GS1 allocation with the GS1 France company-prefix lookup. Do not assume a prefix is exclusive to one retailer. Check each product's brand field.

## 6. French open data

| Source | Usable? | Licence | Notes | Status |
|---|---|---|---|---|
| **Open Prices** (OFF project) on data.gouv.fr | Yes, for barcode-level community prices | ODbL | Parquet file, 32.9 MB, daily updates per the page. Page shows last update "28 octobre 2026", which is inconsistent with the 2026-11-10 date and with a coverage note in search results (2023-11 to 2024-11). Freshness is uncertain. Also published on HuggingFace (https://huggingface.co/datasets/openfoodfacts/open-prices). | VERIFIED (licence, format); freshness UNVERIFIED |
| Caddy Malin "panier-référence" 50 products (EAN-level) on data.gouv.fr | Possibly | Licence Ouverte 2.0 (per search) | Search output was partly garbled; contents not verified. https://www.data.gouv.fr/organizations/caddy-malin | UNVERIFIED |
| INSEE "Informations Rapides" monthly grocery price indices | Yes, for aggregate series | Public (INSEE) | Aggregate, not per-retailer. Example note with a November 2025 reading of +0.3% per month. https://www.insee.fr/fr/statistiques/6966500 | VERIFIED (exists); reuse terms UNVERIFIED |
| Que Choisir / quiestlemoinscher | Unknown | Unknown | Search returned nothing about the site or its data licence. Do not reuse without a written licence. | UNVERIFIED |
| LSA / Wiser drive price index | No | Proprietary | Analysis only | VERIFIED |

Licence reference: Licence Ouverte 2.0 (Etalab) allows commercial reuse with attribution, per https://www.data.gouv.fr/pages/legal/licences/etalab-2.0. ODbL requires share-alike for database derivatives. Cellier should record the attribution and share-alike obligation if it uses Open Prices or OFF dumps.

## 7. Recommended approach: bias the catalogue toward Leclerc and Carrefour using open data only

1. **Use OFF bulk exports, not live scraping.** Download the OFF product dump (ODbL) and filter offline by `stores_tags` values `leclerc`, `e-leclerc`, `carrefour`, `carrefour-market` and by `brands_tags` values listed in section 4b. Use the live API only for spot checks, and respect its rate limit (the value of about 10 search requests per minute is UNVERIFIED; check the current OFF API documentation before relying on it).
2. **Add a retailer-prefix boost.** Mark items whose barcode starts with 3564700 (Leclerc) or 3560070 (Carrefour) as candidates, then confirm via the OFF brand field. Keep the GS1 prefix as a hint, not as proof.
3. **Use Open Prices (ODbL) for price hints** only where a barcode matches and the record is recent. Treat it as crowd-sourced and show dates to users.
4. **Ship attribution and ODbL notices** in the app (OFF and Open Prices contributors) and keep a share-alike plan for any derived database.
5. **Do not** call retailer endpoints, use internal Leclerc Stores APIs, or use third-party scraping services that rely on bypassing protections. Ask Carrefour or E.Leclerc directly about a partner or affiliate data feed if prices or stock are needed later.
6. **Re-run the counts** once the OFF API is reachable, then update the UNVERIFIED cells in sections 4a and 4b.

## 8. Sources consulted

- https://world.openfoodfacts.org/product/3560070498260/chapon-carrefour
- https://world.openfoodfacts.org/product/3564700785065/x-tense-energy-drink-leclerc
- https://world.openfoodfacts.org/product/3564700572320/gin-london-dry-37-5-vol
- https://world.openfoodfacts.org/product/3560070967902/6-oeufs-de-poules-elevees-en-plein-air-carrefour
- https://world.openfoodfacts.org/product/3245412416620/brownie-gout-chocolat-noisettes-carrefour
- https://www.data.gouv.fr/datasets/open-prices
- https://huggingface.co/datasets/openfoodfacts/open-prices
- https://www.data.gouv.fr/pages/legal/licences/etalab-2.0
- https://www.insee.fr/fr/statistiques/6966500
- https://www.legifrance.gouv.fr/codes/id/LEGIARTI000006279253/2006-08-03
- https://www.location.leclerc/documents/cgu-location.pdf
- https://www.lsa-conso.fr/produits-regionaux-les-tactiques-d-intermarche-e-leclerc-carrefour-ou-cooperative-u-pour-redynamiser-leurs-mdd,461004
- https://salsify.com/hubfs/SupplierXM/EMEA%20-%20Onboarding/Leclerc/@Leclerc%20RBA%20%23guide%20%23utilisateurs.pdf
- https://www.lsa-conso.fr/digital-tech/drive/3/
- https://apify.com/studio-amba/carrefour-fr-scraper
- https://apify.com/studio-amba/leclerc-scraper
- https://apify.com/saswave/leclerc-product-sku-scraper
- https://parse.bot/marketplace/cc2b5dad-f412-4bee-9b32-fd5f482dea10/carrefour-fr-api
- https://helpcenter.channable.com/hc/en-us/articles/8506378321426-Setting-up-a-Carrefour-France-API
