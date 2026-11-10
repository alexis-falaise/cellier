# Cellier — design specifications

Specifications for the Cellier interface: a household pantry and basement inventory PWA for French households,
installed to the iOS Home Screen (iPhone 13 to 15 Pro, iOS 16.4+). These documents contain no application code.
They sit on top of `docs/BRIEF.md` and `docs/architecture/00-decisions.md` and cite `docs/research/` notes.

## Index

| File | What it contains | Read it when |
|---|---|---|
| `01-design-system.md` | Principles, colour (warm stone neutrals, bottle-green accent, semantic colours, materials, a 208-pair WCAG contrast table), typography (system sans, New York serif titles, rounded tabular numerals, Dynamic Type), spacing, radii, elevation, safe areas, touch targets, Lucide icon inventory (names checked against lucide-static 1.71.0), the 28 default categories with icon and colour, accessibility checklist, token naming. | Building any visual element. |
| `tokens.css` | The same tokens as a Tailwind CSS v4 `@theme` block, the semantic layer, dark mode (`prefers-color-scheme` and `[data-theme="dark"]`), increased contrast, reduced transparency, safe-area and layout variables. Copy it into the app after `@import "tailwindcss";`. | Setting up styling. |
| `02-motion-haptics.md` | Motion principles, the eight spring presets with exact Motion for React parameters and derived physics, gesture thresholds (drag, sheets, swipe rows, edge swipe back, toasts, pull to refresh), the choreography table for every interaction, the haptic policy and its iOS limits, optional scan sound, performance rules, reduced motion, device checks. | Building anything that moves or responds to touch. |
| `03-screens.md` | Information architecture, route table, deep links, global states (offline, pending sync, conflicts, quarantine, clamped withdrawals, permissions), every screen and sheet with layout, states and copy, data-model implications, and the French copy deck with `fr.ts` keys and plural forms. | Building a screen or writing a string. |
| `04-components.md` | Component inventory: purpose, variants, states, props, accessibility and motion preset for each component used by the screens. | Building the component library. |

Where documents disagree, the order of precedence is: `tokens.css` for values, `02` for motion and gesture numbers,
`03` for behaviour and copy, `04` for component structure.

## Foundations (shared by all documents)

- **Mood.** A cool, quiet stone cellar with good light: warm limestone neutrals, one deep bottle-green accent,
  editorial serif titles, rounded numerals for counts, and springs that only bounce when a finger threw something.
- **Type.** System sans (SF Pro) for UI; `ui-serif` (New York) for titles of 28 px and above and the wordmark;
  `ui-rounded` (SF Pro Rounded) with tabular figures for every quantity. All three ship with iOS, so there are no
  licences and no font downloads.
- **Colour.** One accent: bottle green (`#28704E` light fill, `#30825C` dark fill; text `#226546` / `#82D2A8`).
  Success reuses the accent, running low is amber, errors are brick red, sync and offline states are neutral.
  Category colours are 12 muted hues of equal lightness, used only on icon tiles.
- **Navigation.** Three tabs (Accueil, Stock, Courses) on a floating capsule, with a detached 60 px scan button
  (tap: add; long-press 450 ms: withdraw). The scanner is a full-screen cover. The current pantry name is the large
  title and opens the pantry switcher. Réglages are behind the avatar on Accueil. Item detail is a push; edits are
  sheets; sheets live in search params so Back closes them.
- **Motion.** Presets `press`, `snappy`, `smooth`, `push`, `sheet`, `fling`, `pop`, `reduced`. Only `transform` and
  `opacity` animate. No skeletons for local data, and no animation on search, filtering or sorting.
- **Haptics.** One haptic, at four moments only: a scan lands in the tray, a drag crosses a commit threshold, a native
  switch toggles, a destructive action is confirmed.
- **Voice.** French, neutral imperative or infinitive, never "tu", "vous" only when unavoidable, French typography
  (non-breaking spaces, « », digits, «jeudi 14 nov.»).

## Decisions taken without asking the owner

1. Name of the interface word for a pantry: «cellier»; the first pantry is named «Cave» by default (`03` §6).
2. Accent colour is bottle green, the only saturated colour in the interface (`01` §2).
3. Titles use the New York serif; quantities use SF Pro Rounded tabular figures (`01` §3).
4. Running low, forecasts and the groceries list are computed per product for the whole household; the pantry
   switcher only filters lists (`03` §6).
5. Days of cover are always shown as approximate («≈ 4 j», then weeks after 14 days); estimates with too little
   history show no number (`03` §3.4).
6. Courses: checking an item does not add stock; «Ranger» or a scan does (`03` §4.8).
7. Stock swipe actions: leading «+1» (purchase), trailing «−1» (consume) (`03` §6).
8. Notification permission is requested after the first scan session from an inline card on Accueil, never during
   onboarding (`03` §4.2.2).
9. Scanner overlays are component state, not URL state, because changing the URL while the camera runs can stop it
   in a Home Screen app. The scanner cover itself is in the URL (`03` §9).
10. Confirmation dialogs are also in the URL so Back cancels them (`03` §9).
11. «Tous les celliers» is offered in the pantry switcher when the household has two or more pantries (`03` §9).
12. The scan-success haptic is behind a device-test gate: it ships only if it fires reliably from an asynchronous
    worker result; otherwise scan success is visual, with an optional sound «Son au scan» (off by default) (`02` §5–6).
13. A custom left-edge swipe back exists only in the installed app (`02` §3).
14. Under Reduce Motion, a release after a finger drag settles with `snappy` instead of a cross-fade, so nothing
    jumps from under the finger (`02`, deviations).
15. Categories: the 28 categories of `docs/research/06-category-mapping.md` are adopted unchanged, with the same
    snake_case slugs; nothing was merged or renamed (`01` §6.3).
16. Sheets are opaque; only the tab bar, the scrolled navigation bar and toasts use translucent material (`01` §2.4).
17. The `theme-color` values are `#F6F4F1` (light) and `#0F0E0C` (dark), replacing the provisional values in
    `research/21`.

## Notes for the architecture thread

- `03` §5 lists data-model additions the screens need: a `grocery_entries` table; `products.usual_qty` and
  `products.min_qty` (with `stock.min_quantity` unused in v1); single-use 8-character invite codes with a pre-auth
  `peek_invite(code)` RPC; per-device notification preferences on `push_subscriptions`; `delete_account` and
  household-deletion RPCs; overwritten-field records in `change_log`; movement kinds (purchase, consume, recount,
  transfer) and a `source` field.
- Lucide 1.x renamed several icons (`trash-2` → `trash`, `circle-alert` → `circle-exclamation-point`,
  `triangle-alert` → `triangle-exclamation-point`, `circle-help` → `circle-question-mark`, `history` →
  `rotate-ccw-clock`). Pin the `lucide-react` version and check names against it.

## Open questions (to verify on device; none block implementation)

1. Does the iOS switch haptic fire from an asynchronous worker result, 10 s and 30 s after the last touch? This decides
   the scan haptic (`02` §5, §10).
2. Does `getUserMedia` start after a timer-fired long-press? The spec already starts the camera on finger lift; if
   that also fails, the withdraw cover opens with a «Démarrer» tap (`03` §8).
3. Does Safari apply SF Pro's tracking automatically to `-apple-system`? If so, the explicit tracking tokens double it
   (`01` §3.2).
4. Does the `-apple-system-body` probe report the Dynamic Type size inside a Home Screen app (`01` §3.3)?
5. Exact iOS 26 labels for the install guide («Partager», «Sur l'écran d'accueil», «Ouvrir comme app web») and the
   camera settings path (`03` §8).
6. Does iOS keep a system back-swipe in installed web apps? If it does, the custom edge swipe must not run (`02` §10).
7. Tailwind v4 support for `@theme static`, and Safari support for `prefers-reduced-transparency` (a manual
   `data-transparency="reduced"` hook is provided) (`01` §11).
8. Product questions for later: one household per account in v1; members cannot invite (owner only) (`03` §8).
