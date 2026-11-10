# 23. UX competitive scan: pantry, home inventory and shopping-list apps

Date: 2026-11-10. Scope: Cellier (iOS-first household pantry and basement inventory, France).

## How to read this document

- **Observed**: stated in a source found during research. Each one carries its source URL.
- **Recommendation**: my reasoning from the observations. Not a fact about any competitor.
- **UNVERIFIED**: could not be confirmed from a primary source. Treat as a hypothesis.

Research limits: Reddit was not reachable through search; no Reddit thread on pantry apps was found in this pass. Two primary pages returned 403 (DGCCRF DLC/DDM fiche, Apple "Managing notifications" returned only a title). Most review data comes from aggregators (AppFollow, AppShunter, JustUseApp, AppTail, marlvel.ai, AppPricingLab) and some are AI-generated summaries; these are weak evidence and are flagged where relevant. Store ratings differ by aggregator and date; re-check the App Store directly before quoting a number.

---

## 1. Competitor comparison table

| App | Category | Pricing (observed) | What it does well (observed) | What it does badly / repeated complaints (observed) | Sources |
|---|---|---|---|---|---|
| Grocy | Self-hosted ERP for households | Open source, self-hosted (UNVERIFIED: no price check; general knowledge) | Purchase and Consume flows are explicit; API exposes barcode actions (`by-barcode/{code}/consume`) | Setup is heavy; Barcode Buddy adds a second app and config step; "consume" does not record which barcode was scanned; users struggle to log consumption, so stock drifts from reality | https://grocy.info/changelog ; https://github.com/grocy/grocy/wiki ; https://barcodebuddy-documentation.readthedocs.io/en/latest/usage.html ; https://github.com/grocy/grocy/issues/2448 ; https://www.galaxus.de/en/page/wie-ich-meinen-kuehlschrankinhalt-digitalisieren-will-und-daran-scheitere-39565 |
| Barcode Buddy (Grocy companion) | Scanner bridge for Grocy | Free, open source | Mode barcodes (Purchase, Consume, Open, Inventory) switch the scanner mode by scanning a card | Setup needs API key and trailing `/api/` URL; ingress/add-on networking issues; "a nightmare" configuration per a forum user | https://barcodebuddy-documentation.readthedocs.io/en/stable/setup.html ; https://community.home-assistant.io/t/grocery-shopping/566657 |
| Yuka | Product scan and rating (France) | Free core, premium features (UNVERIFIED: price) | Scan is the whole product: camera, instant lookup, one screen. Approx. 3M scans/day, 500k in France (vendor-reported, UNVERIFIED as to scale); the scanner sits bottom-right on Android | Score controversy in press (algorithm weights); scanning is not used to add stock | https://www.foodnavigator.com/Article/2019/08/20/Evaluating-the-Yuka-phenomenon-Is-the-scanning-app-effective-in-practice ; https://www.scandit.com/resources/case-studies/yuka ; https://www.insidehook.com/article/health-and-fitness/yuka-health-app-review |
| Pantry Check (Sunroom Labs, id 966702368) | Grocery list + pantry | Free with in-app purchases | Barcode scanner, real-time sync, family sharing; recent updates cite faster scanning | Little review text retrieved; no verified complaint set | https://apps.apple.com/us/app/pantry-check-grocery-list/id966702368 ; https://appshunter.io/ios/app/pantry-check/id966702368 |
| Pantry Check (JOJO APPS, id 6670480023) | Pantry + expiry | Free (UNVERIFIED tiers) | Predicts expiry, reminders, auto shopping list (per Product Hunt; app identity unclear) | Polarized reception; low-confidence audit (17 reviews analysed) | https://apps.appfollow.io/ios/pantry-check/6670480023?country=us ; https://apps.apple.com/app/id6670480023 |
| NoWaste (Your Food / NoWaste food inventory) | Food inventory + expiry | Pro: EUR 6.49/yr or EUR 29.99 lifetime | Expiry alerts; a user bought Pro specifically for expiry alerts | Reports of alerts not reaching the phone (system settings); duplicate entries on barcode scan; some wrong expiry dates; weak support perceived | https://apps.apple.com/app/id926211004 ; https://justuseapp.com/en/app/926211004/nowaste-food-inventory-list/reviews ; https://apptail.io/app/nowaste-food-inventory-list-XJf/belgium |
| Cooklist (Pantry Meals Recipes) | Pantry + recipes | Free with in-app purchase for Pro | Barcode scanning runs item after item; expiry set automatically; receipt scan praised ("incredible") | Failed lookup frustrates users; no in-app help (users learn via Reddit) | https://food.thefuntimesguide.com/?p=18210 ; https://apps.apple.com/us/app/id1352600944 ; https://apptail.io/app/cooklist-pantry-meals-recipes-tjo/united-arab-emirates |
| KitchenPal | Pantry + expiry | Free tier; USD 3.99/mo, 14.99/yr, 29.99 lifetime | Scanner recognises more UPCs (user claim); default expiry icons faster than typing dates | Wrong expiry date occasionally after scan; not all products recognised, especially non-English markets; manual setup effort | https://apps.apple.com/us/app/id6759475699 ; https://app.sensortower.com/api/ios/apps/1084982489?country=US |
| Fridgely (Justin Ehlert) | Fridge/pantry tracker | Free + in-app purchases | Expiry alerts, recipes from stock, receipt and barcode scan | Wants to move items between pantry and fridge without recreating; "hasn't been updated in a while"; receipt scanning weak; ~4.2 from ~150 ratings | https://apps.apple.com/us/app/fridgely/id988016972 ; https://alternativeto.net/software/fridgely/about |
| Pantrify | Pantry tracker | NOT FOUND | Search returned no results for this name | Not assessed. Ask the owner for the exact store name before including | (search returned nothing) |
| My Pantry Tracker | Pantry tracker | UNVERIFIED | Listed in App Store catalogues | No verified review data retrieved | https://apps.appfollow.io/ios/my-pantry-tracker/1567647197?country=us |
| Out of Milk | Grocery list + pantry + to-do | Free (Apartment Therapy framing "the free app"); iOS ~4.4 (Listonic comparison, competitor source) | Clean, simple; pantry items feed the shopping list; automatic sync praised by one household | Sync delays and failed updates (competitor-sourced claim); clunky upgrade; friends must register to share; disliked recent updates | https://www.apartmenttherapy.com/out-of-milk-app-review-36804273 ; https://www.androidcentral.com/out-milk-review-now-you-have-no-excuse-forgetting-groceries ; https://listonic.com/compare-apps/listonic-vs-out-of-milk |
| Bring! | Shopping list (market leader) | Free download; Premium price NOT FOUND | Fast, widely used; per-device sync reported as easy; activity history of list changes (Google Play) | Apple Watch app lost detail; cannot rename existing products (review); recipe attach limits; App Store average unclear (sources disagree: 4.8 on 9.7k in one, 3.4 on ~10 reviews in another) | https://apps.apple.com/app/bring-shopping-list-recipes/id580669177 ; https://justuseapp.com/en/app/580669177/bring-liste-de-courses/reviews |
| AnyList | Grocery list + recipes | Subscription (Macworld: works best paid) | Sync praised as "rock solid"; sharing by email; per-list privacy | Widget does not refresh unless app opened; some Trustpilot sync complaints (Oct 2025); support seen as lukewarm; Trustpilot 3.5 from 20 reviews | https://www.trustpilot.com/review/www.anylist.com ; https://www.loopinsight.com/2016/03/30/anylist-review-grocery-app-crosses-off-nearly-everything-on-our-shopping-list.html |
| Listonic | Shopping list (FR-popular) | Core free; Premium USD ~0.99-1.99/mo or 7.99-15.99/yr (App Store, varies by country); FR comparison says Premium EUR 3.99/mo | Core features free; per-item price tracking; AI assistant free | Vendor pages disagree on what is premium; premium called expensive vs free tier; 4.5/5 in one FR comparison | https://apps.apple.com/app/grocery-shopping-list-listonic/id331302745 ; https://listonic.com/compare-apps/listonic-vs-anylist |
| Sortly | Business inventory (used by home users) | Free tier; paid tiers from about USD 49/mo or 149/mo to 299/mo (sources differ) | Barcode scanning praised; works offline; quick find | Home users charged by record count, not by change rate (Capterra review); built for businesses | https://www.capterra.com/p/169199/Sortly-Pro/pricing/ ; https://www.capterra.ie/reviews/169199/sortly-pro |
| Itemtopia | Home and item inventory | Free (20-item cap); premium unlimited, cloud sync behind paywall | Barcode scanning works well; offline; multiple barcode symbologies | Sluggish at times; ads in free version; 3.8/5 on Google Play (724 reviews) | https://apps.apple.com/app/id952405279 ; https://www.apartmenttherapy.com/home-inventory-apps-37226627 |
| Frigo Magic (FR) | Recipes from fridge contents | Free (UNVERIFIED that no premium tier exists) | Recipes from what you have; 21M recipes (vendor claim, per Linfodurable); easy | Only one ingredient selectable in one review; ~10-15 min setup; store ratings older (4.4 App Store, 4.2 Play, per Interfel) | https://apps.apple.com/FR/app/id977681072 ; https://www.interfel.com/wp-content/media/2022/12/fiche-projet-Frigo-Magic.pdf |
| Jow (FR) | Recipes to basket (meal planning) | Free app; service is grocery delivery | Strong reviews: Trustpilot 4.8 (69), App Store 4.7 (1,381); meal ideas and organisation | Money can vanish from account without explanation (single review); no product scan found | https://fr-be.trustpilot.com/review/jow.com ; https://apps.apple.com/FR/app/id1301257625 |
| Mon E.Leclerc / Leclerc Drive (FR) | Retailer app with list tool | Free | List built by text or by browsing aisles; one-tap offers into "memo courses"; tickets and loyalty card in one place | No recent reviews retrieved | https://apps.apple.com/FR/app/id756693888 |
| Carrefour / Courses U apps | Retailer apps | NOT RESEARCHED in depth | Not confirmed in this pass | Not confirmed | (not retrieved) |

Notes on the table:
- Ratings are not in the table on purpose. They vary by aggregator and date.
- Retailer apps (Leclerc, Carrefour, Courses U) are included only where a source said something about their list features. Carrefour and Courses U were not retrieved; mark UNVERIFIED.

---

## 2. Observed patterns, by topic

### 2.1 Continuous scan session (camera stays open, tray, quantity, undo)
- Observed: Cooklist's barcode scanner "lets them run through items one after another," adding each to the pantry with an automatic expiry. https://food.thefuntimesguide.com/?p=18210
- Observed: Pantry Manager reviews say inconsistent scanner performance makes bulk entry tedious. Source is an AI-generated aggregator (low confidence). https://marlvel.ai/apps/pantry-manager/reviews
- Observed: Grocy's purchase flow is scan-per-item, with quantity and price entered each time. https://barcodebuddy-documentation.readthedocs.io/en/latest/usage.html
- UNVERIFIED: an in-tray with stepper and undo. No competitor was observed doing this well; this is an open gap, not a proven pattern.

### 2.2 Unknown-product path
- Observed: Open Food Facts lets a contributor add a photo and data for a missing product, and the app says contributions produce Nutri-Score, NOVA and Eco-Score. https://apps.apple.com/app/id588797948
- Observed: Cooklist users see a failed lookup as a frustration point. https://screensdesign.com/showcase/cooklist-pantry-meals-recipes
- Observed: Community forum notes the scanner sometimes misreads barcodes; a contributor re-checks the printed barcode against the app result. https://forum.openfoodfacts.org/t/unstability-of-app-barcode-scanner/2265
- UNVERIFIED: exact menu path for an unknown barcode in current Open Food Facts app.

### 2.3 Add vs withdraw mode
- Observed: Barcode Buddy uses mode barcodes (Purchase, Consume, Open, Inventory) printed or scanned to switch the scanner mode. A mode card stays in effect until changed, so the user can forget which mode is on. https://barcodebuddy-documentation.readthedocs.io/en/latest/usage.html
- Observed: Grocy separates Stock > Purchase and Stock > Consume as distinct screens. https://github.com/grocy/grocy/wiki
- Observed: Consume does not record which barcode was scanned, a known limitation. https://github.com/grocy/grocy/issues/2448
- Recommendation (see Section 4): show the current mode persistently on the scan screen, and make the default mode the one that matches the last action with a visible switch.

### 2.4 Quantity entry: stepper vs keypad vs repeated scans
- Observed: Grocy asks quantity and price per purchase. https://barcodebuddy-documentation.readthedocs.io/en/latest/usage.html
- UNVERIFIED: whether Cooklist or Pantry Check default to one unit per scan. Not stated in any retrieved source.
- UNVERIFIED: any competitor measured stepper vs keypad speed. No public data found.

### 2.5 Partial consumption and opened items
- Observed: Fridgely users want to move items between pantry and fridge without recreating them. https://apps.apple.com/us/app/fridgely/id988016972
- Observed: French regulation: once a DDM package is opened, the DDM loses its value and the post-opening rule on the label (often 2 to 3 days) applies. Source: secondary (Linfodurable/FoodBag), official DGCCRF page returned 403. https://www.linfodurable.fr/conso/alimentation-quelle-difference-entre-dlc-et-ddm-39476 ; https://www.foodbag.be/fr/blog/difference-dlc-ddm
- Observed: Barcode Buddy has an "Open" mode, which treats opening as a distinct event. https://barcodebuddy-documentation.readthedocs.io/en/latest/usage.html

### 2.6 Expiry dates: ask or not?
- Observed: NoWaste users buy Pro for expiry alerts; reviews complain alerts do not reach the phone and expiry dates can be wrong after scan. https://apptail.io/app/nowaste-food-inventory-list-XJf/belgium
- Observed: KitchenPal and Cooklist default expiry from a category icon or auto-fill; these are reported as faster than typed dates. https://apps.apple.com/us/app/id6759475699
- Observed: DLC (hard limit, perishable) vs DDM (quality marker, often still safe after the date). https://www.linfodurable.fr/conso/alimentation-quelle-difference-entre-dlc-et-ddm-39476
- Recommendation: for long-keeping goods (basement stock: canned goods, drinks, dry goods), do not ask for expiry at entry. Ask only for perishables, and default to a per-category shelf life. An optional date field is fine; a required one is friction.

### 2.7 Home-screen composition
- Observed: Fridgely and NoWaste lead with expiry alerts and recipe suggestions; Bring! and Out of Milk lead with the list. https://apps.apple.com/us/app/fridgely/id988016972 ; https://www.apartmenttherapy.com/out-of-milk-app-review-36804273
- Observed: Out of Milk lets a pantry feed the shopping list; users praise moving pantry items to list. https://www.supermarketnews.com/consumer-trends/solving-the-dilemma-of-the-shopping-list
- UNVERIFIED: one-handed reach placement of scan button. Yuka reportedly puts the scanner bottom-right on Android. https://www.insidehook.com/article/health-and-fitness/yuka-health-app-review (secondary)

### 2.8 Inventory list density and grouping
- Observed: Out of Milk praised for colour-coded sections and custom section order. https://www.producthunt.com/posts/out-of-milk/reviews
- Observed: Sortly charges by record count, which penalises a large, static inventory. https://www.capterra.ie/reviews/169199/sortly-pro

### 2.9 Low-stock thresholds and shopping list generation
- Observed: Pantry Check and Out of Milk generate a list from pantry status. https://apps.apple.com/us/app/pantry-check-grocery-list/id966702368
- Observed: Listonic and Bring! give price tracking and recipe-to-list. https://apps.apple.com/app/grocery-shopping-list-listonic/id331302745
- UNVERIFIED: any competitor predicting run-out dates from consumption history. Cellier's "predicted run-out" feature may be genuinely differentiating; no evidence found either way.

### 2.10 Notifications users do not disable
- Observed: The most repeated complaint in shared-list contexts is one notification per item added by a partner (Apple Reminders). https://discussions.apple.com/thread/255227135 ; https://forums.macrumors.com/threads/sudden-reminder-notifications.2363599/
- Observed: Turning off in-app push does not stop OS notifications for some apps; users must turn off push in device settings. https://forums.macrumors.com/threads/grocery-iq-stop-push-notifications.1070171
- Observed: Apple HIG (snippet only, page body not retrieved): Time Sensitive is for events happening now or within an hour; never use it for marketing; keep sensitive info out of alert text; prefer actions that avoid opening the app. https://developer.apple.com/design/human-interface-guidelines/notifications.md
- Observed: NoWaste users report expiry alerts not arriving despite settings. https://justuseapp.com/en/app/926211004/nowaste-food-inventory-list/reviews
- Observed: BuildFire claims more than half of users find push annoying (vendor blog, directional only). https://buildfire.com/why-users-mute-push-notifications/

### 2.11 Onboarding for a household
- Observed (secondary, from a 2026 guide whose URL was not retained in this pass): Frigo Magic setup takes about 10 to 15 minutes (fridge contents, habits). UNVERIFIED as to exact figure.
- Observed: Grocy setup is the main barrier. https://www.galaxus.de/en/page/wie-ich-meinen-kuehlschrankinhalt-digitalisieren-will-und-daran-scheitere-39565
- Observed: AnyList sharing is by email address; each member has their own account. https://www.loopinsight.com/2016/03/30/anylist-review-grocery-app-crosses-off-nearly-everything-on-our-shopping-list.html
- UNVERIFIED: time-to-first-scan for any competitor.

### 2.12 Empty states, sharing roles
- Observed: Out of Milk requires the invited person to register before joining a shared list, which was reported as a hassle. https://www.androidcentral.com/out-milk-review-now-you-have-no-excuse-forgetting-groceries
- Observed: Sync conflicts are a repeated theme: Out of Milk (delays, failed updates, competitor-sourced), AnyList (occasional sync failures on Trustpilot).
- UNVERIFIED: role models (owner, editor, viewer) in these apps. Not retrieved.

---

## 3. Common complaints (cross-app, repeated)

| Complaint | Apps where observed | Confidence |
|---|---|---|
| Scanner misses products or returns wrong data | Cooklist, KitchenPal, Itemtopia (sluggish), Pantry Manager | Medium |
| Wrong or duplicate expiry after scan | NoWaste, KitchenPal, a pantry app | Medium |
| Notifications not delivered or too many | NoWaste, Apple Reminders, Grocy-related | Medium |
| Setup effort too high | Grocy, Barcode Buddy, Frigo Magic | Medium |
| Sync conflicts and delays | Out of Milk, AnyList | Low to medium (competitor-sourced claims) |
| Cannot move items between locations | Fridgely | Low (single review) |
| Paywall on sync or basic features | Itemtopia, Sortly, AnyList | Medium |

---

## 4. Recommendations for Cellier (my reasoning, not observed facts)

1. **Continuous scan with a tray.** Keep the camera open after a scan; each item drops into a tray with a quantity stepper (default 1) and an undo button. Reason: Cooklist already proves the rapid-scan flow works; Grocy's one-scan-at-a-time is the friction to remove.
2. **Mode is always visible and forgiving.** Show "Add" or "Withdraw" as a large, persistent segmented control on the scan screen. Switching mode clears nothing, but a 5-second undo toast appears after each committed scan. Reason: Barcode Buddy's mode cards show the cost of a sticky mode.
3. **Unknown product: one screen, minimal fields.** Require only a name and a category; photo is optional; stock can be added immediately and the product flagged "to complete". Reason: the failed-lookup frustration in Cooklist; Open Food Facts contribution can be deferred.
4. **Quantity stepper for ones and twos, keypad for bulk.** Tap a number to open the keypad. Reason: the stepper keeps the common path to one tap per item; the keypad covers the basement case (case of 12).
5. **Partial consumption as a fraction or "opened" state.** Let a unit be "opened" with an optional remaining amount (quarter, half, three quarters). Reason: Fridgely users' complaints about moving stock; French post-opening rules make "opened" a real state.
6. **Expiry: optional, category-defaulted, never required for basement goods.** Perishables ask once; long-keeping goods skip the field. Reason: NoWaste and KitchenPal show wrong or stale dates are worse than none.
7. **Home screen: running low first, a pantry switcher on top, scan button bottom-right.** Show recently added as a secondary strip only. Reason: the list is the job; scan is the thumb action; recent-added is a verification aid, not a destination.
8. **Low-stock threshold per item, with an automatic suggestion after 2 weeks of history.** A manual minimum is the default; the app proposes a threshold from consumption rate and the user accepts or dismisses. Reason: per-item minimum is predictable; automatic-only feels like it is guessing.
9. **Notifications: batch, one per household per day at a chosen time, actionable.** Running-low and expiring items go into one daily digest; a "Time Sensitive" level only for an expiry within 24 hours. Actions: "Add to list" and "Mark bought" without opening the app. Reason: per-item pings are the most-cited complaint; Apple guidance on Time Sensitive and actions.
10. **Household sharing with three roles (owner, member, viewer) and an email invite that works without registration.** Reason: Out of Milk's registration friction; sync conflicts are fixed by a single source of truth with last-write-wins on quantity and an activity log.

---

## 5. Five differentiating ideas (none done well by a competitor observed here)

1. **Basement-aware storage.** Track location as a physical place (shelf, bin, cellar zone) with a photo, not just "pantry". No observed competitor does this; Sortly is business-oriented.
2. **Predicted run-out date from consumption, shown on the shopping list.** Observed: competitors suggest lists from low stock, not from predicted dates. Mark UNVERIFIED as a market gap.
3. **Scan to withdraw in the kitchen, scan to add in the car.** Mode defaults by context (location or time of day) with one-tap override. Unverified as a pattern anywhere.
4. **Quantity-aware barcode learning.** When the same barcode is scanned for two sizes, remember the size on the item. Grocy has a known gap here (issue 2448).
5. **Opened-state with a French post-opening rule.** On opening, show the label's post-opening delay from the product where known, and count it down. Observed rules are real; no competitor shows it at point of opening.

---

## 6. Top friction risks

1. **Scanner recognition rate** (Cooklist, KitchenPal, Pantry Manager). Mitigation: test with French retail barcodes (EAN-13 in France is dominant; Open Food Facts coverage for store brands is UNVERIFIED).
2. **Mode errors**: withdrawing when you meant to add. Mitigation: visible mode plus undo.
3. **Notification fatigue** leading to disabling; a disabled notification system means the core promise fails silently (NoWaste reports).
4. **Expiry entry friction** on long-keeping goods; users abandon the field.
5. **Sync conflicts** between two people editing the same quantity at once.
6. **Setup cost** before the first scan (Grocy, Frigo Magic benchmark 10 to 15 min). Target: first scan under 30 seconds.
7. **Paywall on sync or item count** (Itemtopia free cap at 20 items; Sortly per-record pricing). A household app that caps by item count fails the basement use case.
8. **Trust in data**: a wrong expiry date or missing product destroys trust quickly.

---

## 7. Sources (consolidated)

- https://apps.apple.com/us/app/pantry-check-grocery-list/id966702368
- https://apps.appfollow.io/ios/pantry-check/6670480023?country=us
- https://apps.apple.com/app/id926211004
- https://justuseapp.com/en/app/926211004/nowaste-food-inventory-list/reviews
- https://apptail.io/app/nowaste-food-inventory-list-XJf/belgium
- https://food.thefuntimesguide.com/?p=18210
- https://apps.apple.com/us/app/id1352600944
- https://apps.apple.com/us/app/id6759475699
- https://apps.apple.com/us/app/fridgely/id988016972
- https://alternativeto.net/software/fridgely/about
- https://apps.appfollow.io/ios/my-pantry-tracker/1567647197?country=us
- https://www.apartmenttherapy.com/out-of-milk-app-review-36804273
- https://www.androidcentral.com/out-milk-review-now-you-have-no-excuse-forgetting-groceries
- https://listonic.com/compare-apps/listonic-vs-out-of-milk
- https://www.supermarketnews.com/consumer-trends/solving-the-dilemma-of-the-shopping-list
- https://www.producthunt.com/posts/out-of-milk/reviews
- https://apps.apple.com/app/bring-shopping-list-recipes/id580669177
- https://justuseapp.com/en/app/580669177/bring-liste-de-courses/reviews
- https://www.trustpilot.com/review/www.anylist.com
- https://www.loopinsight.com/2016/03/30/anylist-review-grocery-app-crosses-off-nearly-everything-on-our-shopping-list.html
- https://apps.apple.com/app/grocery-shopping-list-listonic/id331302745
- https://listonic.com/compare-apps/listonic-vs-anylist
- https://www.capterra.com/p/169199/Sortly-Pro/pricing/
- https://www.capterra.ie/reviews/169199/sortly-pro
- https://apps.apple.com/app/id952405279
- https://www.apartmenttherapy.com/home-inventory-apps-37226627
- https://apps.apple.com/FR/app/id977681072
- https://www.interfel.com/wp-content/media/2022/12/fiche-projet-Frigo-Magic.pdf
- https://fr-be.trustpilot.com/review/jow.com
- https://apps.apple.com/FR/app/id1301257625
- https://apps.apple.com/FR/app/id756693888
- https://www.foodnavigator.com/Article/2019/08/20/Evaluating-the-Yuka-phenomenon-Is-the-scanning-app-effective-in-practice
- https://www.scandit.com/resources/case-studies/yuka
- https://www.insidehook.com/article/health-and-fitness/yuka-health-app-review
- https://grocy.info/changelog
- https://github.com/grocy/grocy/wiki
- https://github.com/grocy/grocy/issues/2448
- https://barcodebuddy-documentation.readthedocs.io/en/latest/usage.html
- https://barcodebuddy-documentation.readthedocs.io/en/stable/setup.html
- https://community.home-assistant.io/t/grocery-shopping/566657
- https://www.galaxus.de/en/page/wie-ich-meinen-kuehlschrankinhalt-digitalisieren-will-und-daran-scheitere-39565
- https://apps.apple.com/app/id588797948 (Open Food Facts - Product Scan)
- https://forum.openfoodfacts.org/t/unstability-of-app-barcode-scanner/2265
- https://www.linfodurable.fr/conso/alimentation-quelle-difference-entre-dlc-et-ddm-39476
- https://www.foodbag.be/fr/blog/difference-dlc-ddm
- https://marlvel.ai/apps/pantry-manager/reviews
- https://discussions.apple.com/thread/255227135
- https://forums.macrumors.com/threads/sudden-reminder-notifications.2363599/
- https://forums.macrumors.com/threads/grocery-iq-stop-push-notifications.1070171
- https://developer.apple.com/design/human-interface-guidelines/notifications.md (snippet only; page body not retrieved)
- https://buildfire.com/why-users-mute-push-notifications/
- https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques-et-les-faq/date-limite-de-consommation-et-date-de-durabilite-minimale (returned 403; not used as direct source)
- https://app.sensortower.com/api/ios/apps/1084982489?country=US (KitchenPal listing data)
- https://apps.appfollow.io/ios/pantry-check/6670480023?country=us
- https://apps.apple.com/app/id6670480023
