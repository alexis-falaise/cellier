# 06 - Mapping Open Food Facts / Open Products Facts / Open Beauty Facts onto Cellier categories

Research date: 2026-11-10. Scope: how the Open*Facts taxonomies are structured, which fields are usable for categorisation, a proposed set of 28 default app categories, and a deterministic mapping algorithm with a rule table validated on 15 live products.

## 1. Summary

- The main taxonomy `categories.json` has 14,946 entries (4.7 MB). Each entry has `parents`, `children` and a multilingual `name` (French name present on 10,863 entries, about 73%).
- `pnns_groups_1` is a product-level field with 9 PNNS values. `pnns_groups_2` has 41 values. Both are filled on about 2/3 of the sample products (10/15), and they are too coarse to be the primary signal.
- Product `categories_hierarchy` is ordered general to specific (verified on a wine product). The mapping should therefore walk the most specific tags first, then fall back to ancestors, then to pnns, then to product-name keywords.
- Open Products Facts and Open Beauty Facts use their own taxonomies with non-food roots (household chemicals, paper, pet supplies, hygiene and cosmetics). Household and beauty products often have no food tags at all, so the mapping must query the right database.
- Proposed: 28 categories (27 + "Autre"), 250 verified tag rules, 5 name-regex fallbacks and a pnns fallback. On the 15-product sample it agrees with the expected category on 15/15, but two products were only fixed after the first pass, so this is not an independent test (see section 7).

## 2. Sources

Primary taxonomy files (fetched 2026-11-10 with curl; sizes are the downloaded sizes):

- Food categories: https://static.openfoodfacts.org/data/taxonomies/categories.json (4,947,634 bytes, 14,946 entries)
- Open Products Facts categories: https://static.openproductsfacts.org/data/taxonomies/categories.json (3,628,460 bytes, 5,560 entries)
- Open Beauty Facts categories: https://static.openbeautyfacts.org/data/taxonomies/categories.json (227,574 bytes, 199 entries)
- Open Pet Food Facts categories: https://static.openpetfoodfacts.org/data/taxonomies/categories.json (27,227 bytes, 30 entries)
- Food groups (3-level, research grouping used by Nutri-Score team): https://static.openfoodfacts.org/data/taxonomies/food_groups.full.json (23,851 bytes) and https://raw.githubusercontent.com/openfoodfacts/openfoodfacts-server/main/taxonomies/food_groups.txt (9,498 bytes, source file, header describes the 3 levels and the `food_group:en:` property on categories)
- PNNS group 1 enum (9 constants): https://pub.dev/documentation/openfoodfacts/1.6.0/utils_PnnsGroups/PnnsGroup1.html
- PNNS group 2 enum (Dart package, values listed in the package source): https://pub.dev/documentation/openfoodfacts/1.6.0/utils_PnnsGroups/PnnsGroup2.html (linked from the PnnsGroup1 page; not fetched in full)

Live product API (one request each, 2026-11-10): `https://world.openfoodfacts.org/api/v2/product/{barcode}.json`, `https://world.openbeautyfacts.org/api/v2/product/{barcode}.json`, `https://world.openpetfoodfacts.org/api/v2/product/{barcode}.json`.

Barcodes that were found in search results (product pages, used as sources of barcodes): https://world.openfoodfacts.org/product/3256220544085/bordeaux-aop-rouge-la-grande-lice, https://world.openfoodfacts.org/product/3017800069486, https://world.openfoodfacts.org/product/7613034225795/pizza-fraich-up-royale-buitoni, https://world.openfoodfacts.org/product/7613036265850/nestle-naturnes-bio-petits-pots-bebe-petits-pois-carotte-pomme-de-terre-2x130g-des-6-mois, https://openproductsfacts.org/product/3596710287093/multicroquettes-auchan.

Operational notes: the search endpoints (`/cgi/search.pl`, `/api/v2/search`) returned HTTP 503 during this session, and `/pnns-groups-1.json` and `/pnns-groups-2.json` returned 503. The product endpoint returned HTTP 429 when called in quick succession, so requests were paced at about 1 per 4 seconds. Many guessed barcodes returned 404.

UNVERIFIED: the exact snapshot date of the static taxonomy files is not stated in the files and was not checked. The `categories.json` on static.openfoodfacts.org may differ from the taxonomy used by the live API.

## 3. Taxonomy structure

### 3.1 Categories taxonomy (`categories.json`)

- Keys are canonical tags with a language prefix, for example `en:wines`, `en:red-wines`, `fr:pates-a-tartiner` (only lowercase, hyphenated, ASCII). A key may use a language prefix other than `en:` (for example `da:frosne`, `ru:икра-овощная`).
- Each entry is an object. Field frequency across the 14,946 entries: `name` 14,946; `parents` 14,856; `children` 3,312; `origins` 4,246; `wikidata` 4,239; `ciqual_food_code` 2,883; `agribalyse_food_code` 2,534; `pnns_group_2` 101; `food_groups` 107; `pnns_group_1` 3; `nova` 23; `sales_format` 305; `opposite` 116; `incompatible_with` 71.
- `name` is a language map, for example `{"en":"Wines","fr":"Vins","de":"Weine", ...}`. French name present on 10,863 entries.
- Parents: 90 entries have no parent. These are the roots, for example `en:beverages-and-beverages-preparations`, `en:canned-foods`, `en:frozen-foods`, `en:condiments`, `en:dairies`, `en:snacks`, `en:meals`, `en:seafood`, `en:fresh-foods`, plus a few non-English roots (`da:frosne`, `fi:ruoat`, `sv:matvaror`).
- Multi-parent tags are common. Example: `en:milk-chocolate-bars` is under `en:chocolate-bars`; `en:chocolates` has parents `en:cocoa-and-its-products` and `en:sweet-snacks`; `en:sardines` has parents `en:fatty-fishes` and `en:fishes`.
- Example chain, `en:red-wines`: parent `en:wines`, parent `en:alcoholic-beverages`, parent `en:beverages`.
- Non-food tags are not in this file: `en:household-cleaning-products`, `en:toothpastes`, `en:toilet-papers` and `en:cat-food` are absent or under `en:non-food-products` (`en:non-food-products` is in the food taxonomy with 3 children). Use the other databases for these (section 3.3).

Observed `categories_hierarchy` of a live product (`en:bordeaux-wines`, EAN 3256220544085), general to specific:

```
en:beverages-and-beverages-preparations > en:beverages > en:alcoholic-beverages > en:wines > en:wines-from-france > en:red-wines > en:bordeaux-wines
```

### 3.2 Food groups and PNNS fields

| Field | Where it lives | Values | Coverage observed |
|---|---|---|---|
| `pnns_groups_1` (product) | product record | 9 PNNS constants (below). Also observed on products: `Alcoholic beverages` (not one of the 9) and `unknown` | 10 of 15 sample products known; `unknown` on Nesquik, Naturnes, Dentifrice, Multicroquettes and the household products |
| `pnns_groups_2` (product) | product record | 41 values in `categories.json` (see below) | 10 of 15 known; same products as pnns_groups_1 |
| `pnns_group_1` (category) | category entry | only 3 categories carry it: `en:cereals-and-potatoes` ("Cereals and potatoes"), `en:fish-and-meat-and-eggs` ("Fish Meat Eggs"), `en:fruits-and-vegetables-based-foods` ("Fruits and vegetables") | rare |
| `pnns_group_2` (category) | category entry | 41 values, 101 categories | rare |
| `food_groups_tags` (product) | product record | values from `food_groups.txt`, e.g. `en:sugary-snacks`, `en:sweets`, `en:beverages`, `en:sweetened-beverages` | 10 of 15 known |
| `food_groups` (category) | category entry | 107 categories map to food groups via `food_group:en:` | - |

PNNS group 1, the 9 values (Dart enum constants: BEVERAGES, CEREALS_AND_POTATOES, COMPOSITE_FOODS, FAT_AND_SAUCES, FISH_MEAT_AND_EGGS, FRUITS_AND_VEGETABLES, MILK_AND_DAIRIES, SALTY_SNACKS, SUGARY_SNACKS). The string values confirmed in `categories.json` or on live products are: "Beverages", "Cereals and potatoes", "Fish Meat Eggs", "Fruits and vegetables", "Sugary snacks", "Composite foods" (on a pizza product), "Salty snacks" (not observed, inferred from the enum), "Alcoholic beverages" (observed on a wine, not in the enum). UNVERIFIED: the exact strings for "Fat and sauces", "Milk and dairy products" and "Salty snacks".

PNNS group 2, the 41 values present on categories (sorted): Alcoholic beverages, Appetizers, Artificially sweetened beverages, Baby foods, Baby milks, Biscuits and cakes, Bread, Breakfast cereals, Cereals, Cheese, Chocolate products, Dairy desserts, Dressings and sauces, Dried fruits, Eggs, Fats, Fish and seafood, Fruit juices, Fruit nectars, Fruits, Ice cream, Legumes, Meat, Milk and yogurt, Nuts, Offals, One-dish meals, Pastries, Pizza pies and quiches, Plant-based milk substitutes, Potatoes, Processed meat, Salty and fatty products, Sandwiches, Soups, Sweetened beverages, Sweets, Teas and herbal teas and coffees, Unsweetened beverages, Vegetables, Waters and flavored waters.

Reliability: pnns is a nutrition-research grouping, not a shopping taxonomy. Examples from the sample: Milka and Jardin Bio peanut butter are both "Sugary snacks", peanut butter and Nutella are "Sugary snacks" / "Sweets", and "Pizza pies and quiches" covers a frozen pizza. Use pnns only as a fallback.

Food groups (`food_groups.txt`): three hierarchical levels, each product in at most one group per level, derived from category properties. Used by Nutri-Score researchers. Not used in the rule table, but a useful signal for the fallback.

### 3.3 Open Products Facts, Open Beauty Facts, Open Pet Food Facts

- **Open Products Facts** (`categories.json`, 5,560 entries, 35 roots): `en:household-chemicals`, `en:household-supplies` (children `en:household-cleaning-supplies`, `en:household-cleaning-products`), `en:papers` (child `en:toilet-papers`, `en:paper-towels`, `en:household-paper-products`), `en:animals-pet-supplies`, `en:baby-toddler`, `en:health-beauty`, `en:home-garden`, `en:electronics`, `en:toys-games`, `en:tobacco-products`, `en:office-supplies`, `en:personal-rain-protection` and others. Leaves useful for the app: `en:laundry-detergents`, `en:dish-detergent-soap`, `en:dishwasher-tablets`, `en:bleach`, `en:all-purpose-cleaners`, `en:air-fresheners`, `en:diapers` (under `en:diapering`), `en:cat-food`, `en:dog-food`, `en:cat-litter`, `en:pet-food`.
- **Open Beauty Facts** (`categories.json`, 199 entries, 20 roots): `en:hygiene` (children `en:toothpastes`, `en:deodorants`, `en:soaps`, `en:intimate-hygiene`, `en:tampons`), `en:hair` (child `en:shampoos`), `en:body` (`en:showers-and-baths`, `en:shower-gels`), `en:face`, `en:makeup`, `en:suncare`, `en:shaving`, `en:perfumes`, `en:nail-products`, `en:anti-ageing`, `en:accessories`, `en:cotton-buds`, `en:halloween-cosmetics`, `en:petroleum-jellies`, `en:flavoured`, `en:eyes`, `en:coloured`, `en:moisturising`.
- **Open Pet Food Facts** (`categories.json`, 30 entries, 13 roots): `en:dog-and-cat-food`, `en:wet-pet-food`, `en:dry-pet-food`, `en:bird-food`, `en:fish-food`, `en:rodent-food`, `en:rabbit-food`, `en:reptile-food`, `en:horse-food`, `en:livestock-feed`, `en:miscellaneous-pet-food`, `en:incorrect-product-type`.

Important: products in Open Beauty Facts and Open Products Facts often carry noise tags such as `en:incorrect-product-type`, `en:non-food-products`, `en:non-open-products-facts`, `en:open-beauty-facts` and some carry the household tags from the other taxonomy. A toothpaste with only `en:incorrect-product-type`, `en:non-food-products`, `en:open-beauty-facts`, `en:Dents` was found (see section 6, row 14). Note the capitalised `en:Dents`. The mapping must not rely on tags alone for these products.

## 4. Proposed app categories (28)

Keys are ASCII for code use. The French label is what the user sees. Scope is one line.

| # | Key | Label (FR) | Scope |
|---|---|---|---|
| 1 | `legumes` | Légumes | Fresh vegetables and potatoes (not canned, not frozen) |
| 2 | `fruits` | Fruits | Fresh and dried fruit |
| 3 | `feculents` | Pâtes, riz & céréales | Pasta, rice, flours, dry legumes, grains, couscous |
| 4 | `poisson` | Poisson | Fresh and smoked fish and seafood (not canned or frozen) |
| 5 | `viande` | Viande & charcuterie | Fresh meat, offal, cured and prepared meats, sausages, ham |
| 6 | `laitier` | Produits laitiers & œufs | Milk, yogurt, cheese, cream, butter, dairy desserts, eggs, plant milks |
| 7 | `pain` | Pain & viennoiseries | Bread, buns, croissants and viennoiseries |
| 8 | `apero` | Apéritifs & snacks salés | Crisps, chips, salted nuts, savoury snacks, aperitif biscuits |
| 9 | `epicerie_sucree` | Épicerie sucrée | Biscuits, cakes, pastries, sugar, sweeteners, desserts |
| 10 | `chocolat` | Chocolat & confiserie | Chocolate, sweets, candies, chewing gum |
| 11 | `petit_dej` | Petit-déjeuner & tartinables | Breakfast cereals, muesli, spreads (hazelnut, peanut, jam), honey, cocoa powder |
| 12 | `conserves` | Conserves | Canned vegetables, fish, meat, legumes, fruit, tomato products, canned meals |
| 13 | `surgeles` | Surgelés | Everything frozen, including ice cream and sorbet |
| 14 | `plats` | Plats préparés & soupes | Fresh ready meals, soups, sandwiches, fresh pizza and quiche |
| 15 | `soft` | Boissons sans alcool | Soft drinks, sodas, energy drinks, syrups |
| 16 | `jus` | Jus & nectars | Fruit and vegetable juices and nectars |
| 17 | `eau` | Eaux | Still, sparkling and mineral waters |
| 18 | `vin` | Vins | Wine, champagne and sparkling wine |
| 19 | `biere` | Bières, cidres & spiritueux | Beer, cider, spirits and liqueurs |
| 20 | `cafe` | Café & thé | Ground and instant coffee, tea, infusions, capsules |
| 21 | `condiments` | Condiments, sauces & huiles | Sauces, mustard, mayonnaise, vinegar, oils, spices, salt, stock |
| 22 | `bebe` | Bébé | Infant formula, baby food jars, baby milk, baby wipes, diapers |
| 23 | `animaux` | Animaux | Pet food, litter, pet supplies |
| 24 | `entretien` | Entretien & nettoyage | Laundry, dishwashing, cleaning products |
| 25 | `hygiene` | Hygiène & beauté | Toothpaste, shampoo, shower gel, deodorant, soap, cosmetics |
| 26 | `papier` | Papier & jetables | Toilet paper, kitchen paper, tissues, napkins, disposable tableware, food wrap, foil |
| 27 | `pharmacie` | Pharmacie & compléments | Food supplements and vitamins (medicines not covered) |
| 28 | `autre` | Autre | Final bucket |

Design choices (UNVERIFIED as product decisions, to confirm with the user): frozen and canned take precedence over the food type (a frozen pea is "Surgelés", not "Légumes"); ice cream is "Surgelés"; canned ready meals are "Conserves"; dried legumes are "Pâtes, riz & céréales"; nuts are "Apéritifs & snacks salés" while dried fruit is "Fruits".

## 5. Mapping algorithm

Input: product record from the database that matched the barcode (food, beauty, household or pet). Use `categories_hierarchy` if present, else `categories_tags`.

1. **Order the product tags** by taxonomy depth (number of ancestors in the database that owns the tag), deepest first. Ties are broken by position in `categories_hierarchy`, later (more specific) first.
2. **Tier 0 (domain)**: for each tag in order, look for a tier-0 rule on the tag, then on its ancestors (nearest first). First hit wins. Covers baby, pet, cleaning, hygiene, paper and pharmacy.
3. **Tier 1 (state)**: same walk with the tier-1 rules (frozen and canned). First hit wins. Frozen and canned take precedence over food type.
4. **Tier 2 (type)**: same walk with the tier-2 rules. The deepest tag with a rule wins because the walk is depth-ordered.
5. **pnns_groups_2**, then **pnns_groups_1**: direct map (section 6 tables). Ignore the value `unknown`.
6. **Product name regex** (`product_name`, case-insensitive): bébé / petit pot / dès N mois, croquettes / litière, dentifrice / shampoing / savon, lessive / liquide vaisselle, papier toilette / mouchoirs.
7. **Database default**: a product from Open Beauty Facts with no other match is "Hygiène & beauté".
8. **Final fallback**: "Autre". Store the trace (tier, matching tag) so the user can override and the rule can be improved later.

Overrides: the user's manual category always wins over the algorithm. Store the algorithm result and the override separately so that changes to the rule table can be re-applied.

Complexity: the rule table has 250 tags. The ancestor walk is O(tags x depth), trivial for a single product. Precompute the ancestor map from the taxonomy at build time (about 15k entries) and ship only the reachable part to the client.

## 6. Rule table

Machine-readable form: the object below is valid JSON (it was produced from the taxonomy snapshot, and every tag in it was found in one of the four `categories.json` files). Tags absent from the snapshot were excluded (section 6.4).

### 6.1 Tiers 0-2 and fallbacks

```json
{
  "categories": {
    "legumes": "Légumes", "fruits": "Fruits", "feculents": "Pâtes, riz & céréales", "poisson": "Poisson",
    "viande": "Viande & charcuterie", "laitier": "Produits laitiers & œufs", "pain": "Pain & viennoiseries",
    "apero": "Apéritifs & snacks salés", "epicerie_sucree": "Épicerie sucrée", "chocolat": "Chocolat & confiserie",
    "petit_dej": "Petit-déjeuner & tartinables", "conserves": "Conserves", "surgeles": "Surgelés",
    "plats": "Plats préparés & soupes", "soft": "Boissons sans alcool", "jus": "Jus & nectars", "eau": "Eaux",
    "vin": "Vins", "biere": "Bières, cidres & spiritueux", "cafe": "Café & thé",
    "condiments": "Condiments, sauces & huiles", "bebe": "Bébé", "animaux": "Animaux",
    "entretien": "Entretien & nettoyage", "hygiene": "Hygiène & beauté", "papier": "Papier & jetables",
    "pharmacie": "Pharmacie & compléments", "autre": "Autre"
  },
  "rules_tier0_domain": {
    "bebe": ["en:baby-foods", "en:baby-milks", "en:infant-formulas", "en:baby-wipes", "en:diapers", "en:shampoos-for-babies", "en:baby-snacks"],
    "animaux": ["en:pet-food", "en:dog-food", "en:cat-food", "en:dog-and-cat-food", "en:wet-pet-food", "en:dry-pet-food", "en:cat-litter", "en:animals-pet-supplies", "en:open-pet-food-facts", "en:fish-food", "en:bird-food", "en:rodent-food", "en:rabbit-food"],
    "entretien": ["en:household-cleaning-products", "en:household-cleaning-supplies", "en:laundry-detergents", "en:laundry-detergent", "en:dish-detergent-soap", "en:dishwasher-tablets", "en:dishwasher-cleaners", "en:bleach", "en:all-purpose-cleaners", "en:air-fresheners", "en:household-chemicals", "en:laundry-supplies", "en:household-supplies"],
    "hygiene": ["en:hygiene", "en:toothpastes", "en:shampoos", "en:shower-gels", "en:deodorants", "en:soaps", "en:hair", "en:body", "en:face", "en:cotton-buds", "en:tampons", "en:intimate-hygiene", "en:shaving", "en:suncare", "en:perfumes", "en:cosmetics", "en:personal-care"],
    "papier": ["en:toilet-papers", "en:paper-towels", "en:household-paper-products", "en:disposable-tableware", "en:food-wraps"],
    "pharmacie": ["en:dietary-supplements", "en:vitamins"]
  },
  "rules_tier1_state": {
    "surgeles": ["en:frozen-foods", "en:frozen-plant-based-foods", "en:ice-creams-and-sorbets", "en:frozen-pizzas"],
    "conserves": ["en:canned-foods", "en:canned-plant-based-foods", "en:canned-seafood", "en:canned-fishes", "en:canned-meats", "en:canned-vegetables", "en:canned-fruits", "en:canned-legumes", "en:canned-tomatoes", "en:canned-meals", "en:canned-cereals", "en:canned-pineapples"]
  },
  "rules_tier2_type": {
    "vin": ["en:wines", "en:red-wines", "en:white-wines", "en:rose-wines", "en:sparkling-wines", "en:champagnes", "en:fortified-wines", "en:cooking-wines", "en:burgundy-wines", "en:bordeaux-wines"],
    "biere": ["en:beers", "en:ciders", "en:hard-liquors", "en:alcoholic-beverages", "en:liqueurs", "en:rums", "en:gins", "en:eaux-de-vie", "en:fruit-brandy", "en:sour-beers", "en:pale-lagers", "en:country-specific-beers"],
    "eau": ["en:waters", "en:mineral-waters", "en:spring-waters", "en:distilled-waters"],
    "jus": ["en:juices-and-nectars", "en:fruit-juices", "en:fruit-nectars", "en:vegetable-juices", "en:orange-juices", "en:apple-juices", "en:pomegranate-juices", "en:grape-juices", "en:tomato-juices", "en:multivitamin-juices", "en:squeezed-fruit-juices"],
    "soft": ["en:sodas", "en:energy-drinks", "en:sweetened-beverages", "en:carbonated-drinks", "en:soft-drinks", "en:syrups", "en:lemonades"],
    "cafe": ["en:coffees", "en:teas", "en:instant-coffees", "en:ground-coffees", "en:herbal-teas", "en:flavoured-teas", "en:green-teas", "en:black-teas", "en:coffee-capsules", "en:tea-capsules"],
    "petit_dej": ["en:breakfast-cereals", "en:breakfasts", "en:sweet-spreads", "en:chocolate-spreads", "en:hazelnut-spreads", "en:spreads", "en:jams", "en:honeys", "en:cocoa-and-chocolate-powders", "en:cocoa-powders", "en:milky-cereal-based-beverages"],
    "chocolat": ["en:chocolates", "en:chocolate-bars", "en:dark-chocolates", "en:milk-chocolates", "en:candies", "en:chewing-gums", "en:lollipops", "en:nougats", "en:marshmallows"],
    "epicerie_sucree": ["en:biscuits", "en:biscuits-and-cakes", "en:cakes", "en:pastries", "en:sweet-pies", "en:puddings", "en:bars", "en:cereal-bars", "en:sugars", "en:sweeteners", "en:biscuits-and-crackers", "en:wafers", "en:desserts"],
    "pain": ["en:breads", "en:viennoiseries", "en:croissants", "en:bread-coverings", "en:hot-dog-buns", "en:brioches"],
    "apero": ["en:crisps", "en:chips-and-fries", "en:salty-snacks", "en:appetizers", "en:nuts", "en:snacks"],
    "laitier": ["en:dairies", "en:milks", "en:yogurts", "en:cheeses", "en:creams", "en:butters", "en:eggs", "en:fermented-dairy-desserts", "en:dairy-desserts", "en:milk-substitutes", "en:cream-cheeses", "en:fresh-cheeses", "en:dairy-spreads"],
    "viande": ["en:meats", "en:fresh-meats", "en:beef", "en:pork", "en:offals", "en:prepared-meats", "en:sausages", "en:hams"],
    "poisson": ["en:fishes", "en:fishes-and-their-products", "en:seafood", "en:smoked-salmons", "en:shellfish", "en:salmons", "en:tunas", "en:mussels", "en:smoked-fishes", "en:fish-fillets", "en:sardines"],
    "legumes": ["en:vegetables", "en:fresh-vegetables", "en:potatoes", "en:lettuces", "en:tomatoes", "en:carrots", "en:leaf-vegetables", "en:root-vegetables"],
    "fruits": ["en:fruits", "en:fresh-fruits", "en:dried-fruits", "en:berries", "en:apples", "en:bananas"],
    "feculents": ["en:pastas", "en:rices", "en:flours", "en:cereal-grains", "en:legumes", "en:lentils", "en:chickpeas", "en:quinoa", "en:pastas-and-dumplings"],
    "plats": ["en:meals", "en:soups", "en:sandwiches", "en:pizzas", "en:pizzas-pies-and-quiches", "en:prepared-lasagne", "en:quiches"],
    "condiments": ["en:condiments", "en:sauces", "en:tomato-sauces", "en:soy-sauces", "en:mayonnaises", "en:mustards", "en:vinegars", "en:vegetable-oils", "en:olive-oils", "en:spices", "en:herbs-and-spices", "en:salts", "en:broths", "en:cooking-helpers", "en:fats", "en:herbs"]
  },
  "pnns_groups_2_fallback": {
    "Alcoholic beverages": "vin", "Artificially sweetened beverages": "soft", "Baby foods": "bebe", "Baby milks": "bebe",
    "Biscuits and cakes": "epicerie_sucree", "Bread": "pain", "Breakfast cereals": "petit_dej", "Cereals": "feculents",
    "Cheese": "laitier", "Chocolate products": "chocolat", "Dairy desserts": "laitier", "Dressings and sauces": "condiments",
    "Dried fruits": "fruits", "Eggs": "laitier", "Fats": "condiments", "Fish and seafood": "poisson", "Fruit juices": "jus",
    "Fruit nectars": "jus", "Fruits": "fruits", "Ice cream": "surgeles", "Legumes": "feculents", "Meat": "viande",
    "Milk and yogurt": "laitier", "Nuts": "apero", "Offals": "viande", "One-dish meals": "plats", "Pastries": "epicerie_sucree",
    "Pizza pies and quiches": "plats", "Plant-based milk substitutes": "laitier", "Potatoes": "legumes",
    "Processed meat": "viande", "Salty and fatty products": "apero", "Sandwiches": "plats", "Soups": "plats",
    "Sweetened beverages": "soft", "Sweets": "chocolat", "Teas and herbal teas and coffees": "cafe",
    "Unsweetened beverages": "soft", "Vegetables": "legumes", "Waters and flavored waters": "eau"
  },
  "pnns_groups_1_fallback": {
    "Beverages": "soft", "Cereals and potatoes": "feculents", "Composite foods": "plats", "Fat and sauces": "condiments",
    "Fish Meat Eggs": "viande", "Fruits and vegetables": "legumes", "Milk and dairy products": "laitier",
    "Salty snacks": "apero", "Sugary snacks": "epicerie_sucree", "Alcoholic beverages": "vin"
  },
  "name_regex_fallback": [
    ["\\bb[ée]b[ée]s?\\b|petit[s]? pots?|d[èe]s \\d+ ?mois|lait 1er|2[èe]me [aâ]ge|naturnes|modilac|guigoz|babybio|blédina|hipp\\b", "bebe"],
    ["croquettes?|p[âa]t[ée]e? |liti[èe]re|\\bchats?\\b|\\bchiens?\\b", "animaux"],
    ["dentifrice|shampo|gel douche|d[ée]odorant|savon", "hygiene"],
    ["lessive|liquide vaisselle|javel|nettoyant|d[ée]tachant", "entretien"],
    ["papier toilette|papier wc|essuie-tout|mouchoirs", "papier"]
  ],
  "db_default": { "en:open-beauty-facts": "hygiene" },
  "final_fallback": "autre"
}
```

The validation script (Python, kept in the research scratch area, not shipped) follows exactly the steps of section 5.

### 6.2 Rule counts

- Verified tag rules in the table: 250 (tier 0: 57; tier 1: 16; tier 2: 177). Requirement of at least 150 is met.
- Name regex fallbacks: 5. pnns_groups_2 map: 41 values. pnns_groups_1 map: 10 values (9 PNNS plus "Alcoholic beverages" observed on live data).

### 6.3 Known weak spots

- `en:snacks` maps to "Apéritifs & snacks salés" but a sweet snack with only the generic `en:snacks` tag would be misfiled. Milka is correct only because its deeper `en:chocolate-bars` tag wins.
- `en:legumes` is in tier 2 for dried legumes, but canned legumes are caught by tier 1 first. This is intended.
- Ice cream is "Surgelés" by design; a fresh "glace" is not a common product in the target range.
- Wine: `en:alcoholic-beverages` maps to "Bières, cidres & spiritueux" as the generic fallback. The `pnns_groups_2` value "Alcoholic beverages" is mapped to "Vins" (heuristic, UNVERIFIED, because it covers both wine and beer). Products with only the generic tag land on the wrong side.
- Baby and pet products in the food database are caught only by tier 0 tags or by name. A baby product with no category and a name without "bébé" or "dès N mois" falls through to pnns, then to "Autre".

### 6.4 Excluded tags (not present in the 4 snapshots, UNVERIFIED)

These candidate tags were in my first draft but are not in any of the four `categories.json` files, so they are excluded from the table (a rule on a tag that does not exist never fires, so they were not useful). Some may exist in newer taxonomy versions, and they can be re-added after checking against the live API: `en:aluminium-foil`, `en:baby-cereals`, `en:baby-dairy-desserts`, `en:brandies`, `en:cereals`, `en:charcuteries`, `en:chicken-meats`, `en:chicory`, `en:citrus-fruits`, `en:cleaning-wipes`, `en:cling-films`, `en:cola-drinks`, `en:confectionery`, `en:couscous`, `en:crackers`, `en:cured-meats`, `en:dressings`, `en:dressings-and-sauces`, `en:fabric-softeners`, `en:food-supplements`, `en:granolas`, `en:iced-teas-ready-to-drink`, `en:infusions`, `en:ketchups`, `en:kitchen-paper`, `en:lamb`, `en:lemon-juices`, `en:medicines`, `en:minced-meats`, `en:muesli`, `en:napkins`, `en:one-dish-meals`, `en:pates`, `en:plant-based-milk-substitutes`, `en:popcorns`, `en:poultry`, `en:pralines`, `en:pretzels`, `en:ready-meals`, `en:salads-prepared`, `en:semolina`, `en:sparkling-waters`, `en:sponges`, `en:stone-fruits`, `en:sweets`, `en:tissues`, `en:veal`, `en:vodkas`, `en:whiskies`.

Note: `en:sweets` appears in live `food_groups_tags` (not in `categories_tags`), and `en:colas` (a live product tag, not on the excluded list) is in the static file under `en:sodas`. The excluded list therefore only means "not found in the four static snapshots"; it does not show the tags are absent from the live API.

## 7. Validation on 15 live products

Fetched 2026-11-10 from the live APIs. The sample was assembled from barcodes found in search results and a few guessed barcodes, so it is not random and does not represent the full French supermarket range. The "expected" column is my judgement. Products 1-12 are food (world.openfoodfacts.org), 13-14 are beauty (world.openbeautyfacts.org), 15 is pet food (world.openpetfoodfacts.org).

| # | Product (name as in DB) | Barcode | Source DB | Result | Rule that fired | Expected | Match |
|---|---|---|---|---|---|---|---|
| 1 | Nutella | 3017620422003 | OFF | `petit_dej` | tier 2, `en:hazelnut-spreads` | Petit-déjeuner | yes |
| 2 | Excellence 70% Cocoa Intense Dark (Lindt) | 3046920028004 | OFF | `chocolat` | tier 2, `en:dark-chocolates` | Chocolat | yes |
| 3 | Coca-Cola Original | 5449000000996 | OFF | `soft` | tier 2, `en:colas` -> `en:sodas` | Boissons sans alcool | yes |
| 4 | isabelle (Cristaline, still water) | 3274080005003 | OFF | `eau` | tier 2, `en:spring-waters` | Eaux | yes |
| 5 | Cruesli mélange de noix | 3168930010265 | OFF | `petit_dej` | tier 2, `en:cereal-clusters-with-nuts` -> `en:breakfast-cereals` | Petit-déjeuner | yes |
| 6 | NESQUIK Cacao | 3033710065967 | OFF | `petit_dej` | tier 2, `en:instant-chocolate-powders` -> `en:cocoa-and-chocolate-powders` | Petit-déjeuner | yes |
| 7 | Pur beurre de cacahuète (Jardin Bio) | 3760020507350 | OFF | `petit_dej` | tier 2, `en:peanut-butters` -> `en:spreads` | Petit-déjeuner | yes |
| 8 | Pizza Fraich'up Royale (Buitoni, frozen) | 7613034225795 | OFF | `surgeles` | tier 1, `en:frozen-pizzas` | Surgelés | yes |
| 9 | Petits pois extra-fins (d'aucy, canned) | 3017800069486 | OFF | `conserves` | tier 1, `en:canned-peas` -> `en:canned-legumes` | Conserves | yes |
| 10 | Bordeaux AOP rouge Chevalier de Landérac | 3256220544085 | OFF | `vin` | tier 2, `en:bordeaux-wines` | Vins | yes |
| 11 | NESTLE NATURNES BIO Petits Pots (baby) | 7613036265850 | OFF | `bebe` | name regex "Petits Pots" / "Dès 6 mois" (no categories, pnns unknown) | Bébé | yes |
| 12 | Chocolat au lait du pays alpin (Milka) | 3045140105502 | OFF | `chocolat` | tier 2, `en:milk-chocolate-bars` -> `en:chocolate-bars` | Chocolat | yes |
| 13 | Liquide vaisselle main YOU | 3700992606453 | OBF | `entretien` | tier 0, `fr:liquide-vaisselle` -> `en:dish-detergent-soap` | Entretien | yes |
| 14 | Dentifrice fraîcheur (Carrefour, Soft Bio) | 3560071172015 | OBF | `hygiene` | name regex "dentifrice" (tags only `en:non-food-products`, `en:Dents`) | Hygiène | yes |
| 15 | Multicroquettes (Auchan, cat/dog kibble) | 3596710287093 | Open Pet Food Facts | `animaux` | tier 0, `en:open-pet-food-facts` | Animaux | yes |

Result: 15/15 agree with the expected category under the final table.

Important caveat on independence: the first pass used the tier rules and pnns only, and gave 13/15. Products 11 (baby, pnns `unknown`, no categories) and 14 (toothpaste, only noise tags) fell to "Autre". I then added the name-regex layer and the Open Beauty Facts default, which fixed both. The 15/15 score is therefore not an independent test. A fair test needs a fresh set of barcodes, ideally 100 or more, drawn at random from a French store (see section 8).

Other observations from the sample:
- `pnns_groups_1` / `pnns_groups_2` were `unknown` on 5 of 15 products (Nesquik, Naturnes, both household products, Multicroquettes). Nesquik has a complete category tree and still no pnns value. Tags are therefore more reliable than pnns for French products.
- `categories_hierarchy` was present on 14/15, `food_groups_tags` on 10/15.
- Multicroquettes (pet food) has only `en:non-food-products`, `en:open-pet-food-facts`, so the pet rule relies on the database-specific tag.
- The `en:snacks` tag on Milka was not needed because the deeper tag won, as designed.

## 8. Recommendations and open items

1. Query the database that matches the barcode, in this order: Open Food Facts, then Open Beauty Facts, Open Products Facts and Open Pet Food Facts. Use the result of the first hit with a non-empty `product_name`. Expected hits: food, beauty, household, pet.
2. Ship a pruned taxonomy with only the ancestor map of the 250 rule tags and the 41 + 10 pnns maps. The full `categories.json` (4.7 MB) is too large for a PWA first load.
3. Test on 100+ random products from a real French store (Carrefour, Leclerc, Lidl) before shipping, and report the share in "Autre" and the share of user overrides.
4. Confirm UNVERIFIED items: pnns_groups_1 strings "Fat and sauces", "Milk and dairy products", "Salty snacks"; the excluded tags in section 6.4; the design choices in section 4.
5. The live search API was unavailable (503) during this session, so no bulk query was run. A bulk query of the French-only subset (`countries_tags=en:france`) would give real pnns coverage numbers; those were not measured here.
