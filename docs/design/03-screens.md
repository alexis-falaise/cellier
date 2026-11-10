# 03 — Screens and information architecture

Status: design specification, 2026-11-10. Audience: the implementer who builds Cellier's screens without mock-ups,
and the agents writing `01-design-system.md` (tokens, components) and `02-motion-haptics.md` (choreography).

This document is bound by the shared design brief (now merged into `README.md`, section Foundations). It names motion presets (`press`, `snappy`, `smooth`, `push`,
`sheet`, `fling`, `pop`, `reduced`) and the four haptic sites without defining their choreography; `02` owns that.
It names colours by role (accent, amber, brick, stone, category hue) and leaves values to `01`. Where this document
deviates from or extends the brief, the change is listed in section 9.

---

## 0. Conventions used in this document

**Reference device.** Layouts are described at 390 × 844 CSS px (iPhone 13, 14, 15). They must hold at 375 px
wide (iPhone 13 mini) and 393 px (iPhone 15 Pro). Sizes in px are at the default text size; every vertical size that
contains text scales with the user's text size because type is set in `rem` (brief, Type). Fixed sizes (icons,
tiles, touch targets) do not scale. Side margin is 16 px everywhere.

**Safe areas.** "Top inset" means `env(safe-area-inset-top)` (47 px on iPhone 13/14, 59 px on 15 Pro).
"Bottom inset" means `env(safe-area-inset-bottom)` (34 px on all target devices).

**Type names** follow the brief's Dynamic Type table: Large Title 34/41, Title 1 28/34, Title 2 22/28, Title 3 20/25,
Headline 17/22 semibold, Body 17/22, Callout 16/21, Subhead 15/20, Footnote 13/18, Caption 1 12/16, Caption 2 11/13.
"Serif" means the New York stack (only at 28 px and above). "Rounded" means SF Pro Rounded with tabular numerals.

**Copy.** Every user-visible string appears in this document with its catalogue key in backticks, for example
«Bientôt épuisé» `home.low.title`. The full table is in section 7. Copy rules for the `fr.ts` catalogue:

- Apostrophes are typographic (’, U+2019). Ellipsis is one character (…).
- A no-break space U+00A0 precedes `:`; a narrow no-break space U+202F precedes `;` `!` `?` and `%`, sits inside
  guillemets (« texte »), between a number and its unit (`500 g`, `≈ 4 j`, `1,89 €`), and after `≈` and `×`.
  This document prints them as ordinary spaces; the catalogue must not.
- Numbers, prices and dates are formatted with `Intl` (`fr-FR`), never by string concatenation:
  prices `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })` → `1,89 €`;
  dates `{ weekday: 'long', day: 'numeric', month: 'short' }` → `jeudi 14 nov.`; times `{ hour: '2-digit',
  minute: '2-digit' }` → `18:40`.
- Plurals use `Intl.PluralRules('fr')`. French returns `one` for 0 and 1 (`0 article`, `1 article`, `2 articles`).
  Recent CLDR data also returns `many` for very large round numbers (1 000 000); the catalogue maps `many` to the
  `other` form.
- Voice: no "tu"; infinitive or imperative without "vous" where possible; "vous" when a pronoun is unavoidable.
  No exclamation mark except the two onboarding success lines marked as such.
- Gender: phrasing avoids agreeing with a person or a product name ("Ce compte ne fait plus partie…",
  "Article supprimé par Marie"), because neither gender is known.

**Components** are named in `PascalCase` and listed in section 10. "Inset list" means an `InsetGroupedList`
(iOS Settings style): sections inset 16 px from each side, rows on a raised surface, radius `14`, hairline
separators inset to the text column.

**Motion and haptics.** Each transition names its preset; `02` defines the exact choreography. A haptic is named
only at the four brief sites: (H1) a barcode lands in the scanner tray; (H2) a swipe action or sheet drag crosses its
commit threshold; (H3) a native switch toggles; (H4) a destructive action is confirmed. Nothing else vibrates.

---

## 1. Information architecture

### 1.1 Scope decision: household, pantry, product

These three scopes drive every screen, so they are fixed first.

- A **household** ("foyer") is the unit of sharing. One account belongs to one household at a time in v1.
- A **pantry** is called a **cellier** in the interface (generic noun: «cellier», plural «celliers»). The app is named
  after the room; each storage place the household tracks is "a cellier", whatever its own name ("Cave",
  "Cuisine", "Garage").
- A **product** ("article" in the interface) belongs to the household. Its stock is held per cellier.
- **Running low, forecasts and the groceries list are computed per product across all celliers.** A household with
  1 pack of pasta in the Cuisine and 6 in the Cave is not short of pasta. This matches `research/24`, where rates and
  suggestions are per product. The minimum quantity («seuil d’alerte») is set per product in v1.
- The **current cellier** is a per-device preference (stored in IndexedDB `meta`), shared by Accueil, Stock and the
  scanner's default target. It is not in the URL. With two or more celliers, the menu also offers
  «Tous les celliers» `pantry.all`.
- On **Accueil**, the current cellier filters which running-low products are listed: a product is listed when it
  has a stock row in that cellier (it "lives" there), but whether it is low is still decided on its household total.
  On **Stock**, the current cellier filters the list. **Courses** is always household-wide and its title is
  «Courses», not a cellier name.

### 1.2 Screen tree

```
App
├── Onboarding (no tab bar)
│   ├── Welcome                                  /welcome
│   │   └── InstallGuideSheet                    /welcome?sheet=install
│   ├── Auth callback (PKCE fallback)            /auth/callback
│   ├── Join landing (invite link)               /join#CODE
│   ├── Household choice                         /onboarding/household
│   ├── Create household                         /onboarding/create
│   ├── Join with a code                         /onboarding/join
│   └── Joined / first sync                      /onboarding/joined
├── Removed from household (no tab bar)          /removed
├── Tabs (TabBar + ScanButton)
│   ├── Accueil                                  /
│   │   ├── Item detail                          /items/$productId
│   │   │   └── Item history                     /items/$productId/history
│   │   └── Activity                             /activity
│   ├── Stock                                    /stock
│   │   └── Item detail                          /stock/items/$productId
│   │       └── Item history                     /stock/items/$productId/history
│   └── Courses                                  /groceries
│       └── Item detail                          /groceries/items/$productId
│           └── Item history                     /groceries/items/$productId/history
├── Sheets (over any tab route, search params)
│   ├── PantryMenuSheet                          ?sheet=pantries
│   ├── SettingsSheet (pushes inside)            ?sheet=settings[&page=…][&id=…]
│   │   ├── Account                              &page=account
│   │   ├── Household                            &page=household
│   │   │   ├── Member                           &page=member&id=…
│   │   │   ├── Invite                           &page=invite
│   │   │   └── Activity                         &page=activity
│   │   ├── Pantries                             &page=pantries
│   │   │   ├── Pantry                           &page=pantry&id=…
│   │   │   └── New pantry                       &page=pantry-new
│   │   ├── Categories                           &page=categories
│   │   │   ├── Category                         &page=category&id=…
│   │   │   └── New category                     &page=category-new
│   │   ├── Notifications                        &page=notifications
│   │   └── About and data sources               &page=about
│   ├── ItemEditSheet                            ?sheet=item-edit&id=…[&step=category]
│   ├── RecountSheet                             ?sheet=recount&id=…&pantry=…
│   ├── MoveSheet                                ?sheet=item-move&id=…
│   ├── NewItemSheet                             ?sheet=new-item[&step=category]
│   ├── StockViewSheet                           ?sheet=stock-view
│   ├── PutAwaySheet                             ?sheet=put-away
│   ├── NotificationPrimerSheet                  ?sheet=notify
│   ├── InstallGuideSheet                        ?sheet=install
│   └── SyncSheet                                ?sheet=sync
├── ConfirmDialog (over a screen or a sheet)     &confirm=<dialog-id>
└── ScannerCover (full-screen cover)             ?cover=scan&mode=add|withdraw
    └── Local overlays (not in the URL, see 1.4):
        PermissionPrimer, UnknownProductSheet, StoreCodeSheet, ManualEntrySheet,
        PantryPicker, QuantityKeypad, close ConfirmDialog
```

Static pages `/legal/terms` and `/legal/privacy` are linked from the sign-in footnote; their content is out of
scope here.

### 1.3 Navigation model

- **Tabs.** Three tabs, Accueil / Stock / Courses (Lucide `house`, `package`, `shopping-basket`). Each tab keeps its
  own stack: the app stores the last location of each tab, and selecting a tab restores it. Tapping the selected tab
  pops its stack to the root (`push` preset, reversed); tapping it again at the root scrolls to top (`smooth`).
- **Pushes.** Item detail, item history and Activity are pushes inside a tab stack (`push`). The tab bar and the
  ScanButton stay visible on pushed screens, as on iOS. The edge-swipe back gesture pops (`fling` on release with
  velocity, `push` otherwise).
- **Sheets.** Every sheet is a `SheetContainer` reflected in search params, so the system Back gesture and
  `history.back()` close it. A sheet never opens another sheet: secondary steps are pushes inside the sheet
  (`page=` or `step=` params), each push being a history entry. Dismissing the sheet by swipe-down or «OK» removes all
  of its entries in one step (`history.go(-depth)`), so Back afterwards does not reopen it. Sheets open with `sheet`
  and close with `fling` when released with velocity (H2 when the drag crosses the dismiss threshold).
- **Detents.** `fit`: sheet height fits content, capped at 92 % of the viewport. `large`: top edge at top inset +
  10 px; the screen behind dims but does not scale; only a parent sheet scales back when another sheet stacks on it (choreography in `02`). PantryMenuSheet, StockViewSheet,
  RecountSheet, NotificationPrimerSheet, InstallGuideSheet, PutAwaySheet and SyncSheet use `fit`; SettingsSheet,
  ItemEditSheet, NewItemSheet and MoveSheet use `large`.
- **Scanner.** A full-screen cover, true black, opened by the ScanButton (tap: add; long-press 450 ms: withdraw).
  It is a search param on the current tab route (`?cover=scan&mode=add`) so the screen beneath stays mounted and
  receives focus back on close. Mode is read once on open; switching mode inside the scanner does not touch the URL
  (see 1.4).
- **Confirmations.** `ConfirmDialog` (iOS action-sheet style, anchored at the bottom) is reflected as
  `&confirm=<id>` so Back cancels it. Destructive confirmation triggers H4.
- **Réglages** opens from the AvatarButton at the top trailing edge of Accueil only.

### 1.4 Back, swipe-down and edge cases

| Surface | Back button / edge swipe | Swipe down | Notes |
|---|---|---|---|
| Tab root (Accueil, Stock, Courses) | No back. Edge swipe does nothing. | Scrolls; no pull-to-refresh (sync is automatic) | Re-tap of the tab scrolls to top. |
| Item detail, item history, Activity | Pops to the previous screen; back label is the previous title | Scrolls | When opened from a notification with no history, Back goes to the tab root with `replace`. |
| Any sheet | Closes the top push inside the sheet; at the sheet root, closes the sheet | Closes the whole sheet (all pushes) | With unsaved edits (ItemEditSheet, NewItemSheet, category or pantry edit), both gestures are intercepted: the drag rubber-bands and the discard ConfirmDialog appears. |
| ConfirmDialog | Cancels | Cancels | Tapping the dimmed area cancels. |
| ScannerCover | Same as «Fermer» | Not available (the tray owns vertical drags) | With items in the tray, closing asks first (4.4.9). |
| Scanner local overlays | Close the overlay only, without a history entry (see below) | Close the overlay | |
| Onboarding screens | Back to the previous onboarding step | n/a | Welcome is the root; no back. |
| Removed from household | No back | n/a | Must pick an outcome. |

**Why the scanner's inner overlays are not in the URL.** WebKit mutes or revokes the camera when the URL changes
during capture in a Home Screen app (`research/08` §5: bug 212040 for `pushState`, bug 215884 for hash changes). While
the camera stream is live, the app makes no history or URL change. The scanner's overlays are component state. A
`popstate` caused by the edge swipe while the scanner is open is treated as «Fermer». This is the one exception to
the brief's "sheets in search params" rule (section 9).

### 1.5 Route table (TanStack Router)

All routes except onboarding, `/removed`, `/join`, `/auth/callback` and `/legal/*` require a session and a household;
the root `beforeLoad` redirects to `/welcome` (no session), `/onboarding/household` (session, no household) or
`/removed` (membership revoked).

| Path | Screen | Kind | Search params | Notes |
|---|---|---|---|---|
| `/welcome` | Welcome + sign-in | onboarding root | `sheet=install` | Start screen when signed out. |
| `/auth/callback` | PKCE callback | utility | `code`, `error` | Fallback sign-in only (`research/17` §3.2). |
| `/join` | Join landing | onboarding | code in `#fragment` | Fragment keeps the code out of server logs (`research/16` §6). |
| `/onboarding/household` | Create or join | onboarding | | |
| `/onboarding/create` | Create household | onboarding | | |
| `/onboarding/join` | Join with a code | onboarding | `code` (prefill) | |
| `/onboarding/joined` | Welcome to the household + first sync | onboarding | | Replaced by `/` when the first pull completes. |
| `/removed` | Removed from household | blocking | | |
| `/` | Accueil | tab root | `sheet`, `page`, `id`, `confirm`, `cover`, `mode` | |
| `/items/$productId` | Item detail (Accueil stack) | push | `sheet`, `id`, `pantry`, `confirm`, `cover` | Deep link target of a single-item notification. |
| `/items/$productId/history` | Item history | push | | |
| `/activity` | Household activity | push | | |
| `/stock` | Stock | tab root | `q` (search), `group`, `sort`, `dir`, plus sheet params | `group` ∈ `category,item,added,price,quantity`; `sort` ∈ `name,category,recent,price,quantity`; `dir` ∈ `asc,desc`. Defaults are omitted from the URL. |
| `/stock/items/$productId` | Item detail (Stock stack) | push | as above | |
| `/stock/items/$productId/history` | Item history | push | | |
| `/groceries` | Courses | tab root | sheet params | Deep link target of the digest notification. |
| `/groceries/items/$productId` | Item detail (Courses stack) | push | as above | |
| `/groceries/items/$productId/history` | Item history | push | | |
| `/legal/terms`, `/legal/privacy` | Static legal pages | static | | |

Sheet and cover params, valid on every tab route:

| Param set | Surface |
|---|---|
| `sheet=pantries` | PantryMenuSheet |
| `sheet=settings` + `page` ∈ `account, household, member, invite, activity, pantries, pantry, pantry-new, categories, category, category-new, notifications, about` + `id` | SettingsSheet and its pushes |
| `sheet=item-edit&id=…` (+ `step=category`) | ItemEditSheet (+ category picker push) |
| `sheet=recount&id=…&pantry=…` | RecountSheet |
| `sheet=item-move&id=…` | MoveSheet |
| `sheet=new-item` (+ `step=category`) | NewItemSheet |
| `sheet=stock-view` | StockViewSheet (Stock only) |
| `sheet=put-away` | PutAwaySheet (Courses only) |
| `sheet=notify` | NotificationPrimerSheet |
| `sheet=install` | InstallGuideSheet |
| `sheet=sync` | SyncSheet |
| `confirm=<id>` | ConfirmDialog (ids listed per screen) |
| `cover=scan&mode=add|withdraw` | ScannerCover |

The legacy hash routing is never used: a hash change revokes camera permission in standalone mode.

### 1.6 Deep links

Only a push notification can open the installed app from outside (`research/21` §12). Links tapped elsewhere (an
invite in Messages) open in Safari.

| Source | URL | What the user sees |
|---|---|---|
| Running-low alert for one product | `/items/$productId` | Item detail in the Accueil stack, scrolled to top, so the user can check the count, correct it, or adjust the seuil. The product is already on Courses; no extra action is needed. |
| Running-low alert grouped (several products in one notification) | `/groceries` | Courses. |
| 18 h digest | `/groceries` | Courses. |
| Invite link (opens in Safari) | `/join#K7PM4QXD` | Join landing (4.1.8). |

The service worker's `notificationclick` focuses an existing window and posts the URL; the app navigates. If the
scanner is open with items in its tray, the navigation waits until the scanner closes. If a sheet with unsaved edits
is open, the navigation waits for its discard dialog. The app badge shows the number of products currently running
low (a state, like Mail's unread count) and is updated on every sync and every push; it is cleared when that number
is 0.

---

## 2. Global states

### 2.1 Principles

1. **The kitchen is never blocked.** Every user action applies locally at once and is queued. Network state changes
   what the user is told, never what they can do, except four online-only actions: signing in, creating or joining a
   household, creating an invite, and changing notification preferences.
2. **Quiet by default.** When everything is fine, no sync status is shown at all. Status appears only when it changes
   what the user should expect.
3. **Facts, not errors.** A server adjustment (a clamp, a field overwritten by another member) is reported as what was
   recorded, in the history of the item, not as an alert.
4. **Few prompts, batched.** The only cases that ask the user to decide (`research/15` §7, tier 3) are gathered in one
   «À vérifier» list inside SyncSheet.

### 2.2 State inventory and where each surfaces

| State | Trigger | SyncIndicator | Other surface | Blocking? |
|---|---|---|---|---|
| Loading from local store | App start, IndexedDB read (`research/14` §3.6) | Hidden | None. The last screen renders from IndexedDB; no spinner, no skeleton. | No |
| First sync, empty local store | After sign-in or join, before the first pull completes | «Chargement du foyer…» | `/onboarding/joined` then tab roots show `SkeletonRow` placeholders for lists only. Headers, tab bar, scan button are live. | No (scanning works; new products resolve after the pull) |
| First sync impossible (offline, empty store) | No network and nothing cached | «Hors ligne» | EmptyState on the tab root: «Connexion nécessaire» (2.5.2) | Yes, until online |
| Synced, idle | Outbox empty, last pull OK | Hidden | SyncSheet shows «À jour» | No |
| Pending, online | Outbox not empty for more than 5 s while online | «{n} modifications en attente» | None | No |
| Offline, nothing pending | `navigator.onLine` false or fetch fails | «Hors ligne» | None | No |
| Offline with pending | as above with outbox | «Hors ligne · {n} modifications en attente» | Item history shows «En attente d’envoi» on unsent movements | No |
| Sync error, retrying | Transport or 5xx failure, backoff running | «Synchronisation interrompue» + inline «Réessayer» | None | No |
| Needs attention | A mutation returned `gone`, `invalid` or `dependency_failed` | «{n} à vérifier» (amber dot) | Rows in SyncSheet «À vérifier» | No |
| Field conflict resolved (LWW) | Another member's newer value won on a field this device also changed | Hidden | History entry on the item (4.6.8); nothing else | No |
| Stock deltas from two devices | Concurrent movements | Hidden | None: deltas commute (`research/15` §6.3) | No |
| Withdrawal clamped | Server returned `clamped` | Hidden | Toast (2.5.6) + history entry «Retrait ajusté» | No |
| Move clamped | `stock.transfer` clamped | Hidden | Toast + history entry | No |
| Membership removed | Pull reports removal, or mutations return `forbidden` | Hidden | `/removed` (4.16) with quarantine actions | Yes |
| Session expired | Refresh token rejected (definitive auth error only) | Hidden | StatusBanner on every tab root (2.5.9); writes keep queueing | No |
| Signed out (explicit) | User signs out | n/a | `/welcome` | n/a |
| Camera permission denied | `NotAllowedError` | n/a | Scanner state (4.4.11) | Scanner only |
| Camera unavailable | `NotReadableError`, `OverconstrainedError`, no device | n/a | Scanner state (4.4.11) | Scanner only |
| Notifications denied | `Notification.permission === 'denied'` | n/a | Notifications page (4.14), primer never shown again | No |
| Not installed (Safari tab) | `!isStandalone()` on iOS | n/a | Welcome install path; Notifications page; one dismissible row on Accueil | No |
| Device clock skewed | Server reports HLC clamp | n/a | Note in SyncSheet (2.4) | No |
| App update ready | Service worker `waiting` | n/a | Toast with «Recharger» (2.5.10) | No |

### 2.3 SyncIndicator

**Placement.** One `SyncIndicator` per tab root and per pushed screen, inside the `LargeTitleHeader`, as a subtitle
line directly under the large title: x = 16, height 20, Subhead 15/20, secondary text colour, a 16 px Lucide icon
6 px before the text. It occupies no space when hidden (the header is 20 px shorter; the change animates with
`smooth`). When the large title collapses into the inline navigation bar on scroll, the indicator collapses to its
icon alone (16 px), placed 6 px after the inline title, still tappable with a 44 × 44 hit area. On sheets the
indicator is not shown. Tapping it opens SyncSheet (`?sheet=sync`).

**States and exact copy.** Colours are neutral (stone) except «à vérifier», which adds an amber 6 px dot before the
icon. «Synchronisation interrompue» is followed by a text button «Réessayer» in the accent colour, 12 px after
the text.

| State | Icon (Lucide) | Text | Key | Accessibility label |
|---|---|---|---|---|
| Synced | none | hidden | | |
| First sync | `cloud-download` | Chargement du foyer… | `sync.indicator.firstSync` | «Chargement du foyer en cours» `a11y.sync.firstSync` |
| Pending online | `cloud-upload` | {n} modification en attente / {n} modifications en attente | `sync.indicator.pending` | same text + «, ouvrir les détails» `a11y.sync.openDetails` |
| Offline | `cloud-off` | Hors ligne | `sync.indicator.offline` | «Hors ligne, ouvrir les détails» |
| Offline with pending | `cloud-off` | Hors ligne · {n} modification en attente / Hors ligne · {n} modifications en attente | `sync.indicator.offlinePending` | same + «, ouvrir les détails» |
| Error | `cloud-alert` | Synchronisation interrompue | `sync.indicator.error` | «Synchronisation interrompue, ouvrir les détails» |
| Error retry button | | Réessayer | `common.retry` | «Réessayer la synchronisation» `a11y.sync.retry` |
| Needs attention | `cloud-alert` + amber dot | {n} à vérifier | `sync.indicator.attention` | «{n} changement à vérifier / {n} changements à vérifier, ouvrir les détails» `a11y.sync.attention` |

Precedence when several apply: first sync > needs attention > error > offline with pending > offline > pending.
The pending state appears only after 5 s of non-empty outbox while online, so a normal write (under one second)
never flashes it. Text changes cross-fade (`smooth`; `reduced` with reduced motion); counts do not animate.

### 2.4 SyncSheet («Synchronisation»)

`SheetContainer`, detent `fit`, opened from SyncIndicator. Top to bottom:

1. `SheetHeader`: title «Synchronisation» `sync.sheet.title` (Headline, centred), trailing «OK» `common.done`.
2. Status row (inset list, one row, 52 px): leading 28 px icon matching the indicator state; title, one of
   «À jour» `sync.sheet.status.synced`, «Hors ligne» `sync.sheet.status.offline`, «Synchronisation interrompue»
   `sync.sheet.status.error`, «Chargement du foyer…» `sync.sheet.status.firstSync`; secondary line
   «Dernière synchronisation : {relativeTime}» `sync.sheet.lastSync` (relative time format in 7.2), or
   «Jamais synchronisé sur cet iPhone» `sync.sheet.neverSynced`.
3. Section «En attente d’envoi» `sync.sheet.pending.title`, shown when the outbox is not empty: up to 5
   `ActivityRow`s describing queued mutations (same phrasing as history rows, 4.6.8), then a row
   «et {n} autres» `sync.sheet.pending.more` when more. Footer: offline, «L’envoi reprendra automatiquement au retour
   du réseau.» `sync.sheet.pending.offlineFooter`; online, «Envoi automatique en cours.» `sync.sheet.pending.onlineFooter`.
4. Section «À vérifier» `sync.sheet.attention.title`, shown when attention items exist: one `AttentionRow` per item
   (2.5.7), each with its own actions.
5. Clock note, shown only when the server clamped this device's clock: «L’heure de cet iPhone semble décalée.
   Vérifier Réglages › Général › Date et heure.» `sync.sheet.clockSkew` (Footnote, secondary).
6. Primary button (full width minus 32 px, 50 px high, radius full, accent fill): «Synchroniser maintenant»
   `sync.sheet.syncNow`. Disabled when offline; while a flush runs, its label becomes «Synchronisation…»
   `sync.sheet.syncing`.

### 2.5 State details

#### 2.5.1 Loading from local store

Boot order (`research/14` §3.6): open IndexedDB → build the store → render the last route → pull → flush →
subscribe. The splash (`apple-touch-startup-image`, limestone background, centred wordmark) is visible only during the
OS launch. React renders the last visited tab route from the restored per-tab stack. Data present in the store
renders at once; there is no spinner and no skeleton in this state. Forecasts are computed synchronously from the
local ledger (`research/24` §8).

#### 2.5.2 First sync after sign-in (empty local store)

After sign-in into an existing household (join, or a second device), the store is empty. `/onboarding/joined`
(4.1.7) shows for at most 1.5 s; then the tab root renders with:

- The large title shows the household's first cellier name as soon as the `pantries` table arrives (first rows of
  the pull); before that, the title slot shows a 120 × 28 px stone placeholder bar (radius 6).
- Each list shows 5 `SkeletonRow`s (60 px rows with a 36 px tile block and two text bars at 60 % and 35 % width).
  They are static (no shimmer); with reduced motion nothing changes because nothing moves.
- SyncIndicator: «Chargement du foyer…».

If the device is offline with an empty store, the tab root shows an `EmptyState`: Lucide `cloud-off`, title
«Connexion nécessaire» `sync.firstSync.offline.title`, body «Le stock du foyer sera téléchargé dès que l’iPhone sera
en ligne.» `sync.firstSync.offline.body`, button «Réessayer» `common.retry`.

#### 2.5.3 Offline

Nothing is disabled except the four online-only actions. Each of these shows its reason inline, as Footnote text under
the disabled control, never as a toast:

- Sign-in: «Pas de connexion internet. Vérifier le réseau, puis réessayer.» `auth.error.offline`
- Create household: «Connexion nécessaire pour créer le foyer.» `onboarding.create.offline`
- Join: «Connexion nécessaire pour rejoindre un foyer.» `onboarding.join.offline`
- Invite: «Connexion nécessaire pour créer une invitation.» `invite.offline`
- Notification preferences: «Connexion nécessaire pour modifier les notifications.» `notifications.offline`

Product lookups in the scanner fall back to the local store; unknown codes become «à compléter» rows (4.4.6).

#### 2.5.4 Pending sync

Optimistic values are shown everywhere (`quantity = server cache + pending deltas`, never below 0). Unsent movements
carry «En attente d’envoi» `history.pending` with a Lucide `clock` 12 px icon in item history and Activity. No row
in lists carries a marker.

#### 2.5.5 Field conflict resolved

Descriptive fields (name, brand, category, size, price, seuil, stock habituel, cellier names, category names) use
per-field last-writer-wins. Nothing interrupts the user. When a value this device wrote is overwritten by a newer
value from another member, the item's history gains an entry (4.6.8): «Modification remplacée» `history.overwritten.title`,
detail «{field} : « {yourValue} » remplacé par « {theirValue} » ({member})» `history.overwritten.detail`, with a
text button «Rétablir» `history.overwritten.restore` that writes the old value again as a new edit. Category and
cellier renames appear the same way in Activity. Stock quantities never conflict.

#### 2.5.6 Withdrawal or move clamped by the server

The server applies at most what is on the shelf. When results arrive with `clamped` and the app is in the
foreground, one `Toast` per sync batch:

- One product: «{product} : {applied} retiré sur {requested}. Il n’en restait que {applied}.» with plural forms
  (`toast.clamp.single`: one `{applied} retiré`, other `{applied} retirés`). When `applied` is 0: «{product} : aucun
  retrait enregistré, le stock était déjà à 0.» `toast.clamp.zero`.
- Several products: «{n} retraits ajustés au stock disponible.» `toast.clamp.multiple`, action «Voir» `common.view`
  → Activity.
- Move: «{applied} déplacé sur {requested} : {pantry} n’en avait que {applied}.» `toast.moveClamp` (plural on
  `applied`).

The item history keeps a permanent entry «Retrait ajusté» `history.clamped.title`, detail «{applied} sur
{requested} demandés» `history.clamped.detail`. If the app was in the background when the result arrived, the toast
shows on the next foreground. There is no haptic (not one of the four sites).

#### 2.5.7 Needs attention («À vérifier»)

`AttentionRow`: 28 px Lucide `circle-exclamation-point` in amber, title (Body), detail (Subhead, secondary), then a row of up to
two text buttons (accent; the second neutral). Cases and copy:

| Case (`research/15` §6.16) | Title | Detail | Actions |
|---|---|---|---|
| Change on a product deleted by another member (#9, #10) | «Article supprimé par {member}» `attention.gone.title` | «« {product} » : votre modification n’a pas été enregistrée.» `attention.gone.detail` | «Restaurer l’article» `attention.gone.restore` · «Ignorer» `attention.dismiss` |
| Move into a deleted cellier (#14) | «Cellier supprimé par {member}» `attention.pantryGone.title` | «Le déplacement de « {product} » vers « {pantry} » n’a pas été enregistré.» `attention.pantryGone.detail` | «Ignorer» |
| Rename collides with an existing name (6.14) | «Nom déjà utilisé» `attention.nameTaken.title` | «Un autre article s’appelle déjà « {name} ».» `attention.nameTaken.detail` | «Ouvrir l’article» `attention.open` · «Ignorer» |
| Invalid value refused (#22) | «Modification refusée» `attention.invalid.title` | «« {product} » : la valeur saisie n’a pas été acceptée.» `attention.invalid.detail` | «Ouvrir l’article» · «Ignorer» |
| Dependent change after a failed creation (#19) | Shown once, under the parent row: «et {n} changements liés» `attention.dependents` | | Follow the parent's action |

«Ignorer» drops the mutation from the outbox. «Restaurer l’article» queues a restore then the original change.

#### 2.5.8 Quarantined mutations after removal

Handled by `/removed` (4.16). Local data for the household and the quarantined outbox stay on the device until the
user chooses.

#### 2.5.9 Session expired, signed out

- **Session expired** (a definitive invalid-refresh-token error, never a network error, `research/17` §5.3): the
  local store stays readable and writable; the outbox keeps queueing. Every tab root shows a `StatusBanner` pinned
  under the large title (inset card, 16 px margins, radius 14, neutral surface): Lucide `key-round`, title «Session
  expirée» `session.expired.title`, body «Les modifications restent sur cet iPhone jusqu’à la reconnexion.»
  `session.expired.body`, button «Se reconnecter» `session.expired.action` (opens the Google sign-in flow inline in
  the banner; on success the banner leaves with `smooth` and the outbox flushes). If the user signs in with a
  different Google account that is not a member of the household, the banner body becomes «Ce compte Google ne fait
  pas partie de « {household} ». Se reconnecter avec {email}.» `session.expired.wrongAccount`, and the app signs that
  session out locally.
- **Explicit sign-out** is confirmed (4.11). Afterwards the user-scoped cache is cleared and the app goes to `/welcome`.

#### 2.5.10 App update

When a new service worker is waiting, a `Toast` (persistent until acted on or dismissed by swipe): «Nouvelle version
disponible» `update.available`, action «Recharger» `update.reload`. It is never shown while the scanner is open or a
sheet has unsaved edits; it waits.

### 2.6 Toast rules

- One toast at a time, queued. Position: bottom, 12 px above the tab bar top edge (or above the bottom inset where
  there is no tab bar), width = screen − 32 px, min height 52 px, radius 20, inverted surface (`01` decides), Subhead
  text, optional trailing text action in the accent colour lifted for the inverted surface.
- Enter and exit with `smooth`; swipe down to dismiss (`fling`). Duration 4 s without an action, 6 s with an action;
  the timer pauses while a finger is down on the toast.
- Toasts never carry errors that need a decision (those go to «À vérifier») and never stack on the scanner (the
  scanner tray owns feedback while it is open).
- Accessibility: announced through a polite live region; the action is reachable by VoiceOver for the toast's lifetime
  plus 4 s.

---

## 3. Shared shell and building blocks

### 3.1 TabBar and ScanButton

- `TabBar`: a floating capsule on translucent material. Left edge x = 16; right edge at screen width − 16 − 60 − 12
  (that is, 12 px before the ScanButton, token `--tab-bar-gap`); height 60 (`--tab-bar-height`); radius full. Bottom
  edge at `--tab-bar-bottom` = `max(bottom inset − 12 px, 12 px)` from the screen bottom. Three equal `TabBarItem`s:
  Lucide icon 24 px over a `tab-label` (10 px) label, 3 px apart, centred.
  Selected item: accent colour, with a selection capsule behind it (`snappy` when it slides between tabs). Labels:
  «Accueil» `tabs.home`, «Stock» `tabs.stock`, «Courses» `tabs.groceries`. Tabs have no badges.
- `ScanButton`: 60 × 60 circle, accent fill, Lucide `scan-barcode` 28 px in the on-accent colour, soft shadow, same
  vertical centre as the TabBar, right edge at screen width − 16. Visually detached from the bar (brief).
  - Tap: opens ScannerCover in add mode. Pointer-down applies `press`.
  - Long-press: a timer of 450 ms from pointer-down opens ScannerCover in withdraw mode. While held, the icon
    cross-fades to Lucide `scan-barcode` with a small `minus` badge at 300 ms as a hint (`snappy`). No haptic.
    `-webkit-touch-callout: none` prevents the system callout. Moving the finger more than 10 px cancels both.
  - Accessibility label «Scanner des produits» `a11y.scan.button`, hint «Maintenir pour retirer des produits»
    `a11y.scan.hint`, plus a VoiceOver custom action «Retirer des produits» `a11y.scan.withdrawAction`.
- Both hide while the software keyboard is visible (search focus) and on onboarding and `/removed`. Content scrolls
  beneath them; every scroll view ends with padding `--content-bottom` (TabBar height + bottom offset + 16 px).

### 3.2 LargeTitleHeader, PantrySwitcher, AvatarButton

- Navigation row: 44 px high under the top inset. Leading: `BackButton` on pushed screens (Lucide `chevron-left`
  22 px + previous title in Body, accent colour). Trailing: up to two `IconButton`s (44 × 44 hit, 22 px icon) or one
  text button (Body, accent).
- Large title block: 52 px (title line 41 px + 11 px bottom padding), x = 16. Serif, 34 px, semibold, tight
  tracking (values in `01`). Below it, the SyncIndicator line (20 px, when visible).
- On scroll, the large title collapses into an inline title centred in the navigation row: Headline 17 px, system
  font (serif is only for 28 px and up). The navigation row gains its translucent material only once content
  scrolls under it.
- `PantrySwitcher` (Accueil and Stock only): the large title text is the current cellier name followed by a Lucide
  `chevron-down` 20 px in secondary colour, 6 px after the text, baseline-aligned. With one cellier, no chevron and
  not interactive. With two or more, the whole title is a button opening PantryMenuSheet. Long names truncate with
  an ellipsis at 1 line, leaving 44 px for the trailing nav buttons. Accessibility: role button, label «Cellier :
  {name}» `a11y.pantry.switcher`, hint «Changer de cellier» `a11y.pantry.switcherHint`.
- `AvatarButton` (Accueil only, trailing): 32 px circle with the Google photo, or the initials in Footnote semibold on
  a stone circle; 44 × 44 hit area. Label «Réglages» `a11y.settings.open`.

### 3.3 ItemRow anatomy

Used by Stock, Accueil (low variant), Activity drill-down and search results. Minimum height 60 px; vertical padding
12 px.

```
| 16 | [CategoryTile 36] | 12 | Name (Body, 1 line)          | 12 | [•] Quantity | 16 |
|    |                   |    | Secondary (Subhead, 1 line)  |    |              |    |
```

- `CategoryTile`: 36 × 36, radius 10, background = the category hue at low chroma, Lucide icon 20 px in the
  category's deep tone (`01` defines). If the product has a photo, the tile still shows the category, never the photo:
  photos at 36 px are noise; the photo appears on Item detail.
- Name: Body, primary, single line, ellipsis.
- Secondary line: Subhead, secondary, single line: «{brand} · {size}» (`item.row.brandSize`), «{size}» alone, or the
  category name if neither exists. In «Tous les celliers» mode: «{pantryA} {qtyA} · {pantryB} {qtyB}»
  (`item.row.split`), at most two celliers then «+{n}». Unresolved products: «À compléter» `item.row.incomplete`.
- Quantity: Title 3 (20 px) rounded, tabular, right-aligned in a column at least 32 px wide. Changes play `pop`.
- Running-low marker: a 6 px amber dot, 6 px before the quantity, vertically centred. Colour is never the only
  signal: the accessible name of the row includes «bientôt épuisé» `a11y.item.lowSuffix`. A product at 0 shows «0» in
  the tertiary text colour with the amber dot.
- Separator: hairline inset to the text column (x = 64 inside the row).
- No chevron: the whole row pushes Item detail, as in Reminders.
- Accessibility name: «{name}, {brand}, {size}, {quantity} en stock[, bientôt épuisé]» `a11y.item.row`.
- At accessibility text sizes (AX1 and above) the quantity moves under the name, left-aligned, and the tile is
  top-aligned.

`ItemRow` variant `low` (Accueil): trailing shows a `ForecastBadge` instead of the bare quantity, and the secondary
line becomes «Reste {qty}» `home.low.remaining` (with «· {pantry}» `home.low.inPantry` in «Tous les celliers» mode
when one cellier holds it).

### 3.4 ForecastBadge and the honesty rules

`ForecastBadge`: a capsule, height 24, horizontal padding 8, Footnote rounded semibold tabular, amber tint
background with amber deep text (`01` ensures 4.5:1). Content by state, using `research/24` outputs (`cover`,
`runOut`, `confidence`):

| Condition | Badge text | Key | Accessible text |
|---|---|---|---|
| Stock 0 | Épuisé | `forecast.badge.out` | «Épuisé» |
| Forecast available (≥ 2 consume events, confidence medium or high), cover < 1 day | < 1 j | `forecast.badge.lessThanDay` | «Moins d’un jour de stock» `a11y.forecast.lessThanDay` |
| as above, 1 ≤ cover < 14 days | ≈ {d} j | `forecast.badge.days` | «Environ {d} jours de stock» `a11y.forecast.days` |
| as above, 14 ≤ cover < 60 days | ≈ {w} sem. | `forecast.badge.weeks` | «Environ {w} semaines de stock» `a11y.forecast.weeks` |
| Low by seuil only (no usable forecast, or confidence low) | Seuil | `forecast.badge.threshold` | «Sous le seuil d’alerte» `a11y.forecast.threshold` |

Rules:

- `d` is the median days of cover rounded to the nearest integer (minimum 1); `w` is `round(cover / 7)`.
- "≈" is always present on a time estimate, even at high confidence: it is a forecast.
- Low-confidence estimates (category prior, fewer than 3 events) never show a day count in a badge.
- Item detail (4.6.5) is where the 80 % band and the confidence are explained in words.

### 3.5 Dates and relative phrasing

| Need | Rule | Example | Key |
|---|---|---|---|
| Relative time ≤ 1 min | «à l’instant» | | `time.justNow` |
| < 60 min | «il y a {n} min» | il y a 12 min | `time.minutesAgo` |
| Today | «aujourd’hui, {HH:mm}» | aujourd’hui, 14:02 | `time.todayAt` |
| Yesterday | «hier, {HH:mm}» | hier, 18:40 | `time.yesterdayAt` |
| Within 6 days | weekday | lundi | `time.weekday` (Intl) |
| Older, same year | «{d} {month}» | 3 oct. | Intl `{ day: 'numeric', month: 'short' }` |
| Older, other year | «{d} {month} {yyyy}» | 3 oct. 2025 | Intl |
| Future day label | «aujourd’hui», «demain», then «{weekday} {d} {month}» | samedi 16 nov. | `time.today`, `time.tomorrow` |

### 3.6 SheetContainer and SheetHeader

- `SheetContainer`: radius 28 at the top corners, grabber 36 × 5 px (radius full) centred 6 px from the top on
  translucent material, background = grouped background. Bottom padding = bottom inset + 16. Scroll inside the sheet
  hands off to the sheet drag when the content is at its top (choreography in `02`).
- `SheetHeader`: 56 px, starting 14 px below the top edge. Leading text button (Body, accent: «Annuler»
  `common.cancel` or a back chevron + previous title inside a push), centred title (Headline), trailing text button
  (Headline weight, accent: «OK» `common.done`, «Enregistrer» `common.save`, «Ajouter» `common.add`, «Créer»
  `common.create`). Disabled trailing buttons use the tertiary text colour.

### 3.7 ConfirmDialog

iOS action-sheet style: a group of buttons on the raised surface, radius 14, at the bottom (16 px side margins,
8 px above the bottom inset), each button 56 px with Body text centred (destructive buttons in brick), an optional
title (Footnote semibold, secondary) and message (Footnote, secondary) at the top of the group; a separate «Annuler»
button below (Headline weight), 8 px gap. Background dims. Opens with `sheet`, closes with `smooth`. Confirming a
destructive button triggers H4.

### 3.8 EmptyState

Centred column, max width 300 px, placed at 30 % of the remaining scroll height: a 64 px circle with an accent-tinted
background and a 28 px Lucide icon in the accent colour; 16 px gap; title (Title 3, semibold, centred, `text-wrap:
balance`); 6 px gap; body (Subhead, secondary, centred, `text-wrap: pretty`); 20 px gap; primary button (50 px high,
accent fill, radius full, auto width with 24 px padding, min 200 px); optional secondary text button (Body, accent)
12 px below. EmptyStates enter with `smooth` and never animate repeatedly.

---
## 4. Screens

Each screen gives: purpose, layout top to bottom, data, actions, states, copy. "n/a" in a states table is deliberate.

### 4.1 Onboarding

Goal: first scan under 30 s after sign-in (`research/23` §6). Path for a new owner in standalone:
Welcome (sign in) → Create household (one screen, two fields) → Accueil empty state → Scan → camera primer → first
item. Install guidance comes before sign-in in Safari, because Safari storage does not carry into the Home Screen app
(`research/21` §9.1). Notification permission is not asked during onboarding (4.1.10).

#### 4.1.1 Welcome `/welcome`

Purpose: say what Cellier is in one line and get the user signed in, or installed first when in Safari.

Layout (limestone background, no navigation bar):

| Order | Element | Spec |
|---|---|---|
| 1 | Category motif | Three `CategoryTile`s 56 px (Vins `wine`, Épicerie `wheat`, Produits laitiers `milk`), 12 px apart, centred, top at 26 % of the viewport. Static. Hidden from VoiceOver. |
| 2 | `Wordmark` | «Cellier» `app.name`, serif semibold 48/52, centred, 24 px below the motif. |
| 3 | Tagline | «Ce qu’il y a à la maison, et ce qu’il faudra racheter.» `welcome.tagline`, Body, secondary, centred, max width 280 px, 10 px below. |
| 4 | Bottom action area | Anchored to bottom inset + 24 px, side margins 16. Content depends on context (below). |

Bottom action area:

- **Standalone, or not iOS:** `GoogleSignInButton` (below), then 16 px gap, legal footnote «En continuant, vous
  acceptez les conditions d’utilisation et la politique de confidentialité.» `auth.legal` (Footnote, secondary,
  centred; the two phrases are links `auth.legal.terms` «conditions d’utilisation», `auth.legal.privacy`
  «politique de confidentialité» → `/legal/terms`, `/legal/privacy`).
- **iOS Safari, not standalone:** reason line «Installé sur l’écran d’accueil, Cellier s’ouvre en plein écran et peut
  envoyer des alertes.» `welcome.install.reason` (Subhead, secondary, centred); 16 px; primary button «Ajouter à
  l’écran d’accueil» `welcome.install.cta` (50 px, accent fill) → `?sheet=install`; 8 px; text button «Continuer dans
  Safari» `welcome.install.skip` (Body, accent) which replaces the area with the standalone variant (sign-in).
- **iOS, other browser (Chrome, Firefox on iOS):** line «Pour installer Cellier, ouvrir cette page dans Safari.»
  `welcome.install.otherBrowser`, button «Copier le lien» `welcome.install.copyLink` (toast «Lien copié»
  `toast.linkCopied`), text button «Continuer ici» `welcome.install.continueHere`.

`GoogleSignInButton`: the Google Identity Services rendered button (`research/17` §3.1). It is an iframe we cannot
restyle; only Google's options apply: `type: 'standard'`, `theme: 'outline'` (light) / `'filled_black'` (dark,
re-rendered on `prefers-color-scheme` change), `size: 'large'` (40 px), `text: 'continue_with'` (renders
«Continuer avec Google» in French with `locale: 'fr'`), `shape: 'pill'`, `logo_alignment: 'center'`,
`width: min(container, 400)`. It sits centred in a 48 px slot so the hit area meets 44 px. Nothing overlaps or clips
it. If the GIS script fails to load or the popup flow fails twice, the slot swaps to our own fallback button for the
PKCE redirect, drawn to Google's branding rules: 48 px pill, white (light) or black (dark) fill, official multicolour
"G" 20 px, label «Continuer avec Google» `auth.google.fallback`.

States:

| State | Behaviour and copy |
|---|---|
| Signing in | The slot shows «Connexion…» `auth.signingIn` with an inline activity indicator 16 px (network wait, allowed). |
| Cancelled popup | Footnote under the button: «Connexion annulée.» `auth.error.cancelled` |
| Offline | Button disabled; «Pas de connexion internet. Vérifier le réseau, puis réessayer.» `auth.error.offline` |
| Other failure | «La connexion avec Google n’a pas abouti. Réessayer.» `auth.error.generic` |
| Signed in, household exists | `replace` to `/` (first sync if store empty). |
| Signed in, no household, invite pending in sessionStorage | `/onboarding/join?code=…`. |
| Signed in, no household | `/onboarding/household`. |
| Loading local, pending sync, conflict | n/a |

#### 4.1.2 InstallGuideSheet `?sheet=install`

Purpose: get the app onto the Home Screen without `beforeinstallprompt` (unsupported on iOS).

`SheetContainer` auto. Header: title «Ajouter à l’écran d’accueil» `install.title`, trailing «OK». Then three
`InstallStep` rows (number in a 28 px accent-tinted circle, rounded; title Body semibold; detail Subhead secondary;
right side a 44 px illustration of the glyph):

| Step | Title | Detail | Glyph |
|---|---|---|---|
| 1 | «Toucher Partager» `install.step1.title` | «L’icône de partage dans la barre de Safari. Sur iOS 26, toucher d’abord « … ».» `install.step1.detail` | iOS share glyph (square + arrow), drawn as SVG |
| 2 | «Choisir « Sur l’écran d’accueil »» `install.step2.title` | «Faire défiler la liste si l’option n’est pas visible.» `install.step2.detail` | Lucide `square-plus` |
| 3 | «Toucher « Ajouter »» `install.step3.title` | «Sur iOS 26, laisser « Ouvrir comme app web » activé.» `install.step3.detail` | none |

Footer (Footnote, secondary): «Ensuite, ouvrir Cellier depuis son icône : la connexion se fera là-bas.»
`install.footer`. Primary button «J’ai compris» `install.done`. The iOS 26 labels are UNVERIFIED (`research/21` §9.2)
and must be checked on device before release.

#### 4.1.3 Auth callback `/auth/callback`

Purpose: finish the PKCE fallback. Shows the Wordmark and «Connexion…» while exchanging. If it lands in Safari
without a verifier: title «Connexion ouverte dans Safari» `auth.callback.wrongContext.title`, body «Pour terminer,
ouvrir Cellier depuis l’écran d’accueil et toucher « Continuer avec Google ».» `auth.callback.wrongContext.body`.
Expired code: «Le lien de connexion a expiré.» `auth.callback.expired`, button «Recommencer» `auth.callback.restart`
→ `/welcome`.

#### 4.1.4 Household choice `/onboarding/household`

Purpose: create or join. Layout: navigation row empty; large serif title «Votre foyer» `onboarding.household.title`
(34 px, x = 16, top inset + 44); body «Le foyer réunit les personnes qui partagent le même stock.»
`onboarding.household.body` (Body, secondary, 8 px below); 32 px; two `OptionCard`s (inset list rows of 76 px: 36 px
accent-tinted icon tile, title Headline, detail Subhead secondary, trailing `chevron-right`):

- `house-plus`: «Créer un foyer» `onboarding.household.create.title` / «Pour commencer votre propre stock.»
  `onboarding.household.create.detail` → `/onboarding/create`
- `users`: «Rejoindre un foyer» `onboarding.household.join.title` / «Avec un lien ou un code d’invitation.»
  `onboarding.household.join.detail` → `/onboarding/join`

Footer text button «Se déconnecter» `account.signOut` (Footnote, secondary) at the bottom. States: n/a except offline
(cards stay enabled; the next screen explains).

#### 4.1.5 Create household `/onboarding/create`

Purpose: create the household and its first cellier in one step.

| Order | Element | Spec / copy |
|---|---|---|
| 1 | Nav | `BackButton`; trailing «Créer» `common.create` (disabled while a field is empty) |
| 2 | Title | Serif 34 «Créer le foyer» `onboarding.create.title` |
| 3 | Inset list, 2 `TextField` rows (52 px) | Label «Nom du foyer» `onboarding.create.householdLabel`, value prefilled «Chez {firstName}» `onboarding.create.householdDefault` (fallback «Mon foyer» `onboarding.create.householdFallback`), placeholder «Ex. : Chez les Martin» `onboarding.create.householdPlaceholder`. Label «Premier cellier» `onboarding.create.pantryLabel`, prefilled «Cave» `pantry.defaultName`, text selected on focus. |
| 4 | `ChipGroup` under the second field | «Cave», «Cuisine», «Cellier», «Garage», «Placard» (`pantry.suggestions`); tapping replaces the field value (`snappy`). |
| 5 | Footer | «Un cellier est un lieu de rangement. D’autres pourront être ajoutés plus tard.» `onboarding.create.footer` |
| 6 | Primary button | «Créer» `common.create`, 50 px, bottom of content (also the keyboard return key) |

Decision: the default cellier name is «Cave». It names the place most worth tracking in this product (the basement
reserve), and it differs from the app name, so the Accueil title reads as a place the user can rename, not as a logo.
Validation: «Donner un nom au foyer.» `onboarding.create.householdRequired`, «Donner un nom au cellier.»
`onboarding.create.pantryRequired`. Offline: 2.5.3. On success: `replace` to `/` (Accueil empty state, 4.2.6).

#### 4.1.6 Join with a code `/onboarding/join`

Layout: `BackButton`; serif title «Rejoindre un foyer» `onboarding.join.title`; body «Saisir le code reçu du
propriétaire du foyer.» `onboarding.join.body`; inset `TextField` (52 px), label «Code d’invitation»
`onboarding.join.codeLabel`, placeholder «XXXX-XXXX» `onboarding.join.codePlaceholder`, monospace-free: SF Pro
Rounded tabular 20 px, uppercase, auto-inserted hyphen after 4 characters, ambiguous letters normalised
(O→0, I/L→1; Crockford alphabet), `autocapitalize="characters"`, `autocomplete="one-time-code"`; prefilled from
`?code=`. Button «Rejoindre» `onboarding.join.cta` enabled at 8 characters.

| Error (Footnote, brick, under the field) | Key |
|---|---|
| «Ce code n’existe pas. Vérifier les caractères.» | `onboarding.join.error.notFound` |
| «Ce code a expiré. Demander un nouveau code au propriétaire du foyer.» | `onboarding.join.error.expired` |
| «Ce code a déjà servi. Demander un nouveau code au propriétaire du foyer.» | `onboarding.join.error.used` |
| «Ce compte fait déjà partie de « {household} ». Quitter ce foyer d’abord, dans Réglages.» | `onboarding.join.error.alreadyMember` |
| «Connexion nécessaire pour rejoindre un foyer.» | `onboarding.join.offline` |

On success → `/onboarding/joined`.

#### 4.1.7 Joined `/onboarding/joined`

Centred: Wordmark-sized serif line «Bienvenue dans « {household} » !» `onboarding.joined.title` (one of the two
allowed exclamations; Title 1 serif 28, centred, balance), body «Le stock du foyer arrive sur cet iPhone.»
`onboarding.joined.body`. No button: `replace` to `/` once the first pull has returned the pantries, or after 1.5 s,
whichever is later (then 2.5.2 applies).

#### 4.1.8 Join landing `/join#CODE`

Purpose: an invite link usually opens in Safari, not in the installed app. The page lets the invitee accept in
Safari (membership is server-side), then install and sign in with the same account in the app, which then skips
onboarding. The code is shown as a fallback.

Layout: Wordmark 34 serif at top inset + 32; card (inset, radius 20, padding 20):
- Title (Title 2) «Invitation» `join.title`
- Body «{inviter} vous invite à rejoindre « {household} » sur Cellier.» `join.body` (from a pre-auth RPC that returns
  only the household name and the inviter's first name; when it fails: «Invitation à rejoindre un foyer sur
  Cellier.» `join.bodyFallback`)
- `InviteCodeDisplay`: «K7PM-4QXD» rounded tabular 28, letter-spaced, with «Copier le code» `invite.copyCode`

Then by context:

| Context | Content |
|---|---|
| Standalone | `GoogleSignInButton`; on sign-in, accept → `/onboarding/joined`. |
| Safari, signed out | Step line «1. Accepter avec votre compte Google» `join.safari.step1` + `GoogleSignInButton`. |
| Safari, after accepting | Check icon + «Invitation acceptée» `join.accepted.title`; «Ajouter Cellier à l’écran d’accueil, puis se connecter avec le même compte Google : le foyer y sera.» `join.accepted.body`; button «Afficher les étapes» `join.accepted.showSteps` (→ `?sheet=install`); text button «Continuer dans Safari» `welcome.install.skip` (→ `/`). |
| Errors | Same strings as 4.1.6 (`onboarding.join.error.*`). |

#### 4.1.9 Camera permission primer (inside ScannerCover)

Shown the first time the scanner opens on a device (local flag `cameraPrimed` not set). It replaces the viewfinder on
the black cover: Lucide `scan-barcode` 40 px in white at 30 % height; title «Scanner les codes-barres»
`scanner.primer.title` (Title 2, white, centred); body «La caméra ne sert que pendant le scan. Les images restent sur
cet iPhone.» `scanner.primer.body` (Subhead, white 70 %, max width 300); primary button «Autoriser la caméra»
`scanner.primer.allow` (accent, 50 px) which calls `getUserMedia` from its tap; text button «Saisir un code à la
place» `scanner.primer.manual` (→ ManualEntrySheet). The close button stays at top-left. After a grant the flag is set
and the primer never shows again; the ScanButton tap then starts the camera directly. If iOS re-prompts in standalone
(`research/08` §5), the system prompt simply appears; no primer.

#### 4.1.10 Notification permission moment

Decision: not during onboarding. The first moment is the first time the user returns to Accueil after a committed
scan session (they now have stock worth watching), and only in standalone with `Notification.permission ===
'default'`. A `NotificationPromptCard` appears at the top of Accueil (4.2.2); its button calls
`Notification.requestPermission()` from the tap. Second entry point: on Item detail, the «Alerte» section shows a
row «Recevoir les alertes sur cet iPhone» `item.alert.enablePush` → NotificationPrimerSheet (4.14.2). «Plus tard»
hides the card for 14 days; the second «Plus tard» hides it for good (Réglages stays available).

### 4.2 Accueil `/`

Purpose: what is running out, and when the next shopping trip is likely, at a glance.

#### 4.2.1 Layout

| Order | Element | Spec |
|---|---|---|
| 1 | `LargeTitleHeader` | Title = `PantrySwitcher` (current cellier or «Tous les celliers»). Trailing `AvatarButton`. SyncIndicator line when visible. |
| 2 | `StatusBanner` (conditional) | Session expired (2.5.9). |
| 3 | `NotificationPromptCard` (conditional) | 4.2.2. 16 px below header. |
| 4 | Section «Bientôt épuisé» | 4.2.3. 24 px top margin. |
| 5 | `NextTripCard` | 4.2.4. 24 px top margin. |
| 6 | Section «Récemment» | 4.2.5. 24 px top margin. |
| 7 | Safari-only row | Inset single row «Ajouter Cellier à l’écran d’accueil» `home.installRow` (Lucide `square-plus`, accent text) → `?sheet=install`; swipe trailing «Masquer» `common.hide` hides it for 30 days. |
| 8 | Bottom padding | Tab bar clearance (3.1). |

Section headers: Headline 17 semibold, sentence case, x = 32 (aligned with row text inside the inset list), 8 px
above the list; optional trailing text button (Subhead, accent) aligned right at 32 px from the edge.

#### 4.2.2 NotificationPromptCard

Inset card, radius 20, padding 16, raised surface. Leading 36 px accent-tinted tile with Lucide `bell`; title
«Être prévenu avant qu’il manque quelque chose» `notify.card.title` (Headline); body «Une alerte quand un article
passe sous son seuil, et un résumé à 18 h les jours de courses.» `notify.card.body` (Subhead secondary); buttons
row: «Activer» `notify.card.enable` (accent fill, 36 px high, pill) and «Plus tard» `common.later` (text). Close
`x` IconButton top-right, label «Plus tard» `common.later`. After the system prompt: granted → toast «Notifications
activées» `toast.notifyOn` and the card leaves (`smooth`); denied → toast «Notifications refusées. Modifiable dans
Réglages iOS.» `toast.notifyDenied` and the card leaves for good.

#### 4.2.3 Section «Bientôt épuisé» `home.low.title`

What makes a product appear: `isRunningLow` from `research/24` §4, on the household total: `stock ≤ seuil`, or days of
cover ≤ lead time (2 days) + safety (2 days) when the product has at least 2 withdrawals in 90 days. Hysteresis: once
flagged, it stays until stock reaches `max(seuil + 1, ceil(50 % of stock habituel))`. In a specific cellier view,
only flagged products with a stock row in that cellier are listed.

Order (urgency): (1) products at 0, by name; (2) products with a forecast, by median days of cover ascending;
(3) products low by seuil only, by `stock / seuil` ascending, then name (`Intl.Collator('fr')`).

Rows: `ItemRow` variant `low`, at most 5. When more: a last row «Voir les {n} articles» `home.low.seeAll` (accent,
centred) → `/groceries`. Row tap → `/items/$productId`. No swipe actions on Accueil.

Nothing low (household has stock): a single 60 px inset row with Lucide `check` in a 36 px stone tile, title «Rien ne
manque» `home.low.none.title`, secondary «À surveiller : {product}, ≈ {d} j» `home.low.none.next` (the product with
the smallest forecast cover, if it has a medium or high confidence forecast), else «Les articles sous leur seuil
apparaîtront ici.» `home.low.none.body`.

#### 4.2.4 NextTripCard

Inset card, radius 20, padding 16, whole card tappable → `/groceries` (`press`). Content:

| Line | Spec | Copy |
|---|---|---|
| Label | Footnote, secondary | «Prochaines courses» `trip.label` |
| Date | Title 2 22/28 semibold, system font | phrasing table below |
| Explanation | Subhead, secondary, `text-wrap: pretty` | table below |
| Summary row | 12 px top. Up to 4 overlapping `CategoryTile`s 28 px (−6 px overlap, 2 px ring in the card colour), then Subhead «{n} article / {n} articles» `trip.count`, then trailing `chevron-right` | |
| Preview | Footnote secondary, 1 line: «{a}, {b}, {c} et {n} autres» `trip.preview` (names of the 3 most urgent) | |

Date phrasing (`tripAt` and `cadence.confidence` from `research/24`):

| Case | Text | Key |
|---|---|---|
| tripAt is today | «aujourd’hui» | `time.today` |
| tomorrow | «demain» | `time.tomorrow` |
| high confidence | «{weekday} {d} {month}» e.g. «samedi 16 nov.» | Intl |
| medium | «vers {weekday} {d} {month}» | `trip.date.approx` |
| low or no cadence (fewer than 3 trips) | «cette semaine» / «la semaine prochaine» / «semaine du {d} {month}» | `trip.date.thisWeek`, `trip.date.nextWeek`, `trip.date.weekOf` |

Explanation line (first matching):

| Case | Text | Key |
|---|---|---|
| Trip pulled forward by run-outs (3rd-soonest rule) | «Avancées : {n} articles seront épuisés d’ici là.» | `trip.reason.pulledForward` |
| high, usual weekday ≥ 50 % of trips | «En général le {weekday}, tous les {g} jours environ.» | `trip.reason.cadenceWeekday` |
| high or medium | «D’après vos {n} derniers passages.» | `trip.reason.cadence` |
| low / none | «Date indicative : encore peu de courses enregistrées.» | `trip.reason.thin` |

Empty list: date line as usual; summary row replaced by «Rien à prévoir pour l’instant» `trip.empty`. Brand-new
household: card hidden.

#### 4.2.5 Section «Récemment» `home.recent.title`

Trailing header button «Tout voir» `common.seeAll` → `/activity`. Up to 3 `ActivityRow`s (4.3). Hidden when the
household has no movements.

#### 4.2.6 States

| State | Accueil |
|---|---|
| Brand-new household (no products) | Sections 4–6 replaced by `EmptyState`: icon `scan-barcode`; title «Le stock commence par un scan» `home.empty.title`; body «Scanner les produits en les rangeant. Cellier compte les quantités et prévient avant qu’ils manquent.» `home.empty.body`; primary «Scanner un produit» `home.empty.scan` (opens ScannerCover, add); secondary «Ajouter sans code-barres» `home.empty.manual` (→ `?sheet=new-item`). Owner only, below: text button «Inviter un membre du foyer» `home.empty.invite` (→ settings invite). |
| Nothing running low | 4.2.3 "nothing low" row. |
| Loading from local | Renders immediately. |
| First sync | `SkeletonRow` × 3 in «Bientôt épuisé»; card shows a 60 % / 35 % bar skeleton; indicator «Chargement du foyer…». |
| Offline / pending | Indicator only. |
| Conflict resolved | n/a (silent; history on item). |
| Error | Indicator only. |

### 4.3 Activity `/activity` (and Réglages › Foyer › Activité)

Purpose: who changed what, including server adjustments; the household's audit trail.

Layout: `LargeTitleHeader` title «Activité» `activity.title` (serif), back to Accueil. Sections per day, header
«Aujourd’hui» / «Hier» / «{weekday} {d} {month}» (Headline). Rows: `ActivityRow` (min 60 px): 36 px stone tile with
Lucide `plus` (additions), `minus` (withdrawals), `arrow-left-right` (moves), `pencil` (edits), `scale` (adjusted);
title Body; secondary Subhead «{member} · {time}» (`activity.row.meta`; the current user shows as «Vous»
`common.you`). Scan sessions (movements by one member within 10 min, same direction) are one row with a disclosure
chevron that expands (`smooth`) into the product list with quantities.

| Entry | Title | Key |
|---|---|---|
| Session add | «Ajout de {n} articles · {pantry}» (one: «Ajout de {n} article · {pantry}») | `activity.addSession` |
| Session withdraw | «Retrait de {n} articles · {pantry}» | `activity.withdrawSession` |
| Single add | «{product} · +{qty}» | `activity.add` |
| Single withdraw | «{product} · −{qty}» | `activity.withdraw` |
| Recount | «{product} · recompté {from} → {to}» | `activity.recount` |
| Move | «{product} · {from} → {to} ({qty})» | `activity.move` |
| Clamped | «{product} · retrait ajusté : {applied} sur {requested}» | `activity.clamped` |
| Put away from Courses | «Courses rangées · {n} articles · {pantry}» | `activity.putAway` |
| Field edit | «{product} · {field} : {old} → {new}» | `activity.edit` |
| Product created / deleted / restored | «{product} · ajouté au stock» / «supprimé» / «restauré» | `activity.created`, `activity.deleted`, `activity.restored` |
| Member joined / left / removed | «{member} a rejoint le foyer» / «{member} a quitté le foyer» / «{member} ne fait plus partie du foyer» | `activity.memberJoined`, `activity.memberLeft`, `activity.memberRemoved` |

Empty: `EmptyState` icon `rotate-ccw-clock`, «Aucune activité pour l’instant» `activity.empty.title`, body «Les ajouts,
retraits et modifications du foyer s’afficheront ici.» `activity.empty.body`, no button. Pending entries show
«En attente d’envoi». Loads 50 days at a time (virtualised).

### 4.4 Scanner (ScannerCover) `?cover=scan&mode=add|withdraw`

Purpose: add or withdraw many products quickly, one scan each, with quantities and a single commit.

#### 4.4.1 Layout (true black, full screen, status bar light)

| Order | Element | Spec |
|---|---|---|
| 1 | `CameraViewport` | `<video playsinline muted autoplay>` full-bleed `object-fit: cover`. Mounted for the cover's lifetime. |
| 2 | Dim mask | Black 45 % everywhere except the reticle cut-out. |
| 3 | `Reticle` | Width = screen − 64 px, height 160 px, radius 20, centred horizontally, vertical centre at 36 % of the viewport. Drawn as four corner brackets (28 px arms, 4 px stroke, round caps): accent (lifted) in add mode, white in withdraw mode. The decode ROI (`research/08` §7) matches it. |
| 4 | `ScannerTopBar` | At top inset + 8: leading `IconButton` close (`x`, 44 px circle on dark material), centred `SegmentedControl` (width 220, height 36): «Ajouter» `scanner.mode.add` / «Retirer» `scanner.mode.withdraw` (indicator `snappy`); trailing `TorchButton` (`flashlight` / `flashlight-off`, 44 px circle; hidden if `applyConstraints({torch})` throws). |
| 5 | Hint | 16 px below the reticle, Footnote white 70 %, centred: add «Placer le code-barres dans le cadre» `scanner.hint.add`; withdraw «Mode retrait : scanner ce qui sort du cellier» `scanner.hint.withdraw`. Fades out after the first recognised code of the session. |
| 6 | `LowLightHint` | Replaces the hint when frames are dark for 2 s without a decode: pill (dark material, 36 px) «Peu de lumière · Allumer la lampe» `scanner.lowLight.torch` (tap turns torch on), or without torch «Peu de lumière : se rapprocher d’une lampe» `scanner.lowLight.noTorch`. |
| 7 | Manual entry | `IconButton` `keyboard` 44 px circle, bottom-left of the viewfinder area, 16 px above the tray; label «Saisir un code» `scanner.manual`. Opens ManualEntrySheet. |
| 8 | `ScannerTray` | 4.4.2. |

#### 4.4.2 ScannerTray

A panel on dark material at the bottom, radius 28 top corners, full width, grabber. Detents: compact (header + 2
rows, 200 px + bottom inset) and expanded (60 % of the viewport); drag between them (`fling`). Empty tray: header
only, 64 px + bottom inset.

Header (56 px, padding 16):
- Leading: pantry chip (32 px pill, dark material): add «Vers {pantry}» `scanner.tray.to`, withdraw «Depuis
  {pantry}» `scanner.tray.from`, with `chevron-down`. Hidden when the household has one cellier. Tap → PantryPicker.
- Middle: «{n} article / {n} articles» `scanner.tray.count` (Subhead, white 70 %), counting units.
- Trailing: «Terminer» `scanner.tray.done`, 36 px pill, accent fill; disabled (white 20 % fill) when no row is
  committable.
- Empty tray body text: «Les produits scannés s’afficheront ici.» `scanner.tray.empty`.

`ScannerTrayRow` (64 px, newest on top, insert with `smooth`, the product tile enters with `pop`): 36 px tile (photo
if known, else CategoryTile, else a stone tile with Lucide `barcode`); name (Subhead semibold, white); status line
(Footnote, white 60 %); trailing compact `QuantityStepper` (32 px visual buttons, 44 px hit, value rounded 17 px,
default 1). At quantity 1 the minus becomes Lucide `trash-2` (label «Enlever de la liste» `scanner.row.remove`).
Swipe left reveals «Enlever» `scanner.row.removeShort` (H2 at the threshold). Tapping the value opens QuantityKeypad
(bulk, e.g. a case of 12).

#### 4.4.3 Recognition and lookup states (per row)

Order of lookup: local store → `catalog_products` → Open Food Facts → manual (`00-decisions`).

| State | Name line | Status line | Committable | Key(s) |
|---|---|---|---|---|
| Recognising (code read, lookup running) | Digits of the code, rounded tabular | «Recherche…» | No (waits) | `scanner.row.searching` |
| Found in household (local) | Product name | Add: «En stock : {n}» · Withdraw: «En stock dans {pantry} : {n}» | Yes | `scanner.row.inStock`, `scanner.row.inStockPantry` |
| Found in catalogue | Name | «{brand} · {size} · nouveau dans le stock» | Yes | `scanner.row.newCatalog` |
| Found online (OFF) | Name | «Open Food Facts · nouveau dans le stock» | Yes | `scanner.row.newOff` |
| Offline, unknown locally | «Code {digits}» | «Hors ligne : sera complété plus tard» | Yes (placeholder product, auto-filled when online) | `scanner.row.code`, `scanner.row.offline` |
| Not found anywhere | «Produit inconnu» | Button «Nommer» → UnknownProductSheet | Yes (saved as «Article sans nom», flagged «À compléter») | `scanner.row.unknown`, `scanner.row.name` |
| In-store variable-measure code (prefix 02, 20–29) | «Code magasin» | Button «Choisir l’article» → StoreCodeSheet | No until chosen | `scanner.row.storeCode`, `scanner.row.pickItem` |
| Invalid checksum | no row (ignored silently) | | | |

H1 fires when a row is created or incremented (the code is recognised). A failed lookup never vibrates.

#### 4.4.4 Duplicates and continuous scanning

The camera and worker stay live across scans. The same code is ignored for 1.5 s and until it has left the frame
for 300 ms (`research/08` §7). A repeat of a code already in the tray increments that row by 1 (value `pop`, row
moves to the top, H1). Torch state persists across scans.

#### 4.4.5 Add mode specifics

All committable rows target the tray's cellier (default: current cellier; in «Tous les celliers», the last cellier
used for adding). Changing the chip retargets every row.

#### 4.4.6 Withdraw mode specifics

- Source per row: the tray's cellier if the product has stock there; else the only cellier holding it; else the row
  asks «Choisir le cellier» `scanner.row.choosePantry`.
- Not in the chosen cellier but elsewhere: status «Pas en stock dans {pantry} · {n} dans {other}»
  `scanner.row.elsewhere` + button «Retirer de {other}» `scanner.row.takeFrom`.
- Not in stock anywhere / unknown to the household: row muted (50 % opacity), status «Absent du stock : ignoré»
  `scanner.row.absent`, stepper hidden, not committable.
- Withdraw more than available: the stepper's maximum is the local quantity in the source cellier; at the maximum
  the plus is disabled and the status line ends with «· max. {n}» `scanner.row.max`. The server may still clamp
  (2.5.6).
- Switching mode with rows in the tray keeps the rows and re-evaluates them for the new mode (`smooth`).

#### 4.4.7 Commit and undo

«Terminer» commits one mutation per row (product creations first), stops the camera tracks, closes the cover
(`sheet` reversed), then shows a `Toast` on the screen beneath:

| Result | Toast | Key |
|---|---|---|
| Add, one cellier | «{n} articles ajoutés à {pantry}» (one: «{n} article ajouté à {pantry}») | `toast.scan.added` |
| Withdraw, one cellier | «{n} articles retirés de {pantry}» | `toast.scan.withdrawn` |
| Withdraw, several celliers | «{n} articles retirés» | `toast.scan.withdrawnMulti` |
| Action | «Annuler» → compensating mutations; then toast «Annulé» | `common.undo`, `toast.undone` |

Counts are units. Rows that are not committable are skipped and named in the toast: «… · {k} ignorés»
`toast.scan.skipped`.

#### 4.4.8 Overlays (local state, not in the URL)

| Overlay | Content |
|---|---|
| PantryPicker (auto sheet, dark) | Title «Vers quel cellier ?» `scanner.pantryPicker.to` / «Depuis quel cellier ?» `scanner.pantryPicker.from`; rows name + «{n} articles»; check on current. |
| UnknownProductSheet (large, dark) | Header «Annuler» / «Nouveau produit» `scanner.unknown.title` / «OK» `common.done`. Footnote «Code {digits}». `TextField` «Nom» `field.name`, placeholder «Ex. : Lessive Le Chat 2 L» `scanner.unknown.placeholder`, autofocus. `CategoryPicker` grid (4 columns of 72 px cells: 44 px tile + Caption 1 label), default «Autres». OK enabled when a name is entered. |
| StoreCodeSheet (large, dark) | Title «Code magasin» `scanner.storeCode.title`; body «Ce code est imprimé par le magasin pour un produit pesé ou à la coupe. Il n’identifie pas le produit : choisir l’article correspondant.» `scanner.storeCode.body`; `SearchField` «Rechercher un article» `scanner.storeCode.search`; results as ItemRows; last row «Créer « {query} »» `common.createNamed`. The code is never stored as the product's barcode. |
| ManualEntrySheet (auto, dark) | Title «Saisir un code» `scanner.manualEntry.title`; field placeholder «Code-barres ou nom de l’article» `scanner.manualEntry.placeholder` (`inputmode="text"`); digits are validated as a GTIN on submit, text searches the household's products; button «Valider» `common.confirm`. Invalid code: «Ce code n’est pas valide. Vérifier les chiffres.» `scanner.manualEntry.invalid`. |
| QuantityKeypad (auto, dark) | Title = product name; native numeric input (`inputmode="numeric"`), rounded 34; «OK». In withdraw, values above the maximum are refused: «Il n’y en a que {n} dans {pantry}.» `scanner.keypad.max`. |
| Close ConfirmDialog | Title «Enregistrer les {n} articles ?» `scanner.close.title`; buttons «Enregistrer» `common.save`, «Abandonner» `scanner.close.discard` (destructive, H4), «Continuer le scan» `scanner.close.continue` (cancel). |

#### 4.4.9 Draft persistence

The tray is written to IndexedDB on every change. If the app is killed, the next scanner open restores it with a
one-line banner in the tray header area: «Scan précédent repris : {n} articles» `scanner.restored` (fades after 4 s).

#### 4.4.10 Accessibility

Rows announce through a polite live region: «{product} ajouté, quantité {n}» `a11y.scanner.added` /
«{product}, retrait, quantité {n}» `a11y.scanner.withdrawn`. Close label «Fermer le scanner» `a11y.scanner.close`.
Torch labels «Allumer la lampe» `a11y.scanner.torchOn` / «Éteindre la lampe» `a11y.scanner.torchOff`.

#### 4.4.11 Camera states

| State | Display (replaces the viewfinder; close and segmented control remain) |
|---|---|
| Starting | Black, reticle visible, no spinner (typically < 500 ms). |
| First use | PermissionPrimer (4.1.9). |
| Permission denied | Icon `camera-off` 40 px; «Accès à la caméra refusé» `scanner.denied.title`; «Pour scanner, autoriser la caméra : Réglages › Safari › Caméra › Autoriser. Puis rouvrir le scanner.» `scanner.denied.body`; buttons «Réessayer» `common.retry`, «Saisir un code» `scanner.manual`. |
| Unavailable (in use, no camera, constraints fail) | Icon `camera-off`; «Caméra indisponible» `scanner.unavailable.title`; «Elle est peut-être utilisée par une autre app. Fermer cette app, puis réessayer.» `scanner.unavailable.body`; same buttons. |
| Offline | Works; lookups beyond the local store become «Hors ligne» rows. |
| Pending sync, conflict, empty | n/a in the scanner (tray empty state covered above). |

### 4.5 Stock `/stock`

Purpose: everything the household has, findable in two seconds.

#### 4.5.1 Layout

| Order | Element | Spec |
|---|---|---|
| 1 | `LargeTitleHeader` | Title `PantrySwitcher`. Trailing `IconButton`s: `arrow-up-down` «Trier et grouper» `a11y.stock.view` → `?sheet=stock-view`; `plus` «Ajouter un article» `a11y.stock.add` → `?sheet=new-item`. |
| 2 | `SearchField` | 36 px, radius 10, x = 16, 8 px below the title, Lucide `search` 17 px, placeholder «Rechercher dans {pantry}» `stock.search.placeholder` / «Rechercher» `stock.search.placeholderAll`. On focus: «Annuler» `common.cancel` slides in at the trailing edge (`snappy`); the large title collapses. Value in `?q=`. |
| 3 | Sections | Inset list sections per group (4.5.3), virtualised (TanStack Virtual). Section header Headline + trailing count (Subhead secondary, rounded). |
| 4 | Footer | Footnote secondary, centred: «{n} articles · {u} unités» `stock.footer` |

#### 4.5.2 Search

MiniSearch with diacritic folding and prefix matching over name, brand, category name and barcode digits («pate»
finds «Pâtes», «3017» finds Nutella). While `q` is not empty: one flat section ordered by relevance, no grouping.
No results: `EmptyState` icon `search`, «Aucun résultat» `stock.noResults.title`, «Rien ne correspond à « {q} ».»
`stock.noResults.body`, button «Créer « {q} »» `common.createNamed` (→ NewItemSheet prefilled).

#### 4.5.3 Sort and group (StockViewSheet `?sheet=stock-view`)

Sheet (auto): header title «Affichage» `stock.view.title`, trailing «OK». Two inset lists of radio rows (check
`snappy`) and one switch:

- «Grouper par» `stock.view.groupBy`: «Catégorie» (default), «Article», «Date d’ajout», «Prix», «Quantité».
- «Trier par» `stock.view.sortBy`: «Nom» (default), «Catégorie», «Récent», «Prix», «Quantité». Tapping the selected
  sort flips its direction; the row shows `arrow-up` / `arrow-down` (labels «croissant» `a11y.sort.asc` /
  «décroissant» `a11y.sort.desc`). «Catégorie» is hidden when grouping by category.
- Switch «Afficher les épuisés» `stock.view.showEmpty` (default on). H3.

Definitions:

| Option | Meaning |
|---|---|
| Group «Article» | No sections: one row per product, alphabetical letter headers (A, B, …) only when sorted by name. In «Tous les celliers», one row per product with its total and the per-cellier split on the secondary line. In one cellier, one row per product stocked there. |
| Group «Catégorie» | Sections in the household's category order (the Categories editor order). |
| Group «Date d’ajout» | Date of the latest addition to stock: «Aujourd’hui», «Cette semaine», «Ce mois-ci», «Plus ancien» (`stock.group.added.*`). |
| Group «Prix» | Known unit price: «Moins de 2 €», «De 2 à 5 €», «De 5 à 10 €», «Plus de 10 €», «Prix inconnu» (`stock.group.price.*`). |
| Group «Quantité» | «Épuisé», «1 en stock», «De 2 à 5», «De 6 à 11», «12 et plus» (`stock.group.qty.*`). |
| Sort «Nom» | `Intl.Collator('fr', { sensitivity: 'base' })`, A→Z default. |
| Sort «Récent» | Latest addition first by default. |
| Sort «Prix» | Highest first; unknown prices last in both directions. |
| Sort «Quantité» | Lowest first by default (what is running out). |

Defaults are not written to the URL; choices persist per device.

#### 4.5.4 Rows and swipe actions

`ItemRow` (3.3). `SwipeActions` decision: leading swipe (finger moves right) = «+1» on accent; trailing swipe = «−1»
on stone. Each is a single full-swipe action: crossing 50 % of the row width commits (H2), release animates with
`fling`, the quantity plays `pop`. +1 records a purchase movement; −1 records a consume movement. «−1» is not offered
at 0. In «Tous les celliers», swipes act on the current default cellier if it holds the product, otherwise on the
cellier with the most stock. Labels: «+1», «−1»; accessibility «Ajouter 1» `a11y.item.add1`, «Retirer 1»
`a11y.item.remove1`, also exposed as VoiceOver custom actions. No toast: the change is visible in the row and
reversible by the opposite swipe.

#### 4.5.5 NewItemSheet `?sheet=new-item`

Purpose: add a product without a barcode (fruit, bulk, homemade). Large detent. Header «Annuler» / «Nouvel article»
`newItem.title` / «Ajouter» `common.add`.

| Row | Spec |
|---|---|
| «Nom» `field.name` | TextField, placeholder «Ex. : Huile d’olive 1 L» `newItem.namePlaceholder`, autofocus. While typing, a section «Déjà dans le stock» `newItem.existing` lists matches with a trailing «+1» button that adds to the selected cellier and closes the sheet. |
| «Catégorie» `field.category` | Value + chevron → `&step=category` (CategoryPicker push). Default «Autres». |
| «Quantité» `field.quantity` | `QuantityStepper`, default 1. |
| «Cellier» `field.pantry` | Shown with ≥ 2 celliers; value = current cellier; tap → PantryPicker push. |

Validation: «Indiquer un nom.» `validation.nameRequired`. Name collision: «Un article s’appelle déjà « {name} ».»
`validation.nameTaken` with link «Ouvrir» `common.open`. On add: toast «{product} ajouté à {pantry}»
`toast.itemAdded`.

#### 4.5.6 States

| State | Stock |
|---|---|
| Empty cellier | `EmptyState` icon `package`, «Aucun article dans {pantry}» `stock.empty.title`, «Scanner un produit pour l’ajouter, ou l’ajouter à la main.» `stock.empty.body`, «Scanner un produit» `home.empty.scan`, «Ajouter à la main» `stock.empty.manual`. |
| No results | 4.5.2. |
| Loading local | Immediate. |
| First sync | 6 `SkeletonRow`s. |
| Offline / pending / error | Indicator only. |
| Conflict resolved | n/a (silent). |
| Products «À compléter» | Secondary line «À compléter» (amber text not used; secondary colour). |

### 4.6 Item detail `/…/items/$productId`

Purpose: everything about one product, and the place to correct it.

#### 4.6.1 Layout

| Order | Element | Spec |
|---|---|---|
| 1 | Nav | `BackButton` (previous title); trailing «Modifier» `common.edit` → `?sheet=item-edit&id=…`. Inline title (product name) appears once the header scrolls away. SyncIndicator icon in the nav row when not synced. |
| 2 | `ProductHeader` | Centred. Photo 112 × 112 radius 20 with a 1 px inset neutral outline (OFF image), or `CategoryTile` 112 (icon 56). 16 px. Name: serif Title 1 28/34, centred, max 3 lines, balance. 4 px. «{brand} · {size}» Subhead secondary. |
| 3 | Quantity block | 4.6.2. 24 px top. |
| 4 | «Par cellier» | 4.6.3 (only with stock rows in ≥ 2 celliers). |
| 5 | «Prévision» | 4.6.4. |
| 6 | «Alerte» | 4.6.5. |
| 7 | «Prix» | 4.6.6. |
| 8 | «Informations» | 4.6.7. |
| 9 | «Historique» | 4.6.8. |
| 10 | Actions | Inset list: «Déplacer vers un autre cellier» `item.move` (Lucide `arrow-left-right`, accent; shown with ≥ 2 celliers) → `?sheet=item-move&id=…`; «Supprimer l’article» `item.delete` (brick) → `&confirm=item-delete`. |
| 11 | Attribution | Footnote secondary, centred: «Informations produit : Open Food Facts (ODbL)» `item.attribution.off` + link «Voir sur Open Food Facts» `item.attribution.link` (opens Safari). Only when any field comes from OFF. |

#### 4.6.2 Quantity block

- Product stocked in one cellier: `QuantityStepper` large: minus and plus 44 px circles (stone fill, Lucide `minus` /
  `plus` 22 px), value between them rounded Large Title 34 tabular (min width 72, `pop` on change). Caption below:
  «en stock · {pantry}» `item.qty.caption`. Minus records consume, plus records purchase; minus disabled at 0.
  Tapping the value opens RecountSheet. Labels «Retirer 1» / «Ajouter 1», value «{n} en stock» `a11y.item.qtyValue`,
  hint «Toucher pour recompter» `a11y.item.recountHint`.
- Stocked in several celliers: value only (no stepper), caption «en stock dans {n} celliers» `item.qty.captionMulti`;
  steppers live on the per-cellier rows.
- Not stocked anywhere (0 after withdrawals): the single-cellier variant with value 0 and the last cellier.

RecountSheet (`?sheet=recount&id=…&pantry=…`, auto): header «Annuler» / «Recompter» `recount.title` /
«Enregistrer»; body «Combien en reste-t-il dans {pantry} ?» `recount.body`; centred numeric input rounded 34, current
value selected. Saves a recount movement (absolute, not demand).

#### 4.6.3 «Par cellier» `item.pantries.title`

One row per cellier holding a stock row (52 px): name (Body), trailing compact `QuantityStepper`. Footer none.

#### 4.6.4 «Prévision» `item.forecast.title`

Inset card, padding 16:

| Case | Headline (Title 3) | Band (`ForecastBand` + sentence) | Confidence line (Footnote secondary) |
|---|---|---|---|
| Stock 0 | «Épuisé» `forecast.out` | none | «Ajouté à la liste de courses.» `forecast.onList` |
| High confidence | «Il en reste pour ≈ {d} j» `forecast.cover.days` (≥ 14 days: «≈ {w} sem.» `forecast.cover.weeks`; ≥ 60: «Plus de 2 mois» `forecast.cover.months`) | «Épuisement probable entre le {earliest} et le {latest}.» `forecast.band` | «Estimation fiable · {n} retraits en 90 jours» `forecast.confidence.high` |
| Medium | same | «Épuisement vers le {median}, entre le {earliest} et le {latest}.» `forecast.bandMedian` | «Estimation approximative · {n} retraits en 90 jours» `forecast.confidence.medium` |
| Low (prior-driven) | «≈ {w} sem.» (never days) | none | «D’après des articles de la même catégorie : encore trop peu de retraits.» `forecast.confidence.low` |
| No withdrawals yet | «Pas encore de prévision» `forecast.none.title` | none | «La prévision apparaîtra après quelques retraits.» `forecast.none.body` |

`ForecastBand`: 24 px high horizontal track spanning today → latest + 10 %; a filled amber-tinted capsule from
earliest to latest (the 80 % band); a 2 px tick at the median; «Aujourd’hui» `time.today` Caption 2 under the left
end. Accessibility: «Épuisement probable entre le {earliest} et le {latest}, plus probablement le {median}»
`a11y.forecast.band`. Dates in the band use «{d} {month}».

#### 4.6.5 «Alerte» `item.alert.title`

| Row | Spec |
|---|---|
| «Seuil d’alerte» `item.alert.threshold` | Trailing compact stepper (min 0). Below the value, when a suggestion differs: chip «Suggéré : {n}» `item.alert.suggested` (tap applies, `snappy`). Suggestion = `max(1, ceil(25 % of stock habituel))` (`research/24` §4). |
| «Stock habituel» `item.alert.usual` | Value rounded + caption «Calculé» `source.computed` or «Saisi à la main» `source.manual`. Tap → edit sheet focused on this field. |
| «Recevoir les alertes sur cet iPhone» `item.alert.enablePush` | Only when standalone and permission is `default`. → NotificationPrimerSheet. |

Footer: «Signalé quand il en reste {n} ou moins. Le stock habituel sert à proposer la quantité à racheter.»
`item.alert.footer`.

#### 4.6.6 «Prix» `item.price.title`

Row: price (Body rounded, e.g. «1,89 €») with `SourceCaption`: «Open Prices · {store} · {date}» `source.openPrices`
or «Saisi à la main · {date}» `source.manualDated`. Unknown: «Prix inconnu» `item.price.unknown` + trailing
«Ajouter» `common.add` → edit sheet focused on price.

#### 4.6.7 «Informations» `item.info.title`

`PropertyRow`s (label left Body, value right Body secondary, `SourceCaption` Caption 1 under the value):
«Catégorie» `field.category`, «Contenance» `field.size`, «Marque» `field.brand`, «Code-barres» `field.barcode`
(rounded tabular digits). Sources: «Open Food Facts» `source.off`, «Saisi à la main» `source.manual`, «Modifié»
`source.overridden` (the value differs from the reference). Missing value: «—» in tertiary colour.

#### 4.6.8 «Historique» `item.history.title`

Last 5 `HistoryRow`s, then «Tout l’historique» `item.history.all` → `…/history` (same rows, grouped by day,
virtualised). `HistoryRow`: 28 px icon tile; title + trailing delta (rounded tabular); secondary «{member} ·
{pantry} · {time}».

| Entry | Title | Trailing | Key |
|---|---|---|---|
| Purchase | «Ajout» | «+{n}» | `history.add` |
| Consume | «Retrait» | «−{n}» | `history.withdraw` |
| Recount | «Recomptage» | «{from} → {to}» | `history.recount` |
| Move | «Déplacement · {from} → {to}» | «{n}» | `history.move` |
| Clamped | «Retrait ajusté» + detail «{applied} sur {requested} demandés» | «−{applied}» | `history.clamped.*` |
| Field edit | «{field} : {old} → {new}» | | `history.edit` |
| Overwritten | «Modification remplacée» + detail (2.5.5) + «Rétablir» | | `history.overwritten.*` |
| Pending | any of the above + «En attente d’envoi» with `clock` | | `history.pending` |

#### 4.6.9 Delete, move

- Delete ConfirmDialog (`confirm=item-delete`): title «Supprimer « {product} » ?» `item.delete.title`; message «Le
  stock ({n}) et l’historique de cet article disparaîtront pour tout le foyer.» `item.delete.message`; button
  «Supprimer l’article» (destructive, H4). Then pop to the list and toast «Article supprimé» `toast.itemDeleted` with
  «Annuler» (restores the tombstone).
- MoveSheet (`?sheet=item-move&id=…`, large): header «Annuler» / «Déplacer» `move.title` / «Déplacer» `move.cta`;
  rows «Depuis» `move.from` (PantryPicker, default: cellier with most stock), «Vers» `move.to`, «Quantité»
  `field.quantity` (stepper, default = all, max = source stock). Toast «{n} déplacés vers {pantry}» `toast.moved`
  (one: «{n} déplacé vers {pantry}»). Clamp: 2.5.6.

#### 4.6.10 States

| State | Item detail |
|---|---|
| Loading local | Immediate. |
| Product deleted by another member while open | Content stays, dimmed 50 %; banner «Article supprimé par {member}» `item.deletedRemotely` with «Restaurer» `common.restore`; Back works. |
| Unknown id (deep link to a deleted product) | `EmptyState` icon `package-x`, «Article introuvable» `item.notFound.title`, «Il a peut-être été supprimé.» `item.notFound.body`, button «Retour à l’accueil» `item.notFound.home`. |
| Offline / pending | Indicator icon; pending history entries. |
| Conflict resolved | History «Modification remplacée». |
| Thin history | Forecast «Pas encore de prévision» or low-confidence row. |

### 4.7 ItemEditSheet `?sheet=item-edit&id=…`

Purpose: correct or complete what auto-fill provided, with a way back to the reference value.

Large detent. Header «Annuler» / «Modifier» `itemEdit.title` / «Enregistrer» `common.save` (enabled when dirty and
valid). Sections (inset lists, `TextField` rows 52 px, label left 120 px column, input right-aligned):

| Section | Field | Input | Validation copy |
|---|---|---|---|
| «Article» `itemEdit.section.item` | «Nom» `field.name` | text | «Indiquer un nom.» `validation.nameRequired`; «Un article s’appelle déjà « {name} ».» `validation.nameTaken` |
| | «Marque» `field.brand` | text, optional | |
| | «Catégorie» `field.category` | → `&step=category` (CategoryPicker push) | |
| «Contenance» `itemEdit.section.size` | «Quantité» | decimal (`inputmode="decimal"`, comma accepted) | «Indiquer une contenance supérieure à 0.» `validation.sizePositive` |
| | «Unité» | `SegmentedControl`: «g», «kg», «ml», «cl», «L», «pièces» (`unit.*`) | |
| «Prix» `itemEdit.section.price` | «Prix unitaire» `field.unitPrice` | decimal, suffix «€» | «Indiquer un prix positif.» `validation.pricePositive` |
| «Alerte» `item.alert.title` | «Seuil d’alerte» | stepper | (stepper prevents negatives) |
| | «Stock habituel» `item.alert.usual` | stepper; a «Calculé» chip resets to automatic | |
| «Code-barres» `field.barcode` | read-only digits when set; otherwise «Ajouter un code-barres» `itemEdit.addBarcode` (numeric) | | «Ce code n’est pas valide. Vérifier les chiffres.» `scanner.manualEntry.invalid`; «Ce code appartient déjà à « {product} ».» `validation.barcodeTaken` |

**Override behaviour.** Fields with a reference value (from OFF, Open Prices, or the computed stock habituel) show,
when the user's value differs, a `SourceCaption` under the input: «{source} : {referenceValue}»
(`itemEdit.reference`) and a trailing `ResetOverrideButton` (Lucide `rotate-ccw` 17 px, 44 px hit, label «Rétablir la
valeur {source}» `a11y.itemEdit.reset`). Reset writes the reference value back and clears the override flag
(`snappy`). Validation runs inline on blur; the error text (Footnote, brick) sits under the row; the field gets a
brick hairline. Cancel or swipe-down with changes → ConfirmDialog (`confirm=discard`): «Abandonner les
modifications ?» `common.discard.title`, «Abandonner» `common.discard.confirm` (destructive, H4), «Continuer la
modification» `common.discard.cancel`. States: offline/pending: n/a (saves locally). Concurrent remote edit while
open: on save, per-field LWW applies; only changed fields are sent.

### 4.8 Courses `/groceries`

Purpose: the household's next shopping list, built for the user, editable, shareable.

Decisions:
- **Grouped by category**, in the household's category order. Store aisles are not known; reordering categories in
  the editor approximates the user's usual store layout.
- **Checking does not add to stock.** A checked row moves to «Dans le panier». Stock is added either by scanning
  on return (scanned products auto-clear their checked rows), or by «Ranger dans {pantry}», which records purchases at
  the suggested quantities in one tap with undo. Reason: checking happens in the shop, before anything is on the
  shelf; the scan or the put-away is the moment stock becomes true.
- Checked state, manual additions and dismissals are shared by the household (two people can split the list).

#### 4.8.1 Layout

| Order | Element | Spec |
|---|---|---|
| 1 | `LargeTitleHeader` | Serif «Courses» `groceries.title`. Trailing `IconButton` `share` «Partager la liste» `a11y.groceries.share`. |
| 2 | Trip header | Like NextTripCard content (4.2.4) without the summary row, not tappable, inset card. |
| 3 | Category sections | Header = category name with a 8 px category-hue dot; `GroceryRow`s. |
| 4 | Add row | Inset row «Ajouter un article» `groceries.add` (Lucide `plus`, accent). |
| 5 | «Dans le panier · {n}» `groceries.inCart` | Checked rows (opacity 50 %, name not struck through), then a full-width button «Ranger dans {pantry}» `groceries.putAway` (one cellier) / «Ranger les {n} articles» `groceries.putAwayMulti` (≥ 2 celliers → PutAwaySheet). |
| 6 | Footer note | Footnote secondary, only while forecasts are thin: «Les dates et quantités s’affinent au fil des semaines.» `groceries.thinFooter` |

`GroceryRow` (min 56 px): leading `CheckCircle` 24 px (44 px hit; check `snappy`; no haptic); name Body; reason line
Subhead secondary; trailing «× {n}» rounded tabular (Body). Tap on the quantity expands an inline compact
`QuantityStepper` in place (`smooth`); tap elsewhere collapses it. Tap on the name → item detail in the Courses stack.
Trailing swipe «Masquer» `common.hide` (H2): hides until the next purchase of that product; toast «Masqué jusqu’au
prochain achat» `toast.dismissed` with «Annuler».

Reason line (first matching):

| Case | Text | Key |
|---|---|---|
| Stock 0 | «Épuisé» | `forecast.badge.out` |
| Low by seuil | «Reste {qty}, seuil {seuil}» | `groceries.reason.threshold` |
| Low by forecast (medium/high) | «Reste {qty} · ≈ {d} j» | `groceries.reason.cover` |
| Runs out before the trip after next | «Épuisement vers le {date}» | `groceries.reason.runOut` |
| Manual, linked product | «Ajouté par {member}» | `groceries.reason.manual` |
| Manual, free text | «Ajouté par {member} · hors stock» | `groceries.reason.freeText` |

Suggested quantity: `max(1, ceil(stock habituel − stock))` (`research/24` §4); a user change is kept until the next
purchase. Rows within a section are ordered by urgency (`urgencyDays`), manual rows last.

#### 4.8.2 Manual additions

Tapping «Ajouter un article» turns the row into a `TextField` (placeholder «Nom de l’article»
`groceries.add.placeholder`, keyboard return «OK»). Below it, matching household products (up to 5) as rows with
category tile; selecting one adds it as a linked entry (quantity = suggested, or 1). Last suggestion row: «Ajouter
« {q} »» `groceries.add.freeText` creates a free-text entry in «Autres». Free-text entries are not stock-tracked and
are removed when put away.

#### 4.8.3 Share

`navigator.share({ text })` with plain text; fallback: copy to clipboard and toast «Liste copiée»
`toast.listCopied`. Format (unchecked rows only):

```
Courses · samedi 16 nov.

Produits laitiers
– Lait demi-écrémé × 2
– Beurre doux × 1

Épicerie salée
– Pâtes Barilla 500 g × 3
```

Header line key `groceries.share.header` («Courses · {date}»); item line `groceries.share.line` («– {name} × {n}»).

#### 4.8.4 PutAwaySheet `?sheet=put-away`

Fit detent. Title «Ranger les courses» `putAway.title`; body «Les articles cochés seront ajoutés au stock, aux
quantités indiquées.» `putAway.body`; PantryPicker rows; button «Ranger dans {pantry}» `groceries.putAway`. Result
toast «{n} articles rangés dans {pantry}» `toast.putAway` with «Annuler».

#### 4.8.5 States

| State | Courses |
|---|---|
| Empty, household has stock | `EmptyState` icon `shopping-basket`, «Rien à prévoir pour l’instant» `groceries.empty.title`, «Les articles s’ajoutent ici quand ils passent sous leur seuil ou risquent de manquer avant les prochaines courses.» `groceries.empty.body`, button «Ajouter un article» `groceries.add`. Trip header still shown. |
| Brand-new household | Same EmptyState, title «La liste se remplira toute seule» `groceries.new.title`, body «Dès que le stock sera scanné, Cellier proposera ici ce qu’il faut racheter.» `groceries.new.body`. No trip header. |
| Loading local | Immediate. |
| First sync | 4 `SkeletonRow`s. |
| Offline / pending | Indicator; checks and additions are queued like any mutation. |
| Conflict resolved | Check state is LWW; silent. |

### 4.9 Celliers (pantries)

#### 4.9.1 PantryMenuSheet `?sheet=pantries`

Auto detent, opened from the PantrySwitcher. Header title «Celliers» `pantries.title`, trailing «OK». Inset list:
first row «Tous les celliers» `pantry.all` (secondary «{n} articles» `common.itemsCount`), then one row per cellier
in the household order (name Body, secondary count, trailing `check` on the current one). Selecting sets the current
cellier and closes (`sheet` reversed). Below: text row «Gérer les celliers» `pantries.manage` → replaces the param
with `sheet=settings&page=pantries`.

#### 4.9.2 Pantries page (`page=pantries`)

| Element | Owner | Member |
|---|---|---|
| Header | Back «Réglages», title «Celliers», trailing «Modifier» `common.edit` / «OK» (edit mode: drag handles and delete buttons) | Back, title, no edit |
| Rows | name, secondary «{n} articles», chevron → `page=pantry&id=` | name, count, no chevron |
| Add row | «Nouveau cellier» `pantries.new` (accent) → `page=pantry-new` | hidden |
| Footer | «Faire glisser pour changer l’ordre du sélecteur, pour tout le foyer.» `pantries.footer.owner` | «Seul le propriétaire peut ajouter, renommer ou supprimer un cellier.» `pantries.footer.member` |

Reorder uses `smooth` layout animation; drop crosses no haptic site.

Pantry page (`page=pantry&id=`): `TextField` «Nom» (saves on blur), row «Articles» value count, destructive row
«Supprimer le cellier» `pantry.delete`. New pantry page: header «Annuler» / «Nouveau cellier» / «Créer»; field
«Nom», `ChipGroup` with the suggestions; validation «Donner un nom au cellier.» `onboarding.create.pantryRequired`,
«Un cellier porte déjà ce nom.» `validation.pantryTaken`.

Delete (`confirm=pantry-delete`):

| Situation | Dialog |
|---|---|
| Empty cellier | Title «Supprimer « {pantry} » ?» `pantry.delete.title`; «Supprimer le cellier» (destructive, H4). |
| With stock | Message «{n} articles y sont rangés.» `pantry.delete.message`; buttons «Déplacer le stock, puis supprimer» `pantry.delete.move` (→ PantryPicker push «Déplacer vers…» `pantry.delete.moveTo`, then confirm), «Supprimer avec le stock» `pantry.delete.withStock` (destructive, H4). |
| Last cellier | Row disabled; footer «Un foyer garde au moins un cellier.» `pantry.delete.last`. |

If the deleted cellier was current on this device, the current cellier becomes the first in order.

### 4.10 Réglages (SettingsSheet root) `?sheet=settings`

Purpose: account, household and preferences, out of the way of daily use.

Large detent. `SheetHeader`: title «Réglages» `settings.title`, trailing «OK». Sections (inset lists, `ListRow` 52 px:
leading 28 px tile with Lucide icon, title Body, trailing value Body secondary + chevron):

| Section | Row | Value / behaviour | Key |
|---|---|---|---|
| Account | Avatar 56 px, name Headline, email Subhead secondary (row 76 px) | → `page=account` | |
| «Foyer» `settings.section.household` | `house` «{household}» | value «{n} membres» `settings.membersCount` → `page=household` | |
| | `warehouse` «Celliers» `pantries.title` | count → `page=pantries` | |
| | `shapes` «Catégories» `categories.title` | → `page=categories` | |
| «Préférences» `settings.section.prefs` | `bell` «Notifications» `notifications.title` | «Activées» `settings.notifications.on` / «Désactivées» `settings.notifications.off` / «Non installée» `settings.notifications.notInstalled` → `page=notifications` | |
| | `vibrate` «Retours haptiques» `settings.haptics` | native `Switch` (H3), default on; footer «Une légère vibration au scan, aux balayages et aux confirmations. Nécessite iOS 18.» `settings.haptics.footer` | |
| Safari only | `square-plus` «Ajouter à l’écran d’accueil» `home.installRow` | → `?sheet=install` (replaces) | |
| «À propos» `settings.section.about` | `info` «Sources des données» `about.sources` | → `page=about` | |
| Footer | «Cellier {version} ({build})» `settings.version`, Footnote centred | | |

States: offline n/a (pages explain their own limits); pending/conflict n/a.

### 4.11 Account (`page=account`)

Avatar 80 px centred, name Title 2, email Subhead secondary, line «Connecté avec Google» `account.provider`.
Inset list: «Se déconnecter» `account.signOut` (accent) → `confirm=sign-out`; «Supprimer le compte»
`account.delete` (brick) → `confirm=account-delete`.

| Dialog | Copy |
|---|---|
| Sign out, outbox empty | «Se déconnecter ?» `account.signOut.title`; message «Le stock reste disponible après reconnexion.» `account.signOut.message`; «Se déconnecter» `account.signOut` |
| Sign out, pending | message «{n} modifications ne sont pas encore envoyées. Elles seront perdues en cas de déconnexion maintenant.» `account.signOut.pending`; «Se déconnecter quand même» `account.signOut.force` (destructive, H4); «Attendre l’envoi» `account.signOut.wait` (cancel) |
| Delete account | «Supprimer le compte ?» `account.delete.title`; «Le compte et son accès au foyer seront supprimés. Le stock du foyer reste aux autres membres.» `account.delete.message`; «Supprimer le compte» (destructive, H4) |
| Owner with members | Row disabled, footer «Transférer d’abord la propriété du foyer, ou supprimer le foyer.» `account.delete.ownerBlocked` |

### 4.12 Household and members

#### 4.12.1 Household page (`page=household`)

| Element | Owner view | Member view |
|---|---|---|
| Header | Back «Réglages», title «Foyer» `household.title` | same |
| Name | Editable `TextField` «Nom du foyer» | Static row |
| «Membres» `household.members` | `MemberRow`s (avatar 36, name Body, secondary «Propriétaire» `role.owner` / «Membre» `role.member`, «Vous» `common.you` appended for self); chevron on others → `page=member&id=` | Rows without chevron |
| Invite | Row «Inviter un membre» `household.invite` (Lucide `user-plus`, accent) → `page=invite` | Hidden; footer «Seul le propriétaire peut inviter ou retirer des membres.» `household.memberFooter` |
| «Invitations en attente» `household.pending` | Rows «Code {code}» + «Expire {date}» `invite.expires`, trailing «Révoquer» `invite.revoke` → `confirm=invite-revoke`: «Révoquer ce code ?» `invite.revoke.title`, «Il ne pourra plus servir.» `invite.revoke.message`, «Révoquer» (destructive, H4) | Hidden |
| Activity | Row «Activité du foyer» `household.activity` → `page=activity` | same |
| Leave | Row «Quitter le foyer» disabled with footer «Transférer d’abord la propriété à un membre.» `household.leave.ownerBlocked`; when alone, replaced by «Supprimer le foyer» `household.delete` | «Quitter le foyer» `household.leave` (brick) |

Dialogs:
- Leave (`confirm=household-leave`): «Quitter « {household} » ?» `household.leave.title`; «Le stock du foyer
  disparaîtra de cet iPhone. Une nouvelle invitation sera nécessaire pour revenir.» `household.leave.message`;
  «Quitter le foyer» (destructive, H4) → `/onboarding/household`.
- Delete (`confirm=household-delete`): «Supprimer « {household} » ?» `household.delete.title`; «Le stock, les
  celliers et l’historique seront supprimés définitivement, pour tous les membres.» `household.delete.message`;
  «Supprimer le foyer» (destructive, H4).

#### 4.12.2 Member page (`page=member&id=`, owner only)

Avatar 80, name Title 2, «Membre depuis le {date}» `member.since`. Inset list: «Nommer propriétaire»
`member.makeOwner` → dialog «Nommer {name} propriétaire ?» `member.makeOwner.title`, «{name} pourra gérer les membres
et les celliers. Vous resterez membre du foyer.» `member.makeOwner.message`, «Nommer propriétaire» (not destructive);
«Retirer du foyer» `member.remove` (brick) → «Retirer {name} du foyer ?» `member.remove.title`, «{name} n’aura plus
accès au stock. Ses modifications passées restent dans l’historique.» `member.remove.message`, «Retirer» `member.remove.confirm`
(destructive, H4).

#### 4.12.3 Invite page (`page=invite`, owner only)

On open, creates a code (online only; offline: 2.5.3 text and a «Réessayer» button). Layout: body «Partager ce code
avec la personne à inviter. Il sert une seule fois, pendant 7 jours.» `invite.body`; `InviteCodeDisplay` (rounded
34, centred, letter-spaced, selectable); «Expire le {date}» `invite.expiresOn` (Footnote secondary); primary button
«Partager le lien» `invite.share` (Web Share API, text «Rejoindre « {household} » sur Cellier : {url} (code {code})»
`invite.shareText`); secondary button «Copier le code» `invite.copyCode` → toast «Code copié» `toast.codeCopied`.
Code: 8 characters, Crockford base32, displayed `XXXX-XXXX`; link `https://<origin>/join#XXXXXXXX`.

### 4.13 Categories

#### 4.13.1 Categories page (`page=categories`)

Header: back, title «Catégories» `categories.title`, trailing «Modifier» / «OK» (reorder mode with drag handles).
Section «Catégories» (visible ones, in order): rows with `CategoryTile` 28, name, trailing «{n}» count; chevron →
`page=category&id=`. Row «Nouvelle catégorie» `categories.new` (accent) → `page=category-new`. Section «Masquées»
`categories.hidden` (hidden defaults). Footer: «L’ordre des catégories est celui de la liste de courses : le caler
sur les rayons du magasin habituel.» `categories.footer`.

Default categories (icons are Lucide proposals; colours from the `01` category palette): Fruits `apple`,
Légumes `carrot`, Viandes `beef`, Poissons `fish`, Produits laitiers `milk`, Œufs `egg`, Boulangerie `croissant`,
Épicerie salée `wheat`, Épicerie sucrée `cookie`, Conserves `cylinder`, Surgelés `snowflake`, Eaux `glass-water`,
Jus `citrus`, Boissons `cup-soda`, Vins `wine`, Bières et spiritueux `beer`, Café et thé `coffee`, Hygiène
`droplets`, Entretien `spray-can`, Bébé `baby`, Animaux `paw-print`, Autres `package` (keys `category.default.*`).

#### 4.13.2 Category page (`page=category&id=` / `category-new`)

Top: preview `CategoryTile` 64 px centred. Inset `TextField` «Nom». «Icône» `category.icon`: `IconPicker` grid, 6
columns of 44 px cells, curated set of 48 Lucide food and household icons, selected cell with a 2 px accent ring
(`snappy`). «Couleur» `category.color`: `ColorSwatchPicker`, one row of the `01` category hues as 32 px circles
(44 px hit), selected with a check. Actions: default category «Masquer la catégorie» `category.hide` / «Afficher la
catégorie» `category.show` (no confirm; reversible) with footer «Catégorie par défaut : elle peut être masquée, pas
supprimée.» `category.defaultFooter`; «Autres» has no hide action and footer «« Autres » ne peut pas être masquée.»
`category.othersFooter`; custom category «Supprimer la catégorie» `category.delete` (owner only) → «Supprimer
« {name} » ?» `category.delete.title`, «Ses {n} articles passeront dans « Autres ».» `category.delete.message`,
«Supprimer» `common.delete` (destructive, H4). Member footer for custom: «Seul le propriétaire peut supprimer une
catégorie.» `category.memberFooter`. Validation: «Donner un nom à la catégorie.» `validation.categoryRequired`,
«Une catégorie porte déjà ce nom.» `validation.categoryTaken`. Hidden categories disappear from pickers; products
keep them and they still appear in Stock and Courses.

### 4.14 Notifications

#### 4.14.1 Notifications page (`page=notifications`)

| Context | Content |
|---|---|
| Not installed (Safari) | `StatusBanner` icon `smartphone`: «Les notifications ne fonctionnent que depuis l’app installée sur l’écran d’accueil.» `notifications.notInstalled` + «Comment l’installer» `notifications.howToInstall` → `?sheet=install`. Toggles hidden. |
| Permission default | Body «Cellier prévient quand un article passe sous son seuil, et envoie un résumé à 18 h les soirs de courses.» `notifications.intro`; button «Activer les notifications» `notifications.enable` (calls `requestPermission` from the tap). |
| Denied | `StatusBanner` icon `bell-off`: «Notifications bloquées» `notifications.denied.title`, «Pour les réactiver : Réglages iOS › Notifications › Cellier › Autoriser les notifications.» `notifications.denied.body`. Toggles hidden. Re-checked on every `visibilitychange`. |
| Granted | Two `Switch` rows (H3): «Articles bientôt épuisés» `notifications.alerts` (default on), footer «Une alerte quand un article passe sous son seuil. Rien pour vos propres retraits, ni entre 21 h et 8 h : elles attendent le matin.» `notifications.alerts.footer`; «Résumé de 18 h» `notifications.digest` (default on), footer «Les soirs où des courses sont à prévoir : le nombre d’articles et la date estimée. Rien les autres soirs.» `notifications.digest.footer`. Section footer «Réglages propres à cet iPhone.» `notifications.deviceFooter`. |
| Offline | Switches disabled + 2.5.3 text. |

Quiet behaviour (server, `00-decisions`): one alert per low transition (hysteresis); alerts within 60 min are grouped
into one; no alert to the member whose own action caused the transition; alerts between 21:00 and 08:00 Europe/Paris
are held until 08:00; the 18 h digest is sent only when the list is not empty, and is skipped if an alert was sent
in the previous hour.

Notification copy (push payload; `title`, `body` only, `research/11` §8):

| Push | Title | Body | Key |
|---|---|---|---|
| One item | «Bientôt épuisé» | «{product} : il en reste {n}.» (0: «{product} : il n’en reste plus.») | `push.low.title`, `push.low.body`, `push.low.bodyOut` |
| Grouped | «{n} articles bientôt épuisés» | «{a}, {b} et {c}.» / «{a}, {b} et {n} autres.» | `push.lowGroup.title`, `push.lowGroup.body` |
| Digest | «Courses · {date}» | «{n} articles à prévoir, dont {a} et {b}.» | `push.digest.title`, `push.digest.body` |

#### 4.14.2 NotificationPrimerSheet `?sheet=notify`

Fit detent. Lucide `bell` 32 px in a 64 px accent-tinted circle; title «Alertes de stock» `notify.primer.title`
(Title 2, centred); body «Cellier prévient quand un article passe sous son seuil, d’après les retraits de tout le
foyer.» `notify.primer.body1`; «Un résumé arrive à 18 h les soirs où des courses sont à prévoir. Jamais d’alerte
entre 21 h et 8 h.» `notify.primer.body2`; primary «Activer les notifications» `notifications.enable`; text button
«Plus tard» `common.later`. Results as in 4.2.2.

### 4.15 About (`page=about`)

Title «Sources des données» `about.sources`. Sections:
- «Produits» `about.products`: «Les informations produits viennent d’Open Food Facts, base libre sous licence ODbL.
  © les contributeurs d’Open Food Facts. Les photos sont sous licence CC BY-SA.» `about.off` + link
  «openfoodfacts.org» `about.offLink`.
- «Prix» `about.prices`: «Les prix viennent d’Open Prices (Open Food Facts), sous licence ODbL.» `about.openPrices`.
- «Icônes» `about.icons`: «Lucide, licence ISC.» `about.lucide`.
- Version row «Version» `about.version`.

### 4.16 Removed from household `/removed`

Purpose: the account lost access (removed by the owner, or the household was deleted); nothing queued is lost
silently (`research/15` §6.4).

Layout: serif title «Accès au foyer retiré» `removed.title` (Title 1, x = 16); body «Ce compte ne fait plus partie de
« {household} ».» `removed.body`. If the quarantine is not empty: inset card with `circle-exclamation-point` amber, «{n}
modifications faites sur cet iPhone n’ont pas pu être envoyées.» `removed.quarantine` and two buttons «Exporter
(CSV)» `removed.export` (Web Share a CSV file: date, cellier, article, code, mouvement, quantité) and «Supprimer ces
modifications» `removed.discard` (brick; confirm «Supprimer les {n} modifications ?» `removed.discard.title`,
destructive, H4). Then «Créer un foyer» `onboarding.household.create.title` and «Rejoindre un foyer»
`onboarding.household.join.title` (OptionCards), enabled once the quarantine is exported or discarded. Local data of
the old household is deleted at that point.

---

## 5. Data-model implications (for `docs/architecture/`)

These screens need items that `00-decisions.md` does not list yet:

1. `grocery_entries` (household): product id or free text, quantity override, checked_by/at, dismissed_at,
   added_by. Synced like any table (LWW per field).
2. `products.usual_qty` override (nullable; computed value used when null) and `products.min_qty` as the v1 seuil;
   `stock.min_quantity` stays unused in v1.
3. Invite codes: 8-character Crockford code, single use, 7-day expiry, hashed, rate-limited redemption; plus a
   pre-auth `peek_invite(code)` RPC returning only the household name and inviter first name.
4. Per-device notification preferences on `push_subscriptions` (alerts on/off, digest on/off).
5. `delete_account` RPC; household deletion RPC (owner).
6. Field-overwrite records (old value, new value, author) in `change_log` to feed «Modification remplacée».
7. Movement kinds used by the UI: purchase, consume, recount, transfer, plus a `source` (scan, swipe, stepper,
   put-away) for Activity grouping.

---

## 6. Key decisions (summary)

1. Running low, forecasts and Courses are household-wide per product; the cellier switcher filters lists only.
2. Default first cellier is «Cave»; the interface's generic word for a pantry is «cellier».
3. Accueil order: «Bientôt épuisé» (max 5, urgency-ordered) → NextTripCard → «Récemment».
4. Days left are always «≈», rounded (days under 14, then weeks); low-confidence estimates never show days.
5. Scanner: draft tray with steppers, one commit («Terminer»), undo toast; no URL changes while the camera runs.
6. Stock swipes: leading «+1» (purchase), trailing «−1» (consume); recount by tapping the number on Item detail.
7. «Article» grouping = flat list, one row per product (totals and per-cellier split in «Tous les celliers»).
8. Courses grouped by category in the editable category order; checking ≠ stock; scan or «Ranger» adds stock.
9. Notification permission is asked after the first scan session, from an inline card, never in onboarding.
10. One SyncIndicator under the large title, hidden when synced; only true decisions go to «À vérifier».

---
## 7. Copy deck (`fr.ts`)

### 7.1 Format

- One flat, typed object: `key → string | { one, other }`. Interpolation `{name}`. Plural selection with
  `new Intl.PluralRules('fr').select(n)`; `one` covers 0 and 1; `many` falls back to `other`.
- When a string has two numbers (e.g. `toast.clamp.single`), the plural follows `{applied}`.
- Spaces before `: ; ? !`, inside « », after `≈ ×`, and between number and unit are no-break spaces in the
  catalogue (section 0).

### 7.2 Time and formats

| Key | one / string | other |
|---|---|---|
| `time.justNow` | à l’instant | |
| `time.minutesAgo` | il y a {n} min | |
| `time.todayAt` | aujourd’hui, {time} | |
| `time.yesterdayAt` | hier, {time} | |
| `time.today` | aujourd’hui | |
| `time.tomorrow` | demain | |
| `unit.g` / `unit.kg` / `unit.ml` / `unit.cl` / `unit.l` | g / kg / ml / cl / L | |
| `unit.piece` | {n} pièce | {n} pièces |

### 7.3 Strings

| Key | French (one / single form) | other (plural) |
|---|---|---|
| **app, common** | | |
| `app.name` | Cellier | |
| `common.cancel` | Annuler | |
| `common.done` | OK | |
| `common.save` | Enregistrer | |
| `common.add` | Ajouter | |
| `common.create` | Créer | |
| `common.createNamed` | Créer « {q} » | |
| `common.edit` | Modifier | |
| `common.delete` | Supprimer | |
| `common.retry` | Réessayer | |
| `common.undo` | Annuler | |
| `common.view` | Voir | |
| `common.seeAll` | Tout voir | |
| `common.open` | Ouvrir | |
| `common.restore` | Restaurer | |
| `common.confirm` | Valider | |
| `common.hide` | Masquer | |
| `common.later` | Plus tard | |
| `common.you` | Vous | |
| `common.itemsCount` | {n} article | {n} articles |
| `common.discard.title` | Abandonner les modifications ? | |
| `common.discard.confirm` | Abandonner | |
| `common.discard.cancel` | Continuer la modification | |
| **tabs, a11y shell** | | |
| `tabs.home` | Accueil | |
| `tabs.stock` | Stock | |
| `tabs.groceries` | Courses | |
| `a11y.scan.button` | Scanner des produits | |
| `a11y.scan.hint` | Maintenir pour retirer des produits | |
| `a11y.scan.withdrawAction` | Retirer des produits | |
| `a11y.pantry.switcher` | Cellier : {name} | |
| `a11y.pantry.switcherHint` | Changer de cellier | |
| `a11y.settings.open` | Réglages | |
| **sync, session, update** | | |
| `sync.indicator.firstSync` | Chargement du foyer… | |
| `sync.indicator.pending` | {n} modification en attente | {n} modifications en attente |
| `sync.indicator.offline` | Hors ligne | |
| `sync.indicator.offlinePending` | Hors ligne · {n} modification en attente | Hors ligne · {n} modifications en attente |
| `sync.indicator.error` | Synchronisation interrompue | |
| `sync.indicator.attention` | {n} à vérifier | |
| `a11y.sync.firstSync` | Chargement du foyer en cours | |
| `a11y.sync.openDetails` | , ouvrir les détails | |
| `a11y.sync.retry` | Réessayer la synchronisation | |
| `a11y.sync.attention` | {n} changement à vérifier, ouvrir les détails | {n} changements à vérifier, ouvrir les détails |
| `sync.sheet.title` | Synchronisation | |
| `sync.sheet.status.synced` | À jour | |
| `sync.sheet.status.offline` | Hors ligne | |
| `sync.sheet.status.error` | Synchronisation interrompue | |
| `sync.sheet.status.firstSync` | Chargement du foyer… | |
| `sync.sheet.lastSync` | Dernière synchronisation : {time} | |
| `sync.sheet.neverSynced` | Jamais synchronisé sur cet iPhone | |
| `sync.sheet.pending.title` | En attente d’envoi | |
| `sync.sheet.pending.more` | et {n} autre | et {n} autres |
| `sync.sheet.pending.offlineFooter` | L’envoi reprendra automatiquement au retour du réseau. | |
| `sync.sheet.pending.onlineFooter` | Envoi automatique en cours. | |
| `sync.sheet.attention.title` | À vérifier | |
| `sync.sheet.clockSkew` | L’heure de cet iPhone semble décalée. Vérifier Réglages › Général › Date et heure. | |
| `sync.sheet.syncNow` | Synchroniser maintenant | |
| `sync.sheet.syncing` | Synchronisation… | |
| `sync.firstSync.offline.title` | Connexion nécessaire | |
| `sync.firstSync.offline.body` | Le stock du foyer sera téléchargé dès que l’iPhone sera en ligne. | |
| `attention.gone.title` | Article supprimé par {member} | |
| `attention.gone.detail` | « {product} » : votre modification n’a pas été enregistrée. | |
| `attention.gone.restore` | Restaurer l’article | |
| `attention.pantryGone.title` | Cellier supprimé par {member} | |
| `attention.pantryGone.detail` | Le déplacement de « {product} » vers « {pantry} » n’a pas été enregistré. | |
| `attention.nameTaken.title` | Nom déjà utilisé | |
| `attention.nameTaken.detail` | Un autre article s’appelle déjà « {name} ». | |
| `attention.invalid.title` | Modification refusée | |
| `attention.invalid.detail` | « {product} » : la valeur saisie n’a pas été acceptée. | |
| `attention.open` | Ouvrir l’article | |
| `attention.dismiss` | Ignorer | |
| `attention.dependents` | et {n} changement lié | et {n} changements liés |
| `session.expired.title` | Session expirée | |
| `session.expired.body` | Les modifications restent sur cet iPhone jusqu’à la reconnexion. | |
| `session.expired.action` | Se reconnecter | |
| `session.expired.wrongAccount` | Ce compte Google ne fait pas partie de « {household} ». Se reconnecter avec {email}. | |
| `update.available` | Nouvelle version disponible | |
| `update.reload` | Recharger | |
| **toasts** | | |
| `toast.clamp.single` | {product} : {applied} retiré sur {requested}. Il n’en restait que {applied}. | {product} : {applied} retirés sur {requested}. Il n’en restait que {applied}. |
| `toast.clamp.zero` | {product} : aucun retrait enregistré, le stock était déjà à 0. | |
| `toast.clamp.multiple` | {n} retrait ajusté au stock disponible. | {n} retraits ajustés au stock disponible. |
| `toast.moveClamp` | {applied} déplacé sur {requested} : {pantry} n’en avait que {applied}. | {applied} déplacés sur {requested} : {pantry} n’en avait que {applied}. |
| `toast.scan.added` | {n} article ajouté à {pantry} | {n} articles ajoutés à {pantry} |
| `toast.scan.withdrawn` | {n} article retiré de {pantry} | {n} articles retirés de {pantry} |
| `toast.scan.withdrawnMulti` | {n} article retiré | {n} articles retirés |
| `toast.scan.skipped` | · {k} ignoré | · {k} ignorés |
| `toast.undone` | Annulé | |
| `toast.itemAdded` | {product} ajouté à {pantry} | |
| `toast.itemDeleted` | Article supprimé | |
| `toast.moved` | {n} déplacé vers {pantry} | {n} déplacés vers {pantry} |
| `toast.dismissed` | Masqué jusqu’au prochain achat | |
| `toast.putAway` | {n} article rangé dans {pantry} | {n} articles rangés dans {pantry} |
| `toast.listCopied` | Liste copiée | |
| `toast.linkCopied` | Lien copié | |
| `toast.codeCopied` | Code copié | |
| `toast.notifyOn` | Notifications activées | |
| `toast.notifyDenied` | Notifications refusées. Modifiable dans Réglages iOS. | |
| **welcome, install, auth** | | |
| `welcome.tagline` | Ce qu’il y a à la maison, et ce qu’il faudra racheter. | |
| `welcome.install.reason` | Installé sur l’écran d’accueil, Cellier s’ouvre en plein écran et peut envoyer des alertes. | |
| `welcome.install.cta` | Ajouter à l’écran d’accueil | |
| `welcome.install.skip` | Continuer dans Safari | |
| `welcome.install.otherBrowser` | Pour installer Cellier, ouvrir cette page dans Safari. | |
| `welcome.install.copyLink` | Copier le lien | |
| `welcome.install.continueHere` | Continuer ici | |
| `install.title` | Ajouter à l’écran d’accueil | |
| `install.step1.title` | Toucher Partager | |
| `install.step1.detail` | L’icône de partage dans la barre de Safari. Sur iOS 26, toucher d’abord « … ». | |
| `install.step2.title` | Choisir « Sur l’écran d’accueil » | |
| `install.step2.detail` | Faire défiler la liste si l’option n’est pas visible. | |
| `install.step3.title` | Toucher « Ajouter » | |
| `install.step3.detail` | Sur iOS 26, laisser « Ouvrir comme app web » activé. | |
| `install.footer` | Ensuite, ouvrir Cellier depuis son icône : la connexion se fera là-bas. | |
| `install.done` | J’ai compris | |
| `auth.legal` | En continuant, vous acceptez les {terms} et la {privacy}. | |
| `auth.legal.terms` | conditions d’utilisation | |
| `auth.legal.privacy` | politique de confidentialité | |
| `auth.google.fallback` | Continuer avec Google | |
| `auth.signingIn` | Connexion… | |
| `auth.error.cancelled` | Connexion annulée. | |
| `auth.error.offline` | Pas de connexion internet. Vérifier le réseau, puis réessayer. | |
| `auth.error.generic` | La connexion avec Google n’a pas abouti. Réessayer. | |
| `auth.callback.wrongContext.title` | Connexion ouverte dans Safari | |
| `auth.callback.wrongContext.body` | Pour terminer, ouvrir Cellier depuis l’écran d’accueil et toucher « Continuer avec Google ». | |
| `auth.callback.expired` | Le lien de connexion a expiré. | |
| `auth.callback.restart` | Recommencer | |
| **onboarding, join** | | |
| `onboarding.household.title` | Votre foyer | |
| `onboarding.household.body` | Le foyer réunit les personnes qui partagent le même stock. | |
| `onboarding.household.create.title` | Créer un foyer | |
| `onboarding.household.create.detail` | Pour commencer votre propre stock. | |
| `onboarding.household.join.title` | Rejoindre un foyer | |
| `onboarding.household.join.detail` | Avec un lien ou un code d’invitation. | |
| `onboarding.create.title` | Créer le foyer | |
| `onboarding.create.householdLabel` | Nom du foyer | |
| `onboarding.create.householdDefault` | Chez {firstName} | |
| `onboarding.create.householdFallback` | Mon foyer | |
| `onboarding.create.householdPlaceholder` | Ex. : Chez les Martin | |
| `onboarding.create.pantryLabel` | Premier cellier | |
| `onboarding.create.footer` | Un cellier est un lieu de rangement. D’autres pourront être ajoutés plus tard. | |
| `onboarding.create.householdRequired` | Donner un nom au foyer. | |
| `onboarding.create.pantryRequired` | Donner un nom au cellier. | |
| `onboarding.create.offline` | Connexion nécessaire pour créer le foyer. | |
| `onboarding.join.title` | Rejoindre un foyer | |
| `onboarding.join.body` | Saisir le code reçu du propriétaire du foyer. | |
| `onboarding.join.codeLabel` | Code d’invitation | |
| `onboarding.join.codePlaceholder` | XXXX-XXXX | |
| `onboarding.join.cta` | Rejoindre | |
| `onboarding.join.error.notFound` | Ce code n’existe pas. Vérifier les caractères. | |
| `onboarding.join.error.expired` | Ce code a expiré. Demander un nouveau code au propriétaire du foyer. | |
| `onboarding.join.error.used` | Ce code a déjà servi. Demander un nouveau code au propriétaire du foyer. | |
| `onboarding.join.error.alreadyMember` | Ce compte fait déjà partie de « {household} ». Quitter ce foyer d’abord, dans Réglages. | |
| `onboarding.join.offline` | Connexion nécessaire pour rejoindre un foyer. | |
| `onboarding.joined.title` | Bienvenue dans « {household} » ! (exclamation allowed) | |
| `onboarding.joined.body` | Le stock du foyer arrive sur cet iPhone. | |
| `join.title` | Invitation | |
| `join.body` | {inviter} vous invite à rejoindre « {household} » sur Cellier. | |
| `join.bodyFallback` | Invitation à rejoindre un foyer sur Cellier. | |
| `join.safari.step1` | 1. Accepter avec votre compte Google | |
| `join.accepted.title` | Invitation acceptée | |
| `join.accepted.body` | Ajouter Cellier à l’écran d’accueil, puis se connecter avec le même compte Google : le foyer y sera. | |
| `join.accepted.showSteps` | Afficher les étapes | |
| **pantry** | | |
| `pantry.all` | Tous les celliers | |
| `pantry.defaultName` | Cave | |
| `pantry.suggestions` | Cave, Cuisine, Cellier, Garage, Placard | |
| `pantries.title` | Celliers | |
| `pantries.manage` | Gérer les celliers | |
| `pantries.new` | Nouveau cellier | |
| `pantries.footer.owner` | Faire glisser pour changer l’ordre du sélecteur, pour tout le foyer. | |
| `pantries.footer.member` | Seul le propriétaire peut ajouter, renommer ou supprimer un cellier. | |
| `pantry.delete` | Supprimer le cellier | |
| `pantry.delete.title` | Supprimer « {pantry} » ? | |
| `pantry.delete.message` | {n} article y est rangé. | {n} articles y sont rangés. |
| `pantry.delete.move` | Déplacer le stock, puis supprimer | |
| `pantry.delete.moveTo` | Déplacer vers… | |
| `pantry.delete.withStock` | Supprimer avec le stock | |
| `pantry.delete.last` | Un foyer garde au moins un cellier. | |
| `validation.pantryTaken` | Un cellier porte déjà ce nom. | |
| **home, trip, activity** | | |
| `home.low.title` | Bientôt épuisé | |
| `home.low.remaining` | Reste {qty} | |
| `home.low.inPantry` | · {pantry} | |
| `home.low.seeAll` | Voir les {n} articles | |
| `home.low.none.title` | Rien ne manque | |
| `home.low.none.next` | À surveiller : {product}, ≈ {d} j | |
| `home.low.none.body` | Les articles sous leur seuil apparaîtront ici. | |
| `home.recent.title` | Récemment | |
| `home.installRow` | Ajouter Cellier à l’écran d’accueil | |
| `home.empty.title` | Le stock commence par un scan | |
| `home.empty.body` | Scanner les produits en les rangeant. Cellier compte les quantités et prévient avant qu’ils manquent. | |
| `home.empty.scan` | Scanner un produit | |
| `home.empty.manual` | Ajouter sans code-barres | |
| `home.empty.invite` | Inviter un membre du foyer | |
| `notify.card.title` | Être prévenu avant qu’il manque quelque chose | |
| `notify.card.body` | Une alerte quand un article passe sous son seuil, et un résumé à 18 h les jours de courses. | |
| `notify.card.enable` | Activer | |
| `trip.label` | Prochaines courses | |
| `trip.date.approx` | vers {date} | |
| `trip.date.thisWeek` | cette semaine | |
| `trip.date.nextWeek` | la semaine prochaine | |
| `trip.date.weekOf` | semaine du {date} | |
| `trip.reason.pulledForward` | Avancées : {n} article sera épuisé d’ici là. | Avancées : {n} articles seront épuisés d’ici là. |
| `trip.reason.cadenceWeekday` | En général le {weekday}, tous les {g} jours environ. | |
| `trip.reason.cadence` | D’après vos {n} derniers passages. | |
| `trip.reason.thin` | Date indicative : encore peu de courses enregistrées. | |
| `trip.count` | {n} article | {n} articles |
| `trip.preview` | {a}, {b}, {c} et {n} autre | {a}, {b}, {c} et {n} autres |
| `trip.empty` | Rien à prévoir pour l’instant | |
| `activity.title` | Activité | |
| `activity.row.meta` | {member} · {time} | |
| `activity.addSession` | Ajout de {n} article · {pantry} | Ajout de {n} articles · {pantry} |
| `activity.withdrawSession` | Retrait de {n} article · {pantry} | Retrait de {n} articles · {pantry} |
| `activity.add` | {product} · +{qty} | |
| `activity.withdraw` | {product} · −{qty} | |
| `activity.recount` | {product} · recompté {from} → {to} | |
| `activity.move` | {product} · {from} → {to} ({qty}) | |
| `activity.clamped` | {product} · retrait ajusté : {applied} sur {requested} | |
| `activity.putAway` | Courses rangées · {n} article · {pantry} | Courses rangées · {n} articles · {pantry} |
| `activity.edit` | {product} · {field} : {old} → {new} | |
| `activity.created` | {product} · ajouté au stock | |
| `activity.deleted` | {product} · supprimé | |
| `activity.restored` | {product} · restauré | |
| `activity.memberJoined` | {member} a rejoint le foyer | |
| `activity.memberLeft` | {member} a quitté le foyer | |
| `activity.memberRemoved` | {member} ne fait plus partie du foyer | |
| `activity.empty.title` | Aucune activité pour l’instant | |
| `activity.empty.body` | Les ajouts, retraits et modifications du foyer s’afficheront ici. | |
| **forecast** | | |
| `forecast.badge.out` | Épuisé | |
| `forecast.badge.lessThanDay` | < 1 j | |
| `forecast.badge.days` | ≈ {d} j | |
| `forecast.badge.weeks` | ≈ {w} sem. | |
| `forecast.badge.threshold` | Seuil | |
| `a11y.forecast.lessThanDay` | Moins d’un jour de stock | |
| `a11y.forecast.days` | Environ {d} jour de stock | Environ {d} jours de stock |
| `a11y.forecast.weeks` | Environ {w} semaine de stock | Environ {w} semaines de stock |
| `a11y.forecast.threshold` | Sous le seuil d’alerte | |
| `a11y.forecast.band` | Épuisement probable entre le {earliest} et le {latest}, plus probablement le {median} | |
| `forecast.out` | Épuisé | |
| `forecast.onList` | Ajouté à la liste de courses. | |
| `forecast.cover.days` | Il en reste pour ≈ {d} j | |
| `forecast.cover.weeks` | Il en reste pour ≈ {w} sem. | |
| `forecast.cover.months` | Plus de 2 mois | |
| `forecast.band` | Épuisement probable entre le {earliest} et le {latest}. | |
| `forecast.bandMedian` | Épuisement vers le {median}, entre le {earliest} et le {latest}. | |
| `forecast.confidence.high` | Estimation fiable · {n} retrait en 90 jours | Estimation fiable · {n} retraits en 90 jours |
| `forecast.confidence.medium` | Estimation approximative · {n} retrait en 90 jours | Estimation approximative · {n} retraits en 90 jours |
| `forecast.confidence.low` | D’après des articles de la même catégorie : encore trop peu de retraits. | |
| `forecast.none.title` | Pas encore de prévision | |
| `forecast.none.body` | La prévision apparaîtra après quelques retraits. | |
| **stock** | | |
| `a11y.stock.view` | Trier et grouper | |
| `a11y.stock.add` | Ajouter un article | |
| `stock.search.placeholder` | Rechercher dans {pantry} | |
| `stock.search.placeholderAll` | Rechercher | |
| `stock.footer` | {n} article · {u} unités (plural on n; `u` uses `unit.count`) | {n} articles · {u} unités |
| `unit.count` | {u} unité | {u} unités |
| `stock.noResults.title` | Aucun résultat | |
| `stock.noResults.body` | Rien ne correspond à « {q} ». | |
| `stock.view.title` | Affichage | |
| `stock.view.groupBy` | Grouper par | |
| `stock.view.sortBy` | Trier par | |
| `stock.view.group.category` / `.item` / `.added` / `.price` / `.quantity` | Catégorie / Article / Date d’ajout / Prix / Quantité | |
| `stock.view.sort.name` / `.category` / `.recent` / `.price` / `.quantity` | Nom / Catégorie / Récent / Prix / Quantité | |
| `stock.view.showEmpty` | Afficher les épuisés | |
| `a11y.sort.asc` | croissant | |
| `a11y.sort.desc` | décroissant | |
| `stock.group.added.today` / `.week` / `.month` / `.older` | Aujourd’hui / Cette semaine / Ce mois-ci / Plus ancien | |
| `stock.group.price.lt2` / `.2to5` / `.5to10` / `.gt10` / `.unknown` | Moins de 2 € / De 2 à 5 € / De 5 à 10 € / Plus de 10 € / Prix inconnu | |
| `stock.group.qty.zero` / `.one` / `.2to5` / `.6to11` / `.12plus` | Épuisé / 1 en stock / De 2 à 5 / De 6 à 11 / 12 et plus | |
| `stock.empty.title` | Aucun article dans {pantry} | |
| `stock.empty.body` | Scanner un produit pour l’ajouter, ou l’ajouter à la main. | |
| `stock.empty.manual` | Ajouter à la main | |
| `item.row.brandSize` | {brand} · {size} | |
| `item.row.split` | {pantryA} {qtyA} · {pantryB} {qtyB} | |
| `item.row.incomplete` | À compléter | |
| `a11y.item.row` | {name}, {details}, {quantity} en stock | |
| `a11y.item.lowSuffix` | , bientôt épuisé | |
| `a11y.item.add1` | Ajouter 1 | |
| `a11y.item.remove1` | Retirer 1 | |
| `newItem.title` | Nouvel article | |
| `newItem.namePlaceholder` | Ex. : Huile d’olive 1 L | |
| `newItem.existing` | Déjà dans le stock | |
| **fields, sources, validation** | | |
| `field.name` | Nom | |
| `field.brand` | Marque | |
| `field.category` | Catégorie | |
| `field.size` | Contenance | |
| `field.unitPrice` | Prix unitaire | |
| `field.barcode` | Code-barres | |
| `field.quantity` | Quantité | |
| `field.pantry` | Cellier | |
| `source.off` | Open Food Facts | |
| `source.openPrices` | Open Prices · {store} · {date} | |
| `source.manual` | Saisi à la main | |
| `source.manualDated` | Saisi à la main · {date} | |
| `source.computed` | Calculé | |
| `source.overridden` | Modifié | |
| `validation.nameRequired` | Indiquer un nom. | |
| `validation.nameTaken` | Un article s’appelle déjà « {name} ». | |
| `validation.sizePositive` | Indiquer une contenance supérieure à 0. | |
| `validation.pricePositive` | Indiquer un prix positif. | |
| `validation.barcodeTaken` | Ce code appartient déjà à « {product} ». | |
| `validation.categoryRequired` | Donner un nom à la catégorie. | |
| `validation.categoryTaken` | Une catégorie porte déjà ce nom. | |
| **item detail and edit** | | |
| `item.qty.caption` | en stock · {pantry} | |
| `item.qty.captionMulti` | en stock dans {n} cellier | en stock dans {n} celliers |
| `a11y.item.qtyValue` | {n} en stock | |
| `a11y.item.recountHint` | Toucher pour recompter | |
| `item.pantries.title` | Par cellier | |
| `item.forecast.title` | Prévision | |
| `item.alert.title` | Alerte | |
| `item.alert.threshold` | Seuil d’alerte | |
| `item.alert.suggested` | Suggéré : {n} | |
| `item.alert.usual` | Stock habituel | |
| `item.alert.enablePush` | Recevoir les alertes sur cet iPhone | |
| `item.alert.footer` | Signalé quand il en reste {n} ou moins. Le stock habituel sert à proposer la quantité à racheter. | |
| `item.price.title` | Prix | |
| `item.price.unknown` | Prix inconnu | |
| `item.info.title` | Informations | |
| `item.history.title` | Historique | |
| `item.history.all` | Tout l’historique | |
| `item.move` | Déplacer vers un autre cellier | |
| `item.delete` | Supprimer l’article | |
| `item.delete.title` | Supprimer « {product} » ? | |
| `item.delete.message` | Le stock ({n}) et l’historique de cet article disparaîtront pour tout le foyer. | |
| `item.attribution.off` | Informations produit : Open Food Facts (ODbL) | |
| `item.attribution.link` | Voir sur Open Food Facts | |
| `item.deletedRemotely` | Article supprimé par {member} | |
| `item.notFound.title` | Article introuvable | |
| `item.notFound.body` | Il a peut-être été supprimé. | |
| `item.notFound.home` | Retour à l’accueil | |
| `history.add` | Ajout | |
| `history.withdraw` | Retrait | |
| `history.recount` | Recomptage | |
| `history.move` | Déplacement · {from} → {to} | |
| `history.clamped.title` | Retrait ajusté | |
| `history.clamped.detail` | {applied} sur {requested} demandés | |
| `history.edit` | {field} : {old} → {new} | |
| `history.overwritten.title` | Modification remplacée | |
| `history.overwritten.detail` | {field} : « {yourValue} » remplacé par « {theirValue} » ({member}) | |
| `history.overwritten.restore` | Rétablir | |
| `history.pending` | En attente d’envoi | |
| `recount.title` | Recompter | |
| `recount.body` | Combien en reste-t-il dans {pantry} ? | |
| `move.title` | Déplacer | |
| `move.cta` | Déplacer | |
| `move.from` | Depuis | |
| `move.to` | Vers | |
| `itemEdit.title` | Modifier | |
| `itemEdit.section.item` | Article | |
| `itemEdit.section.size` | Contenance | |
| `itemEdit.section.price` | Prix | |
| `itemEdit.addBarcode` | Ajouter un code-barres | |
| `itemEdit.reference` | {source} : {value} | |
| `a11y.itemEdit.reset` | Rétablir la valeur {source} | |
| **scanner** | | |
| `scanner.mode.add` | Ajouter | |
| `scanner.mode.withdraw` | Retirer | |
| `scanner.hint.add` | Placer le code-barres dans le cadre | |
| `scanner.hint.withdraw` | Mode retrait : scanner ce qui sort du cellier | |
| `scanner.lowLight.torch` | Peu de lumière · Allumer la lampe | |
| `scanner.lowLight.noTorch` | Peu de lumière : se rapprocher d’une lampe | |
| `scanner.manual` | Saisir un code | |
| `scanner.tray.to` | Vers {pantry} | |
| `scanner.tray.from` | Depuis {pantry} | |
| `scanner.tray.count` | {n} article | {n} articles |
| `scanner.tray.done` | Terminer | |
| `scanner.tray.empty` | Les produits scannés s’afficheront ici. | |
| `scanner.row.remove` | Enlever de la liste | |
| `scanner.row.removeShort` | Enlever | |
| `scanner.row.searching` | Recherche… | |
| `scanner.row.inStock` | En stock : {n} | |
| `scanner.row.inStockPantry` | En stock dans {pantry} : {n} | |
| `scanner.row.newCatalog` | {details} · nouveau dans le stock | |
| `scanner.row.newOff` | Open Food Facts · nouveau dans le stock | |
| `scanner.row.code` | Code {digits} | |
| `scanner.row.offline` | Hors ligne : sera complété plus tard | |
| `scanner.row.unknown` | Produit inconnu | |
| `scanner.row.name` | Nommer | |
| `scanner.row.storeCode` | Code magasin | |
| `scanner.row.pickItem` | Choisir l’article | |
| `scanner.row.choosePantry` | Choisir le cellier | |
| `scanner.row.elsewhere` | Pas en stock dans {pantry} · {n} dans {other} | |
| `scanner.row.takeFrom` | Retirer de {other} | |
| `scanner.row.absent` | Absent du stock : ignoré | |
| `scanner.row.max` | · max. {n} | |
| `scanner.pantryPicker.to` | Vers quel cellier ? | |
| `scanner.pantryPicker.from` | Depuis quel cellier ? | |
| `scanner.unknown.title` | Nouveau produit | |
| `scanner.unknown.placeholder` | Ex. : Lessive Le Chat 2 L | |
| `scanner.unknown.unnamed` | Article sans nom | |
| `scanner.storeCode.title` | Code magasin | |
| `scanner.storeCode.body` | Ce code est imprimé par le magasin pour un produit pesé ou à la coupe. Il n’identifie pas le produit : choisir l’article correspondant. | |
| `scanner.storeCode.search` | Rechercher un article | |
| `scanner.manualEntry.title` | Saisir un code | |
| `scanner.manualEntry.placeholder` | Code-barres ou nom de l’article | |
| `scanner.manualEntry.invalid` | Ce code n’est pas valide. Vérifier les chiffres. | |
| `scanner.keypad.max` | Il n’y en a que {n} dans {pantry}. | |
| `scanner.close.title` | Enregistrer le {n} article ? | Enregistrer les {n} articles ? |
| `scanner.close.discard` | Abandonner | |
| `scanner.close.continue` | Continuer le scan | |
| `scanner.restored` | Scan précédent repris : {n} article | Scan précédent repris : {n} articles |
| `scanner.primer.title` | Scanner les codes-barres | |
| `scanner.primer.body` | La caméra ne sert que pendant le scan. Les images restent sur cet iPhone. | |
| `scanner.primer.allow` | Autoriser la caméra | |
| `scanner.primer.manual` | Saisir un code à la place | |
| `scanner.denied.title` | Accès à la caméra refusé | |
| `scanner.denied.body` | Pour scanner, autoriser la caméra : Réglages › Safari › Caméra › Autoriser. Puis rouvrir le scanner. | |
| `scanner.unavailable.title` | Caméra indisponible | |
| `scanner.unavailable.body` | Elle est peut-être utilisée par une autre app. Fermer cette app, puis réessayer. | |
| `a11y.scanner.added` | {product} ajouté, quantité {n} | |
| `a11y.scanner.withdrawn` | {product}, retrait, quantité {n} | |
| `a11y.scanner.close` | Fermer le scanner | |
| `a11y.scanner.torchOn` | Allumer la lampe | |
| `a11y.scanner.torchOff` | Éteindre la lampe | |
| **groceries** | | |
| `groceries.title` | Courses | |
| `a11y.groceries.share` | Partager la liste | |
| `groceries.add` | Ajouter un article | |
| `groceries.add.placeholder` | Nom de l’article | |
| `groceries.add.freeText` | Ajouter « {q} » | |
| `groceries.inCart` | Dans le panier · {n} | |
| `groceries.putAway` | Ranger dans {pantry} | |
| `groceries.putAwayMulti` | Ranger le {n} article | Ranger les {n} articles |
| `groceries.thinFooter` | Les dates et quantités s’affinent au fil des semaines. | |
| `groceries.reason.threshold` | Reste {qty}, seuil {seuil} | |
| `groceries.reason.cover` | Reste {qty} · ≈ {d} j | |
| `groceries.reason.runOut` | Épuisement vers le {date} | |
| `groceries.reason.manual` | Ajouté par {member} | |
| `groceries.reason.freeText` | Ajouté par {member} · hors stock | |
| `groceries.share.header` | Courses · {date} | |
| `groceries.share.line` | – {name} × {n} | |
| `groceries.empty.title` | Rien à prévoir pour l’instant | |
| `groceries.empty.body` | Les articles s’ajoutent ici quand ils passent sous leur seuil ou risquent de manquer avant les prochaines courses. | |
| `groceries.new.title` | La liste se remplira toute seule | |
| `groceries.new.body` | Dès que le stock sera scanné, Cellier proposera ici ce qu’il faut racheter. | |
| `putAway.title` | Ranger les courses | |
| `putAway.body` | Les articles cochés seront ajoutés au stock, aux quantités indiquées. | |
| **settings, account, household, invite** | | |
| `settings.title` | Réglages | |
| `settings.section.household` | Foyer | |
| `settings.section.prefs` | Préférences | |
| `settings.section.about` | À propos | |
| `settings.membersCount` | {n} membre | {n} membres |
| `settings.notifications.on` | Activées | |
| `settings.notifications.off` | Désactivées | |
| `settings.notifications.notInstalled` | Non installée | |
| `settings.haptics` | Retours haptiques | |
| `settings.haptics.footer` | Une légère vibration au scan, aux balayages et aux confirmations. Nécessite iOS 18. | |
| `settings.version` | Cellier {version} ({build}) | |
| `account.provider` | Connecté avec Google | |
| `account.signOut` | Se déconnecter | |
| `account.signOut.title` | Se déconnecter ? | |
| `account.signOut.message` | Le stock reste disponible après reconnexion. | |
| `account.signOut.pending` | {n} modification n’est pas encore envoyée. Elle sera perdue en cas de déconnexion maintenant. | {n} modifications ne sont pas encore envoyées. Elles seront perdues en cas de déconnexion maintenant. |
| `account.signOut.force` | Se déconnecter quand même | |
| `account.signOut.wait` | Attendre l’envoi | |
| `account.delete` | Supprimer le compte | |
| `account.delete.title` | Supprimer le compte ? | |
| `account.delete.message` | Le compte et son accès au foyer seront supprimés. Le stock du foyer reste aux autres membres. | |
| `account.delete.ownerBlocked` | Transférer d’abord la propriété du foyer, ou supprimer le foyer. | |
| `household.title` | Foyer | |
| `household.members` | Membres | |
| `role.owner` | Propriétaire | |
| `role.member` | Membre | |
| `household.invite` | Inviter un membre | |
| `household.memberFooter` | Seul le propriétaire peut inviter ou retirer des membres. | |
| `household.pending` | Invitations en attente | |
| `household.activity` | Activité du foyer | |
| `household.leave` | Quitter le foyer | |
| `household.leave.title` | Quitter « {household} » ? | |
| `household.leave.message` | Le stock du foyer disparaîtra de cet iPhone. Une nouvelle invitation sera nécessaire pour revenir. | |
| `household.leave.ownerBlocked` | Transférer d’abord la propriété à un membre. | |
| `household.delete` | Supprimer le foyer | |
| `household.delete.title` | Supprimer « {household} » ? | |
| `household.delete.message` | Le stock, les celliers et l’historique seront supprimés définitivement, pour tous les membres. | |
| `member.since` | Membre depuis le {date} | |
| `member.makeOwner` | Nommer propriétaire | |
| `member.makeOwner.title` | Nommer {name} propriétaire ? | |
| `member.makeOwner.message` | {name} pourra gérer les membres et les celliers. Vous resterez membre du foyer. | |
| `member.remove` | Retirer du foyer | |
| `member.remove.title` | Retirer {name} du foyer ? | |
| `member.remove.message` | {name} n’aura plus accès au stock. Ses modifications passées restent dans l’historique. | |
| `member.remove.confirm` | Retirer | |
| `invite.body` | Partager ce code avec la personne à inviter. Il sert une seule fois, pendant 7 jours. | |
| `invite.expiresOn` | Expire le {date} | |
| `invite.expires` | Expire {date} | |
| `invite.share` | Partager le lien | |
| `invite.shareText` | Rejoindre « {household} » sur Cellier : {url} (code {code}) | |
| `invite.copyCode` | Copier le code | |
| `invite.revoke` | Révoquer | |
| `invite.revoke.title` | Révoquer ce code ? | |
| `invite.revoke.message` | Il ne pourra plus servir. | |
| `invite.offline` | Connexion nécessaire pour créer une invitation. | |
| **categories** | | |
| `categories.title` | Catégories | |
| `categories.new` | Nouvelle catégorie | |
| `categories.hidden` | Masquées | |
| `categories.footer` | L’ordre des catégories est celui de la liste de courses : le caler sur les rayons du magasin habituel. | |
| `category.icon` | Icône | |
| `category.color` | Couleur | |
| `category.hide` | Masquer la catégorie | |
| `category.show` | Afficher la catégorie | |
| `category.defaultFooter` | Catégorie par défaut : elle peut être masquée, pas supprimée. | |
| `category.othersFooter` | « Autres » ne peut pas être masquée. | |
| `category.delete` | Supprimer la catégorie | |
| `category.delete.title` | Supprimer « {name} » ? | |
| `category.delete.message` | Son {n} article passera dans « Autres ». | Ses {n} articles passeront dans « Autres ». |
| `category.memberFooter` | Seul le propriétaire peut supprimer une catégorie. | |
| `category.default.*` | Fruits, Légumes, Viandes, Poissons, Produits laitiers, Œufs, Boulangerie, Épicerie salée, Épicerie sucrée, Conserves, Surgelés, Eaux, Jus, Boissons, Vins, Bières et spiritueux, Café et thé, Hygiène, Entretien, Bébé, Animaux, Autres | |
| **notifications, push** | | |
| `notifications.title` | Notifications | |
| `notifications.notInstalled` | Les notifications ne fonctionnent que depuis l’app installée sur l’écran d’accueil. | |
| `notifications.howToInstall` | Comment l’installer | |
| `notifications.intro` | Cellier prévient quand un article passe sous son seuil, et envoie un résumé à 18 h les soirs de courses. | |
| `notifications.enable` | Activer les notifications | |
| `notifications.denied.title` | Notifications bloquées | |
| `notifications.denied.body` | Pour les réactiver : Réglages iOS › Notifications › Cellier › Autoriser les notifications. | |
| `notifications.alerts` | Articles bientôt épuisés | |
| `notifications.alerts.footer` | Une alerte quand un article passe sous son seuil. Rien pour vos propres retraits, ni entre 21 h et 8 h : elles attendent le matin. | |
| `notifications.digest` | Résumé de 18 h | |
| `notifications.digest.footer` | Les soirs où des courses sont à prévoir : le nombre d’articles et la date estimée. Rien les autres soirs. | |
| `notifications.deviceFooter` | Réglages propres à cet iPhone. | |
| `notifications.offline` | Connexion nécessaire pour modifier les notifications. | |
| `notify.primer.title` | Alertes de stock | |
| `notify.primer.body1` | Cellier prévient quand un article passe sous son seuil, d’après les retraits de tout le foyer. | |
| `notify.primer.body2` | Un résumé arrive à 18 h les soirs où des courses sont à prévoir. Jamais d’alerte entre 21 h et 8 h. | |
| `push.low.title` | Bientôt épuisé | |
| `push.low.body` | {product} : il en reste {n}. | |
| `push.low.bodyOut` | {product} : il n’en reste plus. | |
| `push.lowGroup.title` | {n} article bientôt épuisé | {n} articles bientôt épuisés |
| `push.lowGroup.body` | {a}, {b} et {c}. / {a}, {b} et {n} autres. | |
| `push.digest.title` | Courses · {date} | |
| `push.digest.body` | {n} article à prévoir : {a}. | {n} articles à prévoir, dont {a} et {b}. |
| **about, removed** | | |
| `about.sources` | Sources des données | |
| `about.products` | Produits | |
| `about.off` | Les informations produits viennent d’Open Food Facts, base libre sous licence ODbL. © les contributeurs d’Open Food Facts. Les photos sont sous licence CC BY-SA. | |
| `about.offLink` | openfoodfacts.org | |
| `about.prices` | Prix | |
| `about.openPrices` | Les prix viennent d’Open Prices (Open Food Facts), sous licence ODbL. | |
| `about.icons` | Icônes | |
| `about.lucide` | Lucide, licence ISC. | |
| `about.version` | Version | |
| `removed.title` | Accès au foyer retiré | |
| `removed.body` | Ce compte ne fait plus partie de « {household} ». | |
| `removed.quarantine` | {n} modification faite sur cet iPhone n’a pas pu être envoyée. | {n} modifications faites sur cet iPhone n’ont pas pu être envoyées. |
| `removed.export` | Exporter (CSV) | |
| `removed.discard` | Supprimer ces modifications | |
| `removed.discard.title` | Supprimer la modification ? | Supprimer les {n} modifications ? |

---

## 8. Open questions

1. **iOS 26 labels** in the install guide («Partager» behind «…», «Ouvrir comme app web») and the camera settings
   path are UNVERIFIED (`research/21` §9.2, `research/08` §5); check on device and adjust `install.*`,
   `scanner.denied.body`.
2. **Long-press without transient activation.** The withdraw long-press opens the camera from a timer, not a click.
   Verify on device that `getUserMedia` and muted autoplay start; if not, the cover opens on the PermissionPrimer
   with a «Démarrer» tap.
3. **One household per account** in v1 (`onboarding.join.error.alreadyMember`). Multi-household switching is out of
   scope unless the owner wants it.
4. **Members cannot invite** (RLS in `research/16` §5). If families find this limiting, relax to "members can invite,
   owner can revoke".

---

## 9. Deviations from the brief

1. **Scanner overlays are not in search params.** The brief says sheets live in search params. Inside the scanner,
   any URL change while the camera stream is live can mute or revoke the camera in a Home Screen app (WebKit bugs
   212040, 215884; `research/08` §5). The scanner cover itself is in the URL (`?cover=scan`), set before the camera
   starts; its inner overlays are component state, and a `popstate` while it is open acts as «Fermer».
2. **«Tous les celliers»** is added as a pseudo-cellier in the PantrySwitcher when the household has two or more
   celliers. The brief's title rule is kept (the title shows the current selection).
3. **Accueil lists are household-computed** (running low on the product total), filtered by the current cellier.
   The brief does not specify scope; stated here so `01` and `02` do not assume per-cellier minimums.
4. **ConfirmDialogs are also in the URL** (`&confirm=`), extending the brief's rule so Back cancels them.

---

## 10. Component inventory

Shell and navigation: `AppShell`, `TabBar`, `TabBarItem`, `ScanButton`, `LargeTitleHeader`, `NavBar` (inline
collapsed state), `BackButton`, `PantrySwitcher`, `AvatarButton`, `SyncIndicator`, `StatusBanner`, `Toast`.

Lists and rows: `InsetGroupedList`, `ListSection`, `SectionHeader`, `SectionFooter`, `ListRow`, `ItemRow` (variants
default, low), `GroceryRow`, `ActivityRow`, `HistoryRow`, `AttentionRow`, `MemberRow`, `PropertyRow`, `OptionCard`,
`SkeletonRow`, `SwipeActions`.

Atoms and controls: `CategoryTile`, `QuantityStepper` (sizes large, compact), `ForecastBadge`, `ForecastBand`,
`CheckCircle`, `SegmentedControl`, `SearchField`, `TextField`, `Switch` (native `<input type="checkbox" switch>`),
`ChipGroup`, `Button` (primary, secondary, text, destructive), `IconButton`, `SourceCaption`,
`ResetOverrideButton`, `InviteCodeDisplay`, `Wordmark`, `GoogleSignInButton`.

Composites: `NextTripCard`, `NotificationPromptCard`, `ProductHeader`, `EmptyState`, `InstallGuide`, `InstallStep`,
`PermissionPrimer`, `CategoryPicker`, `IconPicker`, `ColorSwatchPicker`, `PantryPicker`.

Sheets and dialogs: `SheetContainer`, `SheetHeader`, `ConfirmDialog`, `PantryMenuSheet`, `SettingsSheet`,
`ItemEditSheet`, `RecountSheet`, `MoveSheet`, `NewItemSheet`, `StockViewSheet`, `PutAwaySheet`,
`NotificationPrimerSheet`, `InstallGuideSheet`, `SyncSheet`.

Scanner: `ScannerCover`, `CameraViewport`, `Reticle`, `ScannerTopBar`, `TorchButton`, `LowLightHint`,
`ScannerTray`, `ScannerTrayRow`, `UnknownProductSheet`, `StoreCodeSheet`, `ManualEntrySheet`, `QuantityKeypad`.
