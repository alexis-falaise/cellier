# Cellier — design specifications

Specifications for the Cellier interface: a household pantry and basement inventory PWA for French households,
installed to the iOS Home Screen (iPhone 13 to 15 Pro, iOS 16.4+). These documents contain no application code.
They sit on top of `docs/BRIEF.md` and `docs/architecture/00-decisions.md` and cite `docs/research/` notes.

## Index

| File | What it contains | Read it when |
|---|---|---|
| `01-design-system.md` | Principles, colour (cool fog neutrals, spruce accent, restrained semantic colours, materials, a WCAG contrast table for light, dark and increased contrast), typography (system sans, Schibsted Grotesk display titles, SF Pro tabular numerals, Dynamic Type), spacing, radii, elevation, safe areas, touch targets, Lucide icon inventory (names checked against lucide-static 1.71.0), the 28 default categories with icon and colour, accessibility checklist, token naming. | Building any visual element. |
| `tokens.css` | The same tokens as a Tailwind CSS v4 `@theme` block, the semantic layer, dark mode (`prefers-color-scheme` and `[data-theme="dark"]`), increased contrast, reduced transparency, safe-area and layout variables. Copy it into the app after `@import "tailwindcss";`. | Setting up styling. |
| `02-motion-haptics.md` | Motion principles, the eight spring presets with exact Motion for React parameters and derived physics, gesture thresholds (drag, sheets, swipe rows, edge swipe back, toasts, pull to refresh), the choreography table for every interaction, the haptic policy and its iOS limits, optional scan sound, performance rules, reduced motion, device checks. | Building anything that moves or responds to touch. |
| `03-screens.md` | Information architecture, route table, deep links, global states (offline, pending sync, conflicts, quarantine, clamped withdrawals, permissions), every screen and sheet with layout, states and copy, data-model implications, and the French copy deck with `fr.ts` keys and plural forms. | Building a screen or writing a string. |
| `04-components.md` | Component inventory: purpose, variants, states, props, accessibility and motion preset for each component used by the screens. | Building the component library. |

Where documents disagree, the order of precedence is: `tokens.css` for values, `02` for motion and gesture numbers,
`03` for behaviour and copy, `04` for component structure.

## Foundations (shared by all documents)

- **Mood.** A cool, quiet Nordic pantry with good light: paper-white and fog neutrals, near-black ink, one deep
  spruce accent, a Scandinavian grotesk for titles, and springs that only bounce when a finger threw something.
- **Type.** System sans (SF Pro) for UI; Schibsted Grotesk (Oslo, SIL OFL, self-hosted 46 KB woff2, precached) for
  titles of 28 px and above and the wordmark, with explicit size-specific tracking; SF Pro semibold with tabular
  figures for every quantity.
- **Colour.** Neutrals are a cool fog (light canvas `#F2F4F4`, cells `#FDFEFE`, ink `#0F1414`; dark canvas `#090D0D`,
  cells `#191F1F`). One accent: spruce (`#2F5D4A` light fill, `#42755F` dark fill; text `#2B5745` / `#9ACBB4`).
  Success reuses the accent, running low is a muted amber, errors a muted brick red, sync and offline states are
  neutral. Category colours are 12 near-monochrome tints of equal lightness, used only on icon tiles.
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
2. Accent colour is spruce green (hue 165, deep and low-chroma), the only saturated colour in the interface (`01` §2).
3. Titles use Schibsted Grotesk; quantities use SF Pro tabular figures (`01` §3). This replaced the New York serif
   and SF Pro Rounded at the owner's request (November 2026 restyle, `01` §11.6).
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
17. The `theme-color` values are `#F2F4F4` (light) and `#090D0D` (dark), the grouped canvas of each theme; the
    manifest uses `#F2F4F4`.
18. Neutrals are cool (hue 200) rather than warm, and category tiles are near-monochrome tints, so lists read calm
    and premium (`01` §2.1, §6.1). Ramp and semantic token names were kept, so no component changed.

## Notes for the architecture thread

- `03` §5 lists data-model additions the screens need: a `grocery_entries` table; `products.usual_qty` and
  `products.min_qty` (with `stock.min_quantity` unused in v1); single-use 8-character invite codes with a pre-auth
  `peek_invite(code)` RPC; per-device notification preferences on `push_subscriptions`; `delete_account` and
  household-deletion RPCs; overwritten-field records in `change_log`; movement kinds (purchase, consume, recount,
  transfer) and a `source` field.
- Lucide 1.x renamed several icons (`trash-2` → `trash`, `circle-alert` → `circle-exclamation-point`,
  `triangle-alert` → `triangle-exclamation-point`, `circle-help` → `circle-question-mark`, `history` →
  `rotate-ccw-clock`). Pin the `lucide-react` version and check names against it.

## Verification status (2026-11-10): shipped without a real-phone pass

The owner chose to ship the design without waiting for a real iPhone. What could be checked was checked locally:
Safari in the iOS 26.3 simulator (iPhone 16e, 390 px wide, like the iPhone 13/14), Tailwind CSS 4.3.5 and
Motion 14.12.0 installed in a scratch folder outside the project.

**Verified**

| Question | Result | Change made |
|---|---|---|
| Does Safari already apply SF's size-specific tracking? | Yes, for `-apple-system`, `ui-rounded` and `ui-serif`; explicit `letter-spacing` is added on top. | SF Pro `--text-*--letter-spacing` tokens set to `normal`; the display-font roles (restyle) carry explicit tracking (`tokens.css`, `01` §3.2). |
| Do `ui-serif` and `ui-rounded` resolve, and do tabular figures work? | Yes (New York and SF Pro Rounded; "11111" = "00000" in width with `tabular-nums`). Both were later replaced (restyle). | Note in `01` §3.1. |
| Restyle: does Schibsted Grotesk (Google Fonts latin subset) render French and keep `tnum`? | Yes in Safari 26.3: é è ê à ç œ « » ’ render; "11111" = "00000" in width. Albert Sans has no `tnum`. | `01` §3.1. |
| Does `font: -apple-system-body` follow Dynamic Type? | Yes in Safari: 17 px at default, 28 px at Accessibility Medium. | Note in `01` §3.3. |
| `prefers-contrast: more`, `prefers-reduced-transparency` | Both parsed by Safari 26.3; contrast matches when Increase Contrast is on. | Notes in `01` §2.5 and `tokens.css`; the manual transparency hook stays for older iOS. |
| `corner-shape: squircle` | Not supported in Safari 26.3. | Plain `border-radius` ships (`01` §4.4). |
| French formats | Plural of 0 is "one"; dates "samedi 14 nov."; prices "1,89 €"; `RelativeTimeFormat` `short` gives "dans 4 j", while `narrow` gives "+4 j". | `01` §3.4 now uses `short`. |
| `<input type="checkbox" switch>` | Renders as a native switch; `label.click()` from a timer toggles it without user activation (the haptic itself cannot be felt in a simulator). | None. |
| Does `tokens.css` compile in Tailwind v4, including `@theme static` and `@theme inline`? | Yes, with no warnings; every sampled utility is generated (colours, categories, type roles, radii, shadows, fonts). | None. |
| Do the derived spring physics match Motion? | Yes, within 0.11 % of travel for all seven presets. | `02` §10. |

**Shipping with defaults (needs a real iPhone; the simulator has no haptics, camera or Home Screen gestures)**

1. Scan-success haptic: off (`scanHaptic` false); scan success is visual, with an optional «Son au scan», off by default (`02` §5–6).
2. Drag-threshold haptic: fires at `pointerup` on commit (`hapticAtCrossing` false) (`02` §5.3).
3. Long-press to withdraw: the camera starts on finger lift. If it does not start, the cover shows a «Démarrer» button (`03` §8).
4. Custom left-edge swipe back: on, in the installed app only (`02` §3.6).
5. Pull to refresh: dropped if overscroll cannot be read in the installed app; the sync indicator stays tappable (`02` §10).
6. Motion is designed for 60 Hz, and 120 Hz is a bonus.
7. Install-guide labels follow the iOS 26 wording in `03` §4.1. The labels need checking once on a phone.
8. Status bar and Dynamic Island clearance use `env(safe-area-inset-top)`; the tab bar offset (`--tab-bar-bottom`) is tuned on device.

**Product questions for later:** one household per account in v1, and members cannot invite (owner only) (`03` §8).
