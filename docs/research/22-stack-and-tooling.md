# 22 - Stack and tooling for Cellier

Date of research: 2026-11-10. Versions come from `npm view <pkg> version` run on 2026-11-10 unless marked otherwise. Items marked **UNVERIFIED** were not confirmed against a primary source in this pass.

## 0. Verdict

Keep the leading candidate: **Vite 8 + React 19 + TypeScript SPA, no SSR, deployed as static files on Vercel**. An offline-first, iOS-first PWA gains nothing from SSR, and the animation and sheet libraries (Motion, Vaul, Sonner) are React-first. Preact, Solid and Svelte 5 would be faster on paper, but the difference is small on a mid-range iPhone for a list-and-forms app, and the ecosystem cost is real. Stay on React.

Pinned key versions: `vite@8.3.7`, `react@19.3.1`, `@vitejs/plugin-react@6.3.0`, `@tanstack/react-router@1.170.46`, `tailwindcss@4.3.5`, `vite-plugin-pwa@2.0.0`, `@supabase/supabase-js@2.119.0`, `vitest@5.1.0`, `@biomejs/biome@2.6.6`, `typescript@7.0.2`.

Sources for the Vite and PWA claims: https://vite.dev/blog/announcing-vite8 ; https://vite-pwa-org.netlify.app/guide/ ; https://react.dev/learn/react-compiler/installation

## 1. React 19 vs Preact, Solid, Svelte 5

Honest comparison for this app (lists of a few thousand items, sheets, forms, tab screens, sync in the background):

| Criterion | React 19 (+ Compiler) | Preact 11.2.0 | SolidJS 1.9.18 | Svelte 5.57.3 |
|---|---|---|---|---|
| Runtime performance, mid-range iPhone | Adequate. The Compiler removes most manual memo work. Virtualisation matters more than the framework. | Similar to React for this app, smaller runtime. | Fastest fine-grained updates. Advantage is hard to feel in a list-and-form app. | Very fast, compiled output. |
| Bundle size (runtime, gzipped) | Largest of the four (about 45 KB for react + react-dom, UNVERIFIED figure). | Around 4 KB (UNVERIFIED). | Small (UNVERIFIED). | Small, compiled per component (UNVERIFIED). |
| Springs, sheets, gestures | Motion 14.12.0, Vaul 1.1.2, Sonner 2.0.8 are React-first. | Works via `preact/compat`, with friction. | Little equivalent. You would write sheets and springs yourself. | Svelte-specific motion helpers; no Vaul equivalent. |
| Headless primitives | Base UI, React Aria, Radix, Ark (all have React versions). | Compat layer required. | Kobalte, Ark (Solid). | Bits UI, Melt UI. |
| Hiring, examples, AI assistance | Largest. | Small. | Small. | Medium. |

**Verdict:** React 19 with the React Compiler. The performance argument for the others is real but not decisive at this scale, and the animation and sheet ecosystem is where Cellier needs the most help. Re-evaluate only if profiling on a real iPhone shows render cost after virtualisation and the Compiler are in place.

## 2. Vite 8, Rolldown, Environment API, React plugin

- **Vite 8.3.7** (npm). Stable 8.0 announced 2026-03-12. Node 20.19+ or 22.12+ required. Source: https://vite.dev/blog/announcing-vite8
- **Rolldown** is the single bundler in Vite 8, replacing esbuild (dev) and Rollup (build). Vite, Rolldown and Oxc form one toolchain. Source: same.
- **Environment API** is not yet stable per the Vite 8 announcement. Do not build on it; Cellier does not need it.
- **`@vitejs/plugin-react@6.3.0`**. In v6, React Refresh uses Oxc, Babel is no longer a dependency, and `reactCompilerPreset` is provided for `@rolldown/plugin-babel`. v5 still works with Vite 8, so the upgrade can be separate. Source: https://vite.dev/blog/announcing-vite8
- **`@vitejs/plugin-react-swc@4.3.3`** is the SWC variant. Pick the Oxc-based v6 plugin unless a specific SWC-only feature is needed.

### Enabling the React Compiler (confirmed)

Source: https://react.dev/learn/react-compiler/installation

```bash
pnpm add -D @rolldown/plugin-babel@0.3.1 babel-plugin-react-compiler@1.0.0
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
});
```

The docs do not mention SWC or Oxc variants of the Compiler path; it is Babel-based via `@rolldown/plugin-babel`. Compiler options (for example targeting React below 19) are in https://react.dev/reference/react-compiler/configuration (not fetched in this pass, **UNVERIFIED** details).

### Vite config skeleton

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { VitePWA } from 'vite-plugin-pwa';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  build: { target: 'es2022', sourcemap: true },
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }), // UNVERIFIED option names
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    VitePWA({ /* see section 7 */ }),
  ],
});
```

Note: `tanstackRouter` options are **UNVERIFIED**; check the `@tanstack/router-plugin` docs before use.

## 3. Routing for stacked screens, tabs, sheets, transitions

Options: TanStack Router 1.170.46, React Router 8.5.1 (SPA / library mode), wouter 3.13.0, custom stack navigator.

**Recommendation: TanStack Router in SPA mode** (type-safe search params, file-based routes, code splitting, pending states). Keep it in SPA mode, no loaders on the server.

- **Stacked screens**: model the stack as nested routes (`/inventory/$itemId`). Push and pop come from the router history; animate with a `View Transition` wrapper or Motion `AnimatePresence` keyed on the matched route.
- **Tabs and keep-mounted screens**: render the tab root layouts outside the router outlet, one per tab, and keep them mounted with React's `<Activity mode="hidden">` (React 19.2+ API, **UNVERIFIED** in this pass; confirm in react.dev before relying on it). Each tab keeps its scroll element and form state while hidden.
- **Scroll restoration**: save `scrollTop` per route key in a ref map on leave and restore on enter, not `window.scrollTo` only, because the scroll container is an inner element on iOS. Use `history.state` only for the key.
- **Sheets**: sheet open state lives in the URL search params (`?sheet=item:123`) so the back gesture closes the sheet and deep links work. Vaul 1.1.2 handles the drag and snap; bind its `open` to the search param.
- **wouter 3.13.0** is a good fallback if TanStack's type surface feels heavy; it has no nested-layout or search-param typing, so the sheet and stack rules above become hand-written.
- **React Router 8.5.1** in library mode also works and is the most familiar; the trade-off is weaker typing for search params. Acceptable alternative.
- **Custom stack navigator** is the smallest option (under 200 lines) and is fine if Cellier only needs push/pop plus tabs. Not recommended if deep links and offline cold starts matter.

## 4. Styling

Recommendation: **Tailwind CSS 4.3.5 with `@theme` and CSS variables, via `@tailwindcss/vite@4.3.5`**. Build-time only, zero runtime, tokens shared between CSS and JS through `var(--…)`.

- `@theme` defines tokens as CSS variables; Tailwind v4 emits utilities from them.
- Dark mode and theming: override variables on `:root[data-theme]`.
- Alternatives: vanilla-extract 1.21.3 (zero runtime, typed tokens, more ceremony); Panda CSS 2.5.0 (zero runtime, codegen, heavier); StyleX 0.19.1 (zero runtime, Meta, strong typing, less documentation for Vite); CSS Modules with custom properties (zero runtime, most minimal, no utilities).
- **Pick Tailwind v4** for speed of development and because the design tokens map cleanly to `@theme`. Pick vanilla-extract if typed tokens across TS become more important than utility velocity.

## 5. Headless primitives

- **Base UI** `@base-ui-components/react@1.0.0-rc.0` (npm). The npm version is still a release candidate; the "1.x" label in the brief is only true for the RC line. **UNVERIFIED** whether a stable 1.0 has shipped.
- **React Aria Components** `react-aria-components@1.22.1`. Most mature accessibility behaviour (focus management, keyboard, screen-reader announcements), unstyled.
- **Radix** `@radix-ui/react-dialog@1.3.1`. Mature, widely used, stable.
- **Ark UI** `@ark-ui/react@5.40.0`. Zag state machines, framework-agnostic core.

**Best maintained in 2026 based on npm activity: Radix and React Aria**, with Base UI rising. For Cellier's sheets and dialogs, use Vaul for the bottom sheet and React Aria Components for form controls and menus where a11y matters most. (Maintenance judgement is based on release cadence seen in npm; **UNVERIFIED** against GitHub activity.)

## 6. IndexedDB, offline data, in-memory state

- **`idb` 8.0.4**: thin Promise wrapper over IndexedDB. Good if you want raw control and small size.
- **Dexie 4.4.7**: richer query API, live queries, schema migrations. Use if queries get complex.
- **`idb-keyval` 6.3.0**: key-value only; enough for a single snapshot.
- **Recommendation**: for a few thousand inventory items, **in-memory state plus a persisted snapshot** (write the whole collection to IndexedDB via `idb`, debounced) is enough. Add an outbox table for pending writes. Move to Dexie only if you need indexed queries offline.

## 7. Lists, search, sorting

- **Virtualisation**: `@tanstack/react-virtual@3.14.26` (headless, fits custom rows); `react-virtuoso@4.18.21` (grouped and sticky headers out of the box). Pick TanStack Virtual for a flat list with custom sticky sections; Virtuoso if grouped alphabet headers are needed.
- **Client-side search with French diacritics**:
  - `minisearch@7.2.0`: small, fast, supports `processTerm` and `tokenize` hooks. Fold diacritics with `s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()` on both index and query.
  - `fuse.js@7.5.0`: fuzzy, simple, slower on large sets.
  - uFuzzy and FlexSearch: not fetched in this pass (**UNVERIFIED** versions).
  - Recommendation: **MiniSearch** with diacritic folding, for a few thousand items.
- **Sorting**: `new Intl.Collator('fr', { sensitivity: 'base', numeric: true }).compare`. Safari supports it.

## 8. Supabase client and types

- `@supabase/supabase-js@2.119.0`, `@supabase/auth-js@2.119.0`. Tree-shakes with ESM; import only what you use.
- Generate types with the Supabase CLI: `supabase gen types typescript --project-id <id> > src/shared/api/database.types.ts`. Commit the generated file.
- `@supabase/ssr@0.12.7` is for server frameworks; not needed for an SPA.

## 9. Dates and i18n

- **`Temporal`**: not usable as a shipped API on Safari or iOS Safari. Per caniuse (https://caniuse.com/temporal): Chrome and Edge 144+, Firefox 139+; desktop Safari and iOS Safari not supported in any listed stable release (up to 26.6). **Do not rely on Temporal**; use a polyfill (`@js-temporal/polyfill`, version **UNVERIFIED**) only if needed.
- **Dates**: `date-fns` (version **UNVERIFIED** in this pass) for arithmetic and formatting; `Intl.DateTimeFormat('fr-FR')` for display.
- **Relative time**: `Intl.RelativeTimeFormat('fr', { numeric: 'auto' })`, native, no library.
- **i18n**: French-first. Keep strings in one `fr.ts` catalogue typed as the source of truth; add `en` later. No i18n framework needed at this size. (A library such as `i18next` is **UNVERIFIED** as unnecessary; judgement call.)

## 10. Testing

- **Vitest `5.1.0`** (npm current). The brief mentioned 3 or 4; npm shows 5.1.0 as latest. Use the latest and check the changelog for breaking changes.
- **Playwright `@playwright/test@1.65.0`**. Use the WebKit project with iPhone device emulation:

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'], defaultBrowserType: 'webkit' } },
  ],
  webServer: { command: 'pnpm preview', port: 4173, reuseExistingServer: true },
});
```

Device name `'iPhone 15'` is a standard Playwright device descriptor (**UNVERIFIED** that it is present in 1.65; check `devices` at runtime).

## 11. Linting and formatting

- **Biome `@biomejs/biome@2.6.6`**: lint and format in one tool, fast, low config. Recommended.
- **ESLint 10.14.0 + Prettier 3.9.10**: more plugins; `eslint-plugin-react-hooks@7.1.1` (React Compiler rules) is ESLint-only. If the React Compiler lint rules are wanted, keep ESLint for that rule.
- **oxlint 1.93.0**: very fast linter, can run alongside Biome for extra rules.
- **Recommendation**: Biome for format and baseline lint, plus `eslint-plugin-react-hooks` in a minimal ESLint config for Compiler-aware hook rules.

## 12. TypeScript and package manager

- `typescript@7.0.2` (npm). The native (Go-based) compiler line. Check that every tool in the chain (Vitest, Playwright, plugins) accepts TS 7 before upgrading. **UNVERIFIED** compatibility; fallback is the latest TS 5.x line.
- **Package manager**: `pnpm@12.18.0` (npm latest, the brief assumed pnpm 10). Use `packageManager` in `package.json` and enable Corepack. Vercel build support for this pnpm version is **UNVERIFIED**; if unsupported, pin `pnpm@10.x` (version not fetched).
- Bun is not recommended here: Vercel support for Bun installs is less standard for this stack.

## 13. PWA: vite-plugin-pwa, Workbox

- **Current version**: `vite-plugin-pwa@2.0.0` (npm). The docs navigation displayed v1.2.0 (https://vite-pwa-org.netlify.app/guide/); the discrepancy is **UNVERIFIED**, trust npm for the pinned version and read the 2.0 changelog before upgrading.
- **generateSW vs injectManifest**: `generateSW` generates the whole service worker with Workbox. `injectManifest` compiles your own `sw.ts` and injects the precache manifest. **Use `injectManifest`** because you need custom `push` and `notificationclick` handlers. (The docs page fetched did not cover this comparison; the recommendation is from the plugin's documented strategies, **UNVERIFIED** in the exact config keys.)
- **TypeScript service worker** (UNVERIFIED config keys, check the injectManifest guide):

```ts
// vite.config.ts (inside VitePWA)
VitePWA({
  registerType: 'prompt',            // update prompt, see below
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  injectManifest: { injectionPoint: 'self.__WB_MANIFEST' },
  devOptions: { enabled: true, type: 'module' },
  manifest: { name: 'Cellier', short_name: 'Cellier', lang: 'fr', display: 'standalone', start_url: '/', theme_color: '#000000', icons: [] },
})
```

```ts
// src/sw.ts (sketch)
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: unknown };
precacheAndRoute(self.__WB_MANIFEST as never);
cleanupOutdatedCaches();

// Product images (Open Food Facts): cross-origin, may be opaque (status 0)
registerRoute(
  ({ url }) => url.hostname.endsWith('openfoodfacts.org') && /\.(jpg|png|webp)$/i.test(url.pathname),
  new CacheFirst({
    cacheName: 'off-images',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  }),
);

// Supabase REST reads: NetworkFirst with fallback to cache, GET only
registerRoute(
  ({ url, request }) => url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/v1/') && request.method === 'GET',
  new NetworkFirst({ cacheName: 'api-reads', networkTimeoutSeconds: 4, plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 })] }),
);

// Push and notification click
self.addEventListener('push', (event) => { /* show notification, French copy */ });
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/'));
});
```

Notes: Supabase writes (POST/PATCH) must never be cached; the sync outbox handles them. The `CacheableResponsePlugin` status `0` is required for opaque cross-origin images.

- **Update prompt**: with `registerType: 'prompt'`, use `useRegisterSW` from `virtual:pwa-register/react` to show a "Mise à jour disponible" banner; call `updateSW(true)` to activate.
- **Dev options**: `devOptions: { enabled: true, type: 'module' }` lets you test the SW in `vite dev`. Use `preview` for real checks.
- `workbox-window@7.4.1` is available if you need `Workbox` events directly; not required with the plugin's hook.

## 14. Vercel configuration for a Vite SPA

`vercel.json` (sketch; verify header syntax against Vercel docs, **UNVERIFIED** for exact CSP string):

```json
{
  "rewrites": [{ "source": "/((?!assets/|sw\\.js|manifest\\.webmanifest|icons/).*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/sw.js", "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] },
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/manifest.webmanifest", "headers": [{ "key": "Content-Type", "value": "application/manifest+json" }] },
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" },
      { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https://*.openfoodfacts.org https://images.openfoodfacts.org https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.openfoodfacts.org https://accounts.google.com https://oauth2.googleapis.com; frame-src https://accounts.google.com; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'" }
    ]}
  ]
}
```

Notes:
- Vercel serves real files before rewrites, so the catch-all is safe. The exclusion list is defensive.
- `'wasm-unsafe-eval'` is needed only if WASM is used (e.g. a barcode or image library); drop it otherwise.
- `'unsafe-inline'` for styles is usually needed by Tailwind and by Motion inline styles; avoid `unsafe-inline` for scripts.
- Open Food Facts domains: confirm the exact image hosts (`images.openfoodfacts.org`, `world.openfoodfacts.org`) before locking CSP. **UNVERIFIED**.
- Google sign-in with Supabase OAuth uses redirect flow; if a popup flow is used, `frame-src`/`connect-src` need the Google hosts above (UNVERIFIED for the exact set Google currently requires).

### Environment variables

Vite exposes only `VITE_`-prefixed variables to the client:

```bash
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Never prefix a secret with `VITE_`; it would be bundled. Use the publishable (anon) key only.

## 15. Performance budgets and measurement

Suggested budgets (judgement, **UNVERIFIED** against a source):
- JS gzipped initial route: under 150 KB.
- LCP under 2.5 s on a throttled mid-range iPhone profile; INP under 200 ms; CLS under 0.1.

Measurement:
- **Lighthouse**: `npx lighthouse https://<preview-url> --preset=desktop` plus a mobile run; or the chrome-devtools MCP `lighthouse_audit` tool.
- **Bundle visualiser**: `rollup-plugin-visualizer@7.1.3` (npm). Add to `plugins` with `filename: 'stats.html'`, `gzipSize: true`, run on build only.
- **Runtime**: Playwright with iPhone WebKit emulation plus CPU throttling for interaction traces.

## 16. Exact `package.json` dependency list (pinned)

```json
{
  "packageManager": "pnpm@12.18.0",
  "type": "module",
  "engines": { "node": ">=22.12.0" },
  "dependencies": {
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "@tanstack/react-router": "1.170.46",
    "@tanstack/react-query": "5.107.1",
    "@supabase/supabase-js": "2.119.0",
    "motion": "14.12.0",
    "vaul": "1.1.2",
    "sonner": "2.0.8",
    "react-aria-components": "1.22.1",
    "@radix-ui/react-dialog": "1.3.1",
    "minisearch": "7.2.0",
    "idb": "8.0.4",
    "@tanstack/react-virtual": "3.14.26",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "vite": "8.3.7",
    "@vitejs/plugin-react": "6.3.0",
    "@rolldown/plugin-babel": "0.3.1",
    "babel-plugin-react-compiler": "1.0.0",
    "@tanstack/router-plugin": "1.169.0",
    "@tanstack/react-query-devtools": "5.107.1",
    "vite-plugin-pwa": "2.0.0",
    "workbox-precaching": "UNVERIFIED",
    "workbox-routing": "UNVERIFIED",
    "workbox-strategies": "UNVERIFIED",
    "workbox-expiration": "UNVERIFIED",
    "workbox-cacheable-response": "UNVERIFIED",
    "tailwindcss": "4.3.5",
    "@tailwindcss/vite": "4.3.5",
    "typescript": "7.0.2",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "vitest": "5.1.0",
    "@playwright/test": "1.65.0",
    "@biomejs/biome": "2.6.6",
    "eslint": "10.14.0",
    "eslint-plugin-react-hooks": "7.1.1",
    "oxlint": "1.93.0",
    "rollup-plugin-visualizer": "7.1.3"
  }
}
```

Notes:
- Workbox packages are not version-pinned here because their current versions were not fetched; `workbox-window@7.4.1` was confirmed. Pin them with `npm view` before install (Vite PWA plugin pulls its own workbox-build 7.4.1).
- `zod` 4.6.7 is optional, for validating API responses; drop if unnecessary.
- `date-fns`, `@js-temporal/polyfill`, `@base-ui-components/react` are deliberately omitted (see sections 5 and 9).
- `eslint` is only for the Compiler-aware hooks rule; drop if that rule is not wanted.
- Before install, run `pnpm add --save-exact` to keep exact pins.

## 17. Proposed `src/` structure (feature-sliced, clean architecture)

```
src/
  app/                     # bootstrap: providers, router, global styles, sw registration
    providers.tsx
    router.tsx
    styles/tokens.css      # @theme + CSS variables
  pages/                   # route-level composition only (screens)
    inventory/
    search/
    settings/
  features/                # user-facing use cases, one folder each
    add-item/
      ui/                  # components, sheets
      model/               # hooks, state machine, use-cases
      index.ts             # public API of the slice
    sync-outbox/
    barcode-lookup/
  entities/                # domain objects and their pure rules
    item/
      model/               # types, invariants, pure functions
      api/                 # DTOs and mappers
  shared/
    api/                   # supabase client, database.types.ts
    db/                    # IndexedDB snapshot + outbox (idb)
    search/                # MiniSearch index + French diacritic folding
    i18n/                  # fr.ts catalogue
    lib/                   # Intl.Collator, date helpers
    ui/                    # design system primitives (Tailwind, React Aria wrappers)
    pwa/                   # update prompt hook
  test/                    # Vitest setup, Playwright fixtures
```

Dependency rule: `pages` may import `features`, `entities`, `shared`; `features` may import `entities` and `shared`; `entities` may import only `shared`. Clean architecture inside a slice: `ui` depends on `model`, `model` depends on `api` interfaces, and `api` implementations (Supabase, IndexedDB) are injected at `app`.

## Unverified items (summary)

- Base UI stable 1.0 status.
- Preact, Solid, Svelte bundle figures.
- Bundle size of React runtime figure.
- `<Activity>` for keeping tab screens mounted (React 19.2+).
- `tanstackRouter` plugin option names.
- `vite-plugin-pwa` injectManifest config keys and TS service worker setup.
- `vite-plugin-pwa` v1.2.0 vs 2.0.0 discrepancy.
- Vercel header syntax and final CSP host list (Open Food Facts image hosts, Google).
- pnpm 12 support on Vercel.
- Workbox package versions.
- `date-fns`, `@js-temporal/polyfill`, uFuzzy, FlexSearch versions.
- Performance budgets.
- TypeScript 7 compatibility with the tool chain.

## Sources

- https://vite.dev/blog/announcing-vite8
- https://react.dev/learn/react-compiler/installation
- https://vite-pwa-org.netlify.app/guide/
- https://caniuse.com/temporal
- npm registry (`npm view <pkg> version`, 2026-11-10) for all pinned versions
