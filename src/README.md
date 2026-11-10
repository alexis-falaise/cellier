# src

Dependency rule: `pages` → `features` → `entities` → `shared` (never upwards).

- `app/` — bootstrap: router, providers, global styles and tokens; `app/routes/` holds TanStack file routes (thin, they render a page), `routeTree.gen.ts` is generated.
- `pages/` — route-level screens that compose features; no business logic.
- `features/` — one folder per user-facing use case (`ui/`, `model/`, `index.ts` as public API).
- `entities/` — domain objects and their pure rules (`model/`, `api/` mappers).
- `domain/` — shared domain types copied from `docs/architecture/contracts/domain.ts`.
- `shared/api/` — Supabase client and generated `database.types.ts`.
- `shared/db/` — IndexedDB (`idb`) snapshot, outbox, sync cursor.
- `shared/search/` — MiniSearch index with French diacritic folding.
- `shared/i18n/` — `fr.ts` typed string catalogue and `t()`.
- `shared/lib/` — framework-free helpers (Intl.Collator, dates, ids).
- `shared/ui/` — design-system primitives (Tailwind, Motion).
- `shared/pwa/` — service worker registration and update hook.
- `test/` — Vitest setup and shared fixtures.
- `sw.ts` — service worker (precache, push, notificationclick), built by vite-plugin-pwa.
