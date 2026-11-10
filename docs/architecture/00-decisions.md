# 00 — Decisions

Binding decisions for design and implementation. Each one points to the research note that backs it.
Research notes flag many items as UNVERIFIED: verify a version or API at the moment you use it, and record
any deviation at the bottom of this file.

## Product

- Name: **Cellier**. UI language: French first (strings in one typed `fr.ts` catalogue).
- Platform: **PWA**, installed to the iOS Home Screen. Native is ruled out: the free Apple tier has no remote
  push, no distribution and 7-day profiles (`research/01`).
- Targets: iPhone 13 → 15 Pro, iOS 16.4+ (Web Push floor), tested on a real phone through the Vercel URL.

## Stack (`research/22`)

- Vite 8 + React 19 (React Compiler) + TypeScript, SPA, no SSR, static deploy on Vercel.
- pnpm 10 (installed locally). TypeScript 7 only if every tool accepts it, otherwise the latest 5.x.
- Routing: TanStack Router, SPA mode. Sheet state lives in search params so back closes a sheet.
- Styling: Tailwind CSS v4, tokens in `@theme` as CSS variables. No runtime CSS-in-JS.
- Motion: Motion for React (`motion/react`) with `LazyMotion` + `m`, `MotionConfig reducedMotion="user"`.
  Springs for everything that moves; CSS transitions only for colour and opacity state changes (`research/18`, `19`).
- Sheets, toasts, steppers: own components on Motion (drag + spring), so every transition is a spring.
- Lists: TanStack Virtual. Search: MiniSearch with diacritic folding. Sort: `Intl.Collator('fr')`.
- PWA: `vite-plugin-pwa`, `injectManifest`, own `sw.ts` (precache, images, push, notificationclick) (`research/21`).
- Lint and format: Biome. Tests: Vitest, Playwright (WebKit, iPhone profile).

## State and sync (`research/14`, `15`, `13`, `16`)

- Linear-style local-first store: normalised in-memory maps exposed through `useSyncExternalStore`
  selectors; the view is `base + pending overlay`. No query cache library.
- Persistence: IndexedDB (`idb`): object snapshot, outbox, sync cursor. Boot renders from IndexedDB first.
- Writes: every user action is a mutation with a client UUID, applied optimistically, queued in the outbox,
  sent through one idempotent RPC `apply_mutations(jsonb)` (security invoker, RLS applies).
- Reads: `pull_changes(since)` RPC over a per-household `change_log` with a monotonic `sync_id`; tombstones for deletes.
- Realtime: Broadcast from the database on a private channel `household:<uuid>`, carrying only `{sync_id}`;
  the client then pulls. Delivery is at-most-once, so the client also pulls on reconnect and on foreground.
- Flush triggers: mutation, app start, `online`, `visibilitychange`, visible-only timer. No Background Sync on iOS.
  One flusher at a time via `navigator.locks`. Exponential backoff with jitter.
- Conflicts: stock is an append-only `stock_movements` ledger (deltas commute); `stock.quantity` is a
  trigger-maintained cache with `check (quantity >= 0)`; withdrawals clamp server side. Descriptive fields:
  per-field last-writer-wins. Deletes: tombstones. Mutations queued by a removed member are quarantined, not dropped.

## Data model (Supabase Postgres)

- `households`, `household_members` (role `owner | member`, exactly one owner), `household_invites`.
- `pantries` (per household). `categories` (global defaults with icon + colour, per-household overrides).
- `catalog_products`: global reference seeded from Open Food Facts family (ODbL, kept in its own table),
  keyed by GTIN. `products`: per-household product (links to a catalogue row or is custom; holds overrides:
  name, category, unit size, price, minimum).
- `stock` (pantry × product: quantity, min_quantity, updated_at), `stock_movements` (ledger).
- `push_subscriptions`, `notification_outbox`, `change_log`, `applied_mutations`.
- RLS on every table through a `private.my_household_ids()` security-definer helper, `to authenticated`,
  `(select auth.uid())`. Indexes on every foreign key and on every sort/filter the app uses.

## Product data (`research/02`, `03`, `04`, `05`, `07`, `09`)

- Lookup chain on scan: local store → `catalog_products` → Open Food Facts universal endpoint
  (`/api/v3/product/{ean}?product_type=all`, covers food, beauty, household products) → manual entry
  (name + category only). Results found online are cached into `catalog_products`.
- Catalogue seed: Open Food Facts Parquet dump filtered to France, biased to E.Leclerc and Carrefour
  (store and brand tags), 100k–150k rows, within the 500 MB free database.
- Prices: Open Prices (France, Leclerc and Carrefour locations), most recent price per GTIN; user override wins.
- Barcodes: EAN-13, EAN-8, UPC-A, UPC-E; canonical key is a 14-digit GTIN. In-store codes (prefix 02, 20–29)
  are variable-measure and go to manual entry.

## Scanner (`research/08`)

- `zxing-wasm` reader in a Web Worker on cropped frames, checksum check in JS, duplicate debounce.
  Camera opened from a tap, `playsinline muted autoplay`. Continuous scan with a tray, stepper (default 1), undo.

## Auth (`research/17`)

- Google only. Google Identity Services button → `signInWithIdToken` (no redirect out of the installed app);
  fallback: PKCE redirect to `/auth/callback`.

## Notifications and forecasting (`research/11`, `12`, `24`)

- Web Push with VAPID, permission asked from a tap inside the installed app. Declarative payload shape,
  classic service-worker handler as fallback. Every push shows a notification.
- Server: trigger writes `notification_outbox` when an item crosses its minimum; `pg_cron` drains it through
  an Edge Function; one daily digest at 18:00 Europe/Paris; 410 endpoints are pruned.
- Running low: quantity ≤ minimum, or forecast days-left under a threshold. Minimum is per item, suggested
  from history. Next groceries list and its date come from per-item consumption rates (`research/24`).

## Haptics (`research/10`)

- iOS has no Vibration API. Use the hidden `<input type="checkbox" switch>` + label click technique from
  gesture handlers (iOS 18+), `navigator.vibrate` elsewhere, no-op fallback. One haptic style only, so use it sparingly.

## Deviations

From the scaffold (package zero):

- TypeScript 7.0.2 is used: every tool in the chain accepts it.
- No vaul, sonner, react-aria, radix, react-query, zod, eslint or oxlint (listed in `research/22`): sheets and
  toasts are own components on Motion, lint is Biome only.
- `src/domain/types.ts` is a verbatim copy of `docs/architecture/contracts/domain.ts`; recopy when the contract changes.
- Route files live in `src/app/routes/` and only render a page from `src/pages/`. `src/app/routeTree.gen.ts`
  is generated and committed.
- Manifest is a static `public/manifest.webmanifest` with `start_url: "/"`.
- `vercel.json`: `Permissions-Policy` allows `camera=(self)` (scanner); the CSP names the exact Supabase origin.
  `zxing-wasm` must load its `.wasm` from the app origin, not the CDN.
- Three tsconfig projects (app, service worker, node); `typecheck` runs each.
- Viewport height uses `100dvh` only (iOS 16.4+ supports it).
- Production URL: `https://cellier-one.vercel.app` (Vercel project `cellier`, production branch `main`).

From the architecture thread (`docs/architecture/01`–`05`, `supabase/migrations/`):

- **Stock minimum lives on `products.min_quantity`** (household-wide «seuil», design `min_qty`), not on `stock`;
  `products.usual_quantity` is the design's `usual_qty` override. `stock` holds only the quantity. Field names
  keep the `_quantity` suffix used everywhere else.
- **Categories are copied per household** from `category_templates` (28 slugs from research/06) when the
  household is created. Icons and colours come from the design system by slug; the database holds key, name, order.
- **Ownership is the `role` column** of `household_members` (one owner, partial unique index); `households`
  has no `owner_id`.
- **The change log stores no row content**; `pull_changes` returns current rows, which compacts repeated edits.
- **Sync bookkeeping lives in the `private` schema** (change log, idempotency store, aliases, outbox, low-stock
  state, invite attempts, catalogue lookup log), not exposed through the Data API.
- **The PWA never calls Open Food Facts directly**: the `catalog-lookup` Edge Function proxies, caches into
  `catalog_products` and enforces rate limits. The category mapping is a JSON artefact used by the seed
  pipeline and the Edge Function, not a database table.
- **Stock quantities are integers** (units or packs); weight and volume are product attributes only.
- **Members are hard-deleted** when they leave or are removed; their ledger rows keep `actor_id` until the account
  itself is deleted (then null).
- **Household creation seeds one pantry** (default name «Cellier») besides the categories.
- **The sync engine runs on the main thread** (no worker): payloads are small and IndexedDB is async.
- **Wire format is camelCase JSON** built in SQL, so no mapping layer exists on the client.
- **Idempotent replays return the stored result with `replayed: true`** instead of a separate status.
- **Routes are the design thread's English routes** (`/welcome`, `/join#<code>`, `/items/$productId`,
  `/groceries`, …); the French paths in early research are replaced.
- **Movement kinds**: the ledger keeps finer kinds (`restock`, `consume`, `discard`, `recount`, `transfer_out`,
  `transfer_in`, `correction`); the UI groups them as purchase / consume / recount / transfer / undo. `source`
  (`scan`, `swipe`, `stepper`, `put_away`, `form`, `undo`) is stored per movement.
- **Courses**: `grocery_entries` holds manual entries and dismissals; running-low suggestions are computed by the
  client and have no row until dismissed. Checking never changes stock.
- **Overwrite records** (`field_overwrites`) are written by a trigger when a field written by another device in
  the last 7 days is replaced, and synced as entity `overwrite`, instead of extra columns in `change_log`.
- **Invites are owner-only**, single use, 8 Crockford characters, 7 days; `peek_invite` is the only RPC callable
  by `anon`. Redemption is rate limited per user or client address and globally.
- **Notification switches exist per device** (`push_subscriptions.notify_*`, edited in the UI) and per member
  (`household_members.notify_*`, default on, not shown in v1); a push needs both.
- **Running-low pushes fire only on a decrease** of the household total; product-setting changes and pantry
  deletion update the state silently. The actor is not notified, so a one-member household gets the digest only.
- **`delete_account`** hands each owned household to the longest-standing member, or deletes it when the owner is
  alone, then deletes the auth user.
- **No separate database review agent ran** (rate limited); the migrations were self-reviewed. Run the Supabase
  advisors on a branch before production.
