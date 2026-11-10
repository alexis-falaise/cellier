# 01 — Cellier design system

Status: binding for implementation. Companion files: `tokens.css` (the code form of every token named here),
`02-motion-haptics.md` (springs, gestures, haptics) and the screens document. Shared foundations come from
the shared design brief (merged into `README.md`). Wherever this file departs from the brief, the departure is listed in section 11.

Legend: **UNVERIFIED** marks a platform behaviour that was not confirmed in this session. Test it on a real
iPhone before relying on it.

Mood: a cool, quiet stone cellar with good light. Warm limestone neutrals, one deep bottle-green accent,
editorial serif titles, rounded numerals for counts.

---

## 1. Principles

1. **One green.** Bottle green marks only the things you can act on or have just done: the primary action,
   the scan button, selection, links, progress and success. In practice, a screen whose green elements were
   all removed should leave you unable to act, and a screen with green on decoration is a bug.
2. **The list is the product.** Most of the time is spent scanning inset grouped lists, so rows get the craft
   budget: exact heights, tabular rounded numerals, hairline separators and no card shadows. Category colour
   appears only as a 36 px tile and a dot. It never colours text or large areas.
3. **Counts feel physical.** Quantities use the rounded face and tabular figures, and they are the only
   text that animates (the `pop` spring). Every other piece of text changes instantly.
4. **Quiet by default, loud only for state.** Amber says "running low" and brick says "something went wrong".
   Offline and pending sync use neutral grey, because waiting is not an error.
5. **Editorial, not decorative.** New York appears only at 28 px and above (screen titles, the item name on
   its detail page, onboarding). That single serif move is what makes Cellier look like a wine label rather
   than a template. Cellier has no illustrations, gradients or emoji.
6. **The system's settings are the user's settings.** Light and dark mode, Dynamic Type, Increase Contrast,
   Reduce Transparency and Reduce Motion all change the tokens. Components never handle these cases themselves.
7. **Every number can be defended.** Each spacing, radius, colour and size below has a one-line reason.
   A value that is not in this file is not part of the design.

---

## 2. Colour

### 2.1 Approach

- Tokens are authored in OKLCH, so a step in lightness looks like the same step for every hue. Each value
  is listed with its sRGB hex. iOS 16.4 Safari supports `oklch()` natively, so hex is used only where a
  platform needs it (`theme-color`, the manifest, splash screens).
- Every value below was computed from OKLCH to sRGB to WCAG relative luminance by a throwaway script, and every
  pair in 2.6 was recomputed after the final adjustments.
- Neutrals are warm stone at hue 80 with chroma 0.0015 to 0.01. That is enough warmth to read as limestone
  without turning into cream.
- Text colours are opaque. Apple's labels are translucent, but an opaque label has one exact contrast ratio
  per background, so AA can be guaranteed. Fills, separators, materials and the scrim stay translucent
  because they have to sit on any surface.

### 2.2 Ramps

**Stone (neutral).**

| Token | OKLCH | Hex | Main use |
|---|---|---|---|
| `stone-0` | `oklch(0.995 0.0015 80)` | `#FEFDFC` | Light cells (`surface`), `on-accent` |
| `stone-25` | `oklch(0.982 0.003 80)` | `#FAF9F7` | Light plain background, material tint |
| `stone-50` | `oklch(0.968 0.0045 80)` | `#F6F4F1` | Light grouped canvas, `theme-color` light |
| `stone-100` | `oklch(0.944 0.006 80)` | `#EFECE8` | Spare |
| `stone-150` | `oklch(0.918 0.007 80)` | `#E6E3DF` | Spare |
| `stone-200` | `oklch(0.885 0.008 80)` | `#DCD9D3` | Opaque separator (light) |
| `stone-300` | `oklch(0.81 0.009 80)` | `#C4C0BB` | Dark label-secondary (increased contrast) |
| `stone-350` | `oklch(0.745 0.0095 80)` | `#AFACA6` | Dark label-secondary |
| `stone-400` | `oklch(0.7 0.01 80)` | `#A29E98` | Light label-quaternary (disabled) |
| `stone-450` | `oklch(0.66 0.01 80)` | `#95928B` | Dark label-tertiary |
| `stone-500` | `oklch(0.595 0.01 80)` | `#827E78` | Edges with increased contrast |
| `stone-550` | `oklch(0.535 0.01 80)` | `#706D67` | Light label-tertiary |
| `stone-600` | `oklch(0.48 0.01 80)` | `#615D57` | Light label-secondary, dark label-quaternary |
| `stone-700` | `oklch(0.415 0.009 80)` | `#4E4B46` | Light label-secondary (increased contrast) |
| `stone-800` | `oklch(0.33 0.008 80)` | `#383531` | Opaque separator (dark) |
| `stone-850` | `oklch(0.285 0.007 80)` | `#2C2A26` | Dark cells inside sheets |
| `stone-900` | `oklch(0.245 0.006 80)` | `#22201D` | Dark cells (`surface`) |
| `stone-925` | `oklch(0.215 0.0055 80)` | `#1B1917` | Dark sheet canvas, dark material tint |
| `stone-950` | `oklch(0.185 0.005 80)` | `#141210` | Light label-primary |
| `stone-975` | `oklch(0.165 0.0045 80)` | `#0F0E0C` | Dark canvas, `theme-color` dark |
| `stone-990` | `oklch(0.13 0.004 80)` | `#080706` | Light label-primary (increased contrast) |
| `black` | `oklch(0 0 0)` | `#000000` | The scanner only |

**Bottle green (accent).**

| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `green-50` | `oklch(0.962 0.022 160)` | `#E7F7ED` | Light `accent-tint` (selected background) |
| `green-100` | `oklch(0.93 0.04 160)` | `#D2F1DF` | Spare |
| `green-300` | `oklch(0.8 0.1 160)` | `#82D2A8` | Dark `accent-fg`, dark focus ring |
| `green-400` | `oklch(0.72 0.115 160)` | `#5BBB8C` | Spare |
| `green-500` | `oklch(0.6 0.11 160)` | `#389469` | Spare |
| `green-550` | `oklch(0.545 0.1 160)` | `#30825C` | Dark `accent` (fill) |
| `green-600` | `oklch(0.49 0.09 160)` | `#28704E` | Light `accent` (fill), dark `accent-pressed` |
| `green-650` | `oklch(0.455 0.085 160)` | `#226546` | Light `accent-fg`, light focus ring |
| `green-700` | `oklch(0.41 0.075 160)` | `#1D573C` | Light `accent-pressed`, accent with increased contrast |
| `green-800` | `oklch(0.33 0.055 160)` | `#183E2B` | Pressed with increased contrast |
| `green-900` | `oklch(0.27 0.04 160)` | `#132C20` | Spare |
| `green-950` | `oklch(0.235 0.03 160)` | `#112219` | Dark `accent-tint` |

The light fill (`green-600`) is a little brighter than the light text green (`green-650`). A large filled
shape reads darker than the same colour in thin text, so the two values look like the same green in use.
In dark mode the accent is lifted (`green-550` fill, `green-300` text) so it glows slightly against near-black
instead of sinking into it.

**States: accent pressed and disabled.** Pressed means `accent-pressed`, together with the `press` spring
scale defined in 02. Disabled means the button's fill becomes `fill-secondary` and its label becomes
`label-quaternary`. A disabled button is never a faded green, because a faded green would still look like
something you can act on.

**Amber (warning, running low) and brick (danger).**

| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `amber-100` | `oklch(0.945 0.045 82)` | `#FCEBCC` | Light `warning-tint` |
| `amber-300` | `oklch(0.84 0.12 80)` | `#F4C26A` | Dark `warning-fg` |
| `amber-600` | `oklch(0.525 0.11 68)` | `#935C0F` | Light `warning-fg` |
| `amber-700` | `oklch(0.47 0.1 66)` | `#804E0B` | Light `warning-fg` with increased contrast |
| `amber-900` | `oklch(0.29 0.05 75)` | `#3A270B` | Dark `warning-tint` |
| `brick-100` | `oklch(0.94 0.03 30)` | `#FFE4DF` | Light `danger-tint` |
| `brick-300` | `oklch(0.76 0.12 28)` | `#F49286` | Dark `danger-fg` |
| `brick-500` | `oklch(0.58 0.16 30)` | `#C74C3D` | Dark `danger` (fill) |
| `brick-600` | `oklch(0.51 0.15 31)` | `#AB3B2B` | Light `danger` and `danger-fg`, dark `danger-pressed` |
| `brick-700` | `oklch(0.45 0.135 31)` | `#912F21` | Light `danger-pressed`, danger with increased contrast |
| `brick-900` | `oklch(0.29 0.06 28)` | `#451E1A` | Dark `danger-tint` |

Semantic mapping: **success reuses the accent** (`success-fg = accent-fg`, `success-tint = accent-tint`),
so the app has exactly one green. **Info and neutral** use `label-secondary` on `fill-tertiary`. Offline and
pending sync are neutral as well.

### 2.3 Semantic layer

Components use only these names. The ramps are private to `tokens.css`.

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | stone-25 `#FAF9F7` | stone-975 `#0F0E0C` | Plain (non-grouped) screens |
| `bg-grouped` | stone-50 `#F6F4F1` | stone-975 `#0F0E0C` | Canvas behind inset groups (Accueil, Stock, Courses) |
| `bg-elevated` | stone-50 `#F6F4F1` | stone-925 `#1B1917` | Sheet canvas |
| `surface` | stone-0 `#FEFDFC` | stone-900 `#22201D` | Cells and cards in a group |
| `surface-elevated` | stone-0 `#FEFDFC` | stone-850 `#2C2A26` | Cells inside a sheet |
| `label-primary` | stone-950 `#141210` | stone-50 `#F6F4F1` | Titles, row names, values |
| `label-secondary` | stone-600 `#615D57` | stone-350 `#AFACA6` | Subtitles, inactive tab items, section headers |
| `label-tertiary` | stone-550 `#706D67` | stone-450 `#95928B` | Placeholders, units, timestamps, chevrons |
| `label-quaternary` | stone-400 `#A29E98` | stone-600 `#615D57` | Disabled text only (exempt from contrast) |
| `fill-primary` | `oklch(0.55 0.012 80 / 0.2)` | `/ 0.32` | Stepper buttons, the switch track if custom |
| `fill-secondary` | `/ 0.16` | `/ 0.26` | Secondary buttons, disabled fills |
| `fill-tertiary` | `/ 0.12` | `/ 0.2` | Search field, segmented control track, info tint |
| `fill-quaternary` | `/ 0.07` | `/ 0.14` | Pressed row highlight |
| `separator` | `oklch(0.33 0.008 80 / 0.17)` ≈ `#DCDBDA` on a cell | `oklch(0.85 0.006 80 / 0.15)` ≈ `#3C3A37` | Hairline between rows (0.5 px) |
| `separator-opaque` | stone-200 `#DCD9D3` | stone-800 `#383531` | Separators over material |
| `edge` | transparent | transparent | Cell and control outline. Becomes stone-500 with Increase Contrast |
| `accent` | green-600 `#28704E` | green-550 `#30825C` | Filled primary button, scan button, progress |
| `accent-pressed` | green-700 `#1D573C` | green-600 `#28704E` | Pressed fill |
| `accent-fg` | green-650 `#226546` | green-300 `#82D2A8` | Links, text buttons, checkmarks, the active tab |
| `accent-tint` | green-50 `#E7F7ED` | green-950 `#112219` | Selected row, selected chip |
| `on-accent` | stone-0 `#FEFDFC` | stone-0 `#FEFDFC` | Text and glyph on `accent` and `danger` |
| `focus-ring` | green-650 | green-300 | Keyboard focus outline |
| `warning-fg` / `warning-tint` | amber-600 / amber-100 | amber-300 / amber-900 | "Bientôt épuisé", running-low badge |
| `danger` / `danger-pressed` | brick-600 / brick-700 | brick-500 / brick-600 | Destructive filled button |
| `danger-fg` / `danger-tint` | brick-600 / brick-100 | brick-300 / brick-900 | Error text, error banner |
| `material` | `oklch(0.982 0.003 80 / 0.86)` + `blur(20px) saturate(180%)` | `oklch(0.215 0.0055 80 / 0.86)` + same | Tab bar, scrolled nav bar, toasts |
| `scrim` | `oklch(0.185 0.005 80 / 0.3)` | `oklch(0 0 0 / 0.55)` | Behind sheets and menus |
| `scanner-bg` / `scanner-material` | `#000` / `oklch(0.215 0.0055 80 / 0.72)` | same | The scanner is always dark |

`theme-color` metas: light `#F6F4F1`, dark `#0F0E0C`. These replace the provisional `#F7F5F0` / `#121210`
in `research/21`. The manifest `theme_color` and `background_color` use `#F6F4F1`.

### 2.4 Materials

The material is used on exactly three surfaces: the floating tab bar capsule, the navigation bar once
content scrolls under it, and toasts. Sheets are opaque (`bg-elevated`), because a translucent sheet over a
busy list hurts legibility and stacking blur on iPhone costs frame time. The material is 86 % opaque. This
value was chosen so that `label-secondary` still passes 4.5:1 even if pure white or pure black sits behind
it (see 2.6). Apple tunes vibrancy by eye; Cellier needs a provable floor. In dark mode, floating elements
add a 0.5 px inner top highlight (`inset 0 0.5px 0 oklch(1 0 0 / 0.08)`) so their edge catches the light.

### 2.5 Increased contrast and reduced transparency

- `prefers-contrast: more` (iOS Increase Contrast). Light labels move one or two steps darker (primary becomes
  stone-990, secondary stone-700, tertiary stone-600). The accent goes to green-700, warning to amber-700 and
  danger to brick-700. Fills get stronger, `separator` becomes opaque stone-500 at 1 px, and `edge` shows a
  1 px stone-500 outline on cells, fields and buttons (3.97:1 on a light cell and 4.03:1 on a dark one, which
  passes the 3:1 non-text rule). Materials become solid. In dark mode, labels go lighter (stone-0, stone-300,
  stone-350). The accent fill stays green-550, because green-650 would drop to 2.77:1 against the canvas.
  Verified in the iOS 26.3 simulator: Safari parses the query and it matches when Increase Contrast is on.
- `prefers-reduced-transparency: reduce`. `--material-alpha` becomes 1 and `--material-filter` becomes
  `none`. Only these two variables change, so the rule works with every theme. `research/20` reported that
  Safari does not support this media query; the iOS 26.3 simulator shows Safari now parses it, so it works on
  current iOS. Older iOS versions may not support it. The manual hook `html[data-transparency="reduced"]` is therefore
  provided as well. A "Réduire la transparence" switch in Réglages is optional and not required for v1.
- Manual theme: `html[data-theme="light" | "dark"]` overrides the system setting. With no attribute, the
  system setting applies.

### 2.6 Contrast table

Ratios are WCAG 2.x, computed from the exact sRGB values. Translucent tokens were composited onto their real
background first. "Worst of 3 bases" means the lowest ratio over `surface`, `bg-grouped` and `surface-elevated`.
All pairs pass.

| Pair | Where | Light | Dark | Needed | Result |
|---|---|---|---|---|---|
| `label-primary` on `bg-grouped` | Large titles, section text | 16.99 | 17.56 | 4.5 | Pass |
| `label-primary` on `surface` | Row titles | 18.38 | 14.79 | 4.5 | Pass |
| `label-primary` on `surface-elevated` | Rows in sheets | 18.38 | 13.09 | 4.5 | Pass |
| `label-secondary` on `bg-grouped` | Section headers and footers | 5.96 | 8.50 | 4.5 | Pass |
| `label-secondary` on `surface` | Row subtitles | 6.45 | 7.16 | 4.5 | Pass |
| `label-secondary` on `surface-elevated` | Subtitles in sheets | 6.45 | 6.34 | 4.5 | Pass |
| `label-tertiary` on `surface` | Placeholders, units, chevrons | 5.10 | 5.21 | 4.5 | Pass |
| `label-tertiary` on `surface-elevated` | Placeholders in sheets | 5.10 | 4.61 | 4.5 | Pass |
| `label-tertiary` on `bg-grouped` | Meta on canvas | 4.71 | 6.19 | 4.5 | Pass |
| `accent-fg` on `bg-grouped` | Links, text buttons | 6.35 | 10.75 | 4.5 | Pass |
| `accent-fg` on `surface` | Checkmarks, selected values | 6.87 | 9.05 | 4.5 | Pass |
| `accent-fg` on `surface-elevated` | Sheet toolbar buttons | 6.87 | 8.01 | 4.5 | Pass |
| `on-accent` on `accent` | Primary button label, scan glyph | 5.89 | 4.65 | 4.5 | Pass |
| `on-accent` on `accent-pressed` | Same, pressed | 8.38 | 5.89 | 4.5 | Pass |
| `accent-fg` on `accent-tint` | Selected chip text | 6.29 | 9.21 | 4.5 | Pass |
| `label-primary` on `accent-tint` | Text on a selected row | 16.83 | 15.05 | 4.5 | Pass |
| `accent` on `bg-grouped` | Button and scan button boundary | 5.45 | 4.09 | 3 | Pass |
| `focus-ring` on `bg-grouped` | Focus outline | 6.35 | 10.75 | 3 | Pass |
| `warning-fg` on `surface` | "Bientôt épuisé" text and icon | 5.46 | 9.84 | 4.5 | Pass |
| `warning-fg` on `warning-tint` | Running-low badge | 4.71 | 8.61 | 4.5 | Pass |
| `danger-fg` on `surface` | Destructive text, errors | 6.10 | 7.20 | 4.5 | Pass |
| `danger-fg` on `danger-tint` | Error banner | 5.14 | 6.41 | 4.5 | Pass |
| `on-accent` on `danger` | Destructive filled button | 6.10 | 4.56 | 4.5 | Pass |
| `label-primary` on `fill-primary` (worst of 3 bases) | Stepper, segmented label | 13.35 | 9.33 | 4.5 | Pass |
| `label-secondary` on `fill-primary` (worst of 3 bases) | Search placeholder on strongest fill | 4.68 | 4.52 | 4.5 | Pass |
| `label-secondary` on `fill-tertiary` (worst of 3 bases) | Search field placeholder | 5.17 | 5.15 | 4.5 | Pass |
| `accent-fg` on `fill-primary` (worst of 3 bases) | Accent glyph on a fill button | 4.99 | 5.71 | 4.5 | Pass |
| `label-primary` on `material` (pure white or black behind) | Tab labels, nav title | 12.84 | 10.45 | 4.5 | Pass |
| `label-secondary` on `material` (pure white or black behind) | Inactive tabs | 4.51 | 5.06 | 4.5 | Pass |
| `accent-fg` on `material` (pure white or black behind) | Active tab | 4.80 | 6.39 | 4.5 | Pass |
| Category glyph on its tile (12 hues) | Category tiles | 4.47 to 4.81 | 7.43 to 7.63 | 3 | Pass |
| White on `black` / `green-300` on `black` | Scanner text, scanner accent | 21.0 / 11.71 | same | 4.5 | Pass |
| `label-quaternary` on `surface` | Disabled text (exempt) | 2.63 | 2.48 | none | Exempt |

Pairs checked with increased contrast (light / dark): label-secondary on bg-grouped 7.88 / 10.67;
label-tertiary on surface 6.45 / 7.16; accent-fg on surface 8.38 / 9.05; warning-fg on surface 6.91 / 9.84;
danger-fg on surface 7.84 / 7.20; on-accent on accent 8.38 / 4.65; warning-fg on warning-tint 5.96 (light);
`edge` on surface 3.97 / 4.03. All pass.

Rules that keep the table true:

- Text on a material is only `label-primary`, `label-secondary` or `accent-fg`.
- `label-quaternary` never carries information. Use it for disabled controls only.
- Text on fills is `label-primary`. `label-secondary` is allowed on any fill (worst case 4.52), but `label-tertiary` is not.
- Category colours never colour text.

---

## 3. Typography

### 3.1 Families

| Token | Stack | Used for | Why |
|---|---|---|---|
| `font-sans` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | All UI text | SF Pro on iOS: optical sizes and native metrics, no licence, no download. Off Apple devices it falls back to each platform's UI font. |
| `font-serif-display` | `ui-serif, "New York", Georgia, "Noto Serif", "Times New Roman", serif` | `display`, `large-title`, `title-1` only (28 px and above) | New York gives a wine-label, editorial tone that no template has. It is free and part of the system. Georgia (Windows, macOS) and Noto Serif (Android) are close substitutes elsewhere. |
| `font-rounded` | `ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, system-ui, sans-serif` | Quantities, stepper, badges, "dans 4 j" | Counting objects should feel tactile. Rounded is used only for numerals and short count labels. |
| `font-mono` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | The GTIN on item detail, debug only | Barcode digits must not be mistaken for a quantity. |

Every numeric role sets `font-variant-numeric: tabular-nums`, so steppers and right-aligned columns do not jitter.
`ui-serif` and `ui-rounded` resolve to New York and SF Pro Rounded in Safari (verified in the iOS 26.3 simulator:
both measure differently from the sans and from Georgia, and `tabular-nums` makes "11111" and "00000" the same
width in `ui-rounded`). If they are missing on another platform, the stack falls back to the regular sans, which is acceptable. No web font is loaded: the app
downloads zero font bytes.

### 3.2 Type scale

Sizes are the iOS Dynamic Type "Large" defaults (`research/20`). Tracking comes from Apple's SF Pro table,
converted to em so it scales with the size. "Serif" means `font-serif-display` and "Rnd" means
`font-rounded` + tabular. The utility `type-<role>` sets family, size, leading, tracking and weight together.

| Role | Size / leading (px) | rem | Weight | Tracking | Family | Use |
|---|---|---|---|---|---|---|
| `display` | 40 / 46 | 2.5 | 600 | −0.015em | Serif | "Cellier" wordmark, onboarding headline |
| `large-title` | 34 / 41 | 2.125 | 600 | −0.01em | Serif | Collapsing screen titles, pantry name |
| `title-1` | 28 / 34 | 1.75 | 600 | −0.005em | Serif | Item name on item detail, sheet hero title |
| `title-2` | 22 / 28 | 1.375 | 600 | −0.0118em (−0.26 pt) | Sans | Rare: an empty-state title in a full screen |
| `title-3` | 20 / 25 | 1.25 | 600 | −0.0225em (−0.45 pt) | Sans | Home section titles ("Bientôt épuisé", "Prochaines courses") |
| `headline` | 17 / 22 | 1.0625 | 600 | −0.0253em (−0.43 pt) | Sans | Compact nav title, emphasised row title, button labels |
| `body` | 17 / 22 | 1.0625 | 400 | −0.0253em | Sans | Row titles, fields, paragraphs |
| `callout` | 16 / 21 | 1 | 400 | −0.0194em (−0.31 pt) | Sans | Toast text, banner text |
| `subhead` | 15 / 20 | 0.9375 | 400 | −0.0153em (−0.23 pt) | Sans | Row subtitles, segmented labels, search text |
| `footnote` | 13 / 18 | 0.8125 | 400 | −0.0062em (−0.08 pt) | Sans | Section headers and footers, metadata |
| `caption-1` | 12 / 16 | 0.75 | 400 | 0 | Sans | Photo credit (Open Food Facts), hints |
| `caption-2` | 11 / 13 | 0.6875 | 400 | +0.0055em (+0.06 pt) | Sans | Smallest allowed text |
| `tab-label` | 10 / 12 | 0.625 | 500 | +0.012em (+0.12 pt) | Sans | Tab bar labels (iOS uses 10 pt medium) |
| `quantity-xl` | 48 / 52 | 3 | 600 | 0 | Rnd | Stepper value in the scanner tray and quantity sheet |
| `quantity-l` | 34 / 41 | 2.125 | 600 | 0 | Rnd | Stock count on item detail |
| `quantity` | 17 / 22 | 1.0625 | 600 | 0 | Rnd | Trailing count in item rows |
| `badge` | 13 / 16 | 0.8125 | 600 | 0 | Rnd | "dans 4 j", "× 3", counts in pills |
| `badge-s` | 11 / 13 | 0.6875 | 700 | +0.01em | Rnd | Tab badge, tray counter |

Decisions:

- Titles use weight 600 instead of Apple's Regular. The serif needs the weight to hold up at 34 px, and the
  sans titles match it so the hierarchy stays consistent.
- **Tracking is left to the system (verified).** In the iOS 26.3 simulator, `-apple-system`, `ui-rounded` and
  `ui-serif` text gets wider per em as the size drops (about +4 at 11 px down to +0.8 at 34 px, in thousandths of
  an em per character, against 0 for Helvetica at every size). So WebKit already applies the fonts' size-specific
  tracking and optical sizes, and an explicit `letter-spacing` is added on top (−1 px gave exactly −1 px per
  character). Every `--text-*--letter-spacing` token is therefore `normal`, and the Apple tracking values in the
  table above are for reference only. Do not add letter-spacing to system-font text.
- Headings use `text-wrap: balance` and paragraphs use `text-wrap: pretty`.
- Product names are clamped to two lines in rows (`line-clamp: 2`) and never truncated on item detail.

### 3.3 Dynamic Type and text size on the web

- `html` keeps `font-size: 100%` (1rem = 16px). This respects a browser's own default text size off iOS and
  keeps `--spacing: 0.25rem` at exactly 4 px.
- On iOS, the app measures the Dynamic Type body size once at boot and again on `visibilitychange`:
  render a hidden probe `<span style="font: -apple-system-body">`, read its computed `font-size` (17px at the
  default "Large" setting), and set `document.documentElement.style.setProperty('--dt', String(Math.max(1, px / 17)))`.
  Every `--text-*` token multiplies by `--dt` with a per-role factor (0.5 for large titles up to 1.56 for
  caption 2). This reproduces Apple's non-linear tables: at xxxLarge, body goes from 17 to 23 and large title
  from 34 to 40, both matching Apple's values.
- Only type scales. Spacing, radii and icon tiles stay fixed, as on iOS, where margins do not grow with text.
  Rows have a min-height instead of a fixed height, so they grow with their text. At `--dt ≥ 1.35`, item rows
  switch to a stacked layout with the quantity under the name (see 4.3).
- `--dt` is never below 1. Apple's smaller sizes only remove 1 to 3 pt, and shrinking a pantry list below
  17 px helps nobody.
- `-webkit-text-size-adjust: 100%` goes on `html` (in the app CSS) so iOS never inflates text on its own.
- Known risk: the `-apple-system-body` keyword is a Safari behaviour reported to reflect Dynamic Type
  (SECONDARY, `research/20`). Verified in Safari in the iOS 26.3 simulator: `font: -apple-system-body` computes to
  17 px at the default size and 28 px at Accessibility Medium (Headline 28 px, Caption 1 22 px), matching Apple's
  tables. The Home Screen web app uses the same engine but was not tested separately.
  If the probe always returns 17, the app still works at the default size. A "Taille du texte" setting can
  then write `--dt` instead (not in v1).
- Input font size is never below 16px, so iOS does not zoom on focus. Fields use `body` (17px).

### 3.4 French typography

- Spaces. Insert a narrow no-break space (U+202F) before `;`, `!`, `?` and inside guillemets (« Cellier »).
  Insert a no-break space (U+00A0) before `:`, before `%` when it is not produced by Intl, between a number and
  its unit, and between a day number and its month. Put these in the `fr.ts` strings as escapes, never as
  plain spaces.
- Numbers: `new Intl.NumberFormat('fr-FR')` gives "1 234,5", with U+202F as the group separator. Prices use
  `{ style: 'currency', currency: 'EUR' }` and give "2,49 €" with a no-break space. Percentages use
  `{ style: 'percent' }`. Never format by hand.
- Units: SI symbols with a no-break space: "500 g", "1,5 L" (capital L so it is not read as the digit 1),
  "75 cl", "2 kg". A pack size is written "6 × 1,5 L", with the real multiplication sign U+00D7. The unit
  stays in `label-tertiary` next to a `quantity` numeral.
- Dates: `new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })` gives
  "jeudi 14 nov.". Relative dates use `new Intl.RelativeTimeFormat('fr', { numeric: 'auto', style: 'short' })`,
  which gives "demain", "dans 4 j", "dans 2 sem.", "il y a 3 j" (verified in Safari 26.3). Do not use
  `style: 'narrow'`: it gives "+4 j". Durations such as "≈ 4 j" use
  `Intl.NumberFormat('fr-FR', { style: 'unit', unit: 'day', unitDisplay: 'short' })` → "4 j" (narrow gives "4j").
  Numbers group thousands with U+202F (narrow no-break space) and prices read "1,89 €" with U+00A0.
- Plurals: `new Intl.PluralRules('fr')`. Note that in French, 0 and 1 are both singular ("0 bouteille").
- Sorting and search: `Intl.Collator('fr', { sensitivity: 'base' })`, so "Épicerie" sorts with E.
- Ordinals: "1er", "2e". Quotes: « ». Apostrophe: ’ (U+2019).

---

## 4. Space, layout and shape

### 4.1 Spacing

Spacing uses a 4 px base (`--spacing: 0.25rem`), so Tailwind `p-1` = 4 px. Layout uses the 8 px steps.
4 px is reserved for icon-to-text gaps and optical nudges.

| Name | px | Tailwind | Use |
|---|---|---|---|
| hair | 2 | `0.5` | Badge inner vertical padding |
| xs | 4 | `1` | Icon to label in a badge, tab icon to tab label |
| s | 8 | `2` | Min row vertical padding, gap between chips |
| m | 12 | `3` | Category tile to text, stepper button gap |
| l | 16 | `4` | Screen margin (`--margin`), row horizontal padding |
| xl | 24 | `6` | Gap from large title to the first group |
| 2xl | 32 | `8` | Gap between inset groups |
| 3xl | 48 | `12` | Empty-state block spacing |

### 4.2 Layout grid (390 to 430 px wide)

- One column, with a 16px side margin at every width (from the brief). Content width is 358px on the iPhone 13
  (390), 361px on the 14 Pro and 15 Pro (393), and 398px on the Pro Max (430). Extra width becomes longer
  names, never a second column.
- The vertical structure, from the top: `--safe-top`, then the nav bar row (44px: pantry/back on the left,
  avatar on the right), then the large title row (52px, collapses into the nav bar on scroll), then 24px,
  then the groups (32px apart), then `--content-bottom` (tab bar + offset + 16px) so the last row clears the
  floating tab bar.
- Group header: `footnote` in `label-secondary`, 16px from the group's left edge, 8px above the group.
  It is not uppercase (iOS 16+ grouped style) and has no eyebrow labels.

### 4.3 List row anatomy

Inset group: `surface` background, `rounded-md` (14), 16px side margin, no shadow, no border (`edge` with
increased contrast).

| Row | Min height | Leading | Text | Trailing | Separator inset |
|---|---|---|---|---|---|
| Settings row | 52px | Optional 28px tile (`rounded-xs`, 17px glyph), 12px gap | `body` | Value in `body` `label-secondary` + `chevron-right` 17px `label-tertiary` | From the text start (16 + 28 + 12 = 56px, or 16px without a tile) |
| Item row | 60px | 36px category tile, `rounded-sm` (10), 20px glyph, 12px gap | Name `body` `label-primary` (2 lines max); subtitle `subhead` `label-secondary` (size · pantry or "dans 4 j") | Count `quantity` + unit `footnote` `label-tertiary`; optional amber `trending-down` 17px before the count | 64px (16 + 36 + 12) |
| Course row (Courses) | 60px | 22px circular check target (44px hit area) + 12px gap, then a 36px tile | `body` / `subhead` | Suggested quantity `badge` on `fill-tertiary`, `rounded-xs` | 108px |

- Padding: 16px horizontal, at least 12px vertical on item rows (36 + 24 = 60) and at least 8px on settings rows.
- Separator: `--hairline` (0.5px) in `separator`, inset as above, and never under the last row.
- Pressed state: the row background becomes `fill-quaternary` instantly on pointer-down, with no delay.
- Selected (in pickers): an `accent-fg` `check` on the trailing side. In multi-select, the background is
  `accent-tint`.
- Large text (`--dt ≥ 1.35`): the tile stays 36px and aligns to the top. The count moves under the subtitle
  and the row grows.
- Rows show the category tile, never the product photo. Open Food Facts photos vary wildly in framing and
  background, and forty of them stacked would look like a flea market. Photos appear on item detail and in
  the scanner tray.

### 4.4 Radii

Radii are concentric: an inner radius equals the outer radius minus the padding between them.

| Token | px | Where |
|---|---|---|
| `rounded-xs` | 6 | Badges, chips, 28px settings tiles, keyboard focus ring on small items |
| `rounded-sm` | 10 | Text fields, search field, small buttons, 36px category tile, 44px tray thumbnail |
| `rounded-md` | 14 | Inset grouped lists, 50px primary buttons, toasts, segmented control track |
| `rounded-lg` | 20 | Home cards (the "Prochaines courses" summary), product photo frame on item detail |
| `rounded-xl` | 28 | Sheet top corners, scanner tray |
| `rounded-full` | full | Scan button, tab bar capsule, avatar, stepper buttons, dots, segmented thumb |

`corner-shape: squircle` may be added inside `@supports (corner-shape: squircle)` as progressive
enhancement. Safari 26.3 does not support it (verified), so plain `border-radius` is what ships.

### 4.5 Elevation

| Level | What | Background | Blur | Shadow (light) | Shadow (dark) |
|---|---|---|---|---|---|
| 0 | Canvas, groups, cells | `bg-grouped` / `surface` | none | none | none |
| 1 | Nav bar after scroll | `material` | 20px, saturate 180% | none, `separator-opaque` hairline at the bottom | same |
| 2 | Tab bar capsule, toasts | `material` | 20px, saturate 180% | `shadow-float` | `shadow-float` (black + top highlight) |
| 2 | Scan button | `accent` | none | `shadow-accent` (green-tinted) | `shadow-accent` (black) |
| 3 | Sheets | `bg-elevated` (opaque) | none | `shadow-sheet` | `shadow-sheet` |
| 3 | Menus (pantry menu, context menu) | `surface-elevated` | none | `shadow-menu` | `shadow-menu` |

The segmented control thumb uses `surface` + `shadow-thumb`. Exact shadow values are in `tokens.css`. Light
shadows are tinted toward the stone hue, never pure black. Cards in lists never cast a shadow (from the brief).
At most two blurred layers may be on screen at once (tab bar and nav bar). Toasts appear only when one of
them is hidden, or accept the cost briefly.

### 4.6 Safe areas and the iOS shell

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. Do not add
  `maximum-scale` or `user-scalable`. `interactive-widget=resizes-content` may be added, but its Safari support
  is UNVERIFIED, so do not rely on it.
- Status bar: `apple-mobile-web-app-status-bar-style = black-translucent`, so the content runs under the status
  bar and the nav bar pads itself by `--safe-top`. Text colour follows `color-scheme`. Behaviour with the
  Dynamic Island on iOS 26 is UNVERIFIED.
- Top: never place a tappable element inside `--safe-top` (59px on the 14 Pro and 15 Pro with the Dynamic
  Island, 47px on the iPhone 13, from `research/20`). The large title row starts at `--safe-top + 44px`.
- Bottom: the tab bar capsule and scan button sit `--tab-bar-bottom` above the screen edge. That is
  `max(safe-bottom − 12px, 12px)`, which is 22px on Face ID iPhones and leaves the home indicator clear. The
  exact value is UNVERIFIED and should be tuned on device. Scroll containers end with `--content-bottom` padding.
- Left/right insets are 0 in portrait, but `--safe-left` and `--safe-right` are added to `--margin` for landscape.
- Keyboard: the tab bar and scan button hide while a field has focus. Sheets track `window.visualViewport`
  (`resize`, `scroll`) and lift their bottom action bar to `innerHeight − (vv.height + vv.offsetTop)`.
  The focused field scrolls into view with 16px of clearance.
- Scanner: true black (`scanner-bg`), with its chrome on `scanner-material`. It is always dark, whatever the theme.

### 4.7 Touch targets

- The minimum hit area is 44 × 44px (`--hit-min`). A smaller visual (a 22px check circle, a 17px clear button,
  a 36px stepper button) gets an invisible `::before` that expands the hit area to 44px, centred.
- Neighbouring hit areas never overlap. If two 44px areas would overlap, the visuals move apart instead
  (stepper buttons have a 12px gap and 36px visuals).
- Tab items share the capsule width equally (at least 76px each). The scan button is a 60px circle.
- Destructive actions are never the closest target to a frequent action. "Supprimer" sits at the bottom of
  item detail, separated by a group.

### 4.8 Z-index layers

`--z-base 0` → `--z-sticky 10` (nav bar) → `--z-tab-bar 20` → `--z-scan-button 21` → `--z-banner 25`
(offline banner) → `--z-toast 30` → `--z-scrim 40` → `--z-sheet 41` (+1 per nested sheet) → `--z-menu 50` →
`--z-scanner 60`. In Tailwind, use `z-(--z-sheet)`. No other z-index values are allowed. The hidden haptic
switch input lives off-screen and needs no layer.

---

## 5. Iconography

- Library: **Lucide** (ISC). SF Symbols are licensed for Apple platforms only (`research/20`). All names below
  were checked against `lucide-static@1.71.0/tags.json` (2,046 icons, fetched 2026-11-10). Lucide 1.x renamed
  several icons: `trash-2` is now `trash`, `circle-alert` is `circle-exclamation-point`, `triangle-alert` is
  `triangle-exclamation-point`, `circle-help` is `circle-question-mark`, and `history` is `rotate-ccw-clock`.
  Use the 1.x names and confirm them against the installed `lucide-react` version. Never mix in a second
  icon library.
- Sizes and strokes (`absoluteStrokeWidth`, so strokes stay the same at every size): **17px / 1.5px** inline
  with body text and for row chevrons; **20px / 1.5px** in category tiles, toolbar and nav buttons;
  **24px / 1.75px** in the tab bar; **28px / 2px** in the scan button; **28px / 1.75px** for the empty-state glyph.
  At these weights Lucide reads close to SF Symbols Regular next to SF Pro.
- Optical alignment: inline icons are centred on the cap height, not the line box (`vertical-align: -0.15em`,
  or flex centre with a 1px upward nudge at 17px). Chevrons get a 1px nudge toward their pointing direction.
  The scan-barcode glyph is centred optically, not by its bounding box.
- Colour: an icon takes the colour of its text role (`label-secondary` when inactive, `accent-fg` when active
  or actionable, `danger-fg` when destructive, `warning-fg` for running low). Category glyphs use their
  category `fg` on their tile. Icons never carry meaning without a text label or an `aria-label`.
- Filled and outline: Lucide is outline-only, and icons are never filled with `fill="currentColor"` (the
  shapes are not designed for it). Selection is shown by **colour plus weight**: an active tab icon is
  `accent-fg` at 2.25px stroke against 1.75px for inactive ones, and its label turns `accent-fg` too. A selected
  list option shows a `check`. A selected chip uses an `accent-tint` background.

### 5.1 Icon inventory

| Area | Lucide name | Use |
|---|---|---|
| Tab bar | `house` | Accueil |
| | `package` | Stock |
| | `shopping-basket` | Courses |
| Scan | `scan-barcode` | Scan button, "Scanner un produit" |
| | `flashlight` / `flashlight-off` | Torch toggle in the scanner |
| | `keyboard` | Type the barcode by hand |
| | `x` | Close the scanner, close a sheet |
| | `camera-off` | Camera permission denied state |
| | `package-question-mark` | Unknown product ("Produit inconnu") |
| | `package-plus` / `package-minus` | "Ajouté" and "Retiré" toasts, segmented mode glyphs |
| | `plus` / `minus` | Stepper |
| | `undo-2` | Undo in the tray and in toasts |
| Navigation | `chevron-left` | Back |
| | `chevron-right` | Row disclosure |
| | `chevron-down` | Pantry switcher next to the large title |
| | `ellipsis` | More actions on item detail |
| | `circle-user-round` | Avatar fallback (Réglages) |
| List tools | `search` / `circle-x` | Search field and clearing it |
| | `arrow-down-wide-narrow` | Sort |
| | `list-filter` | Filter |
| | `layers` | Group by |
| | `check` | Selected option, checked course item |
| | `grip-vertical` | Reorder (categories, pantries) |
| Item | `pencil` | Edit |
| | `trash` | Delete |
| | `barcode` / `copy` | Show and copy the GTIN |
| | `calendar-clock` | Predicted run-out date |
| | `tag` | Price |
| | `scale` | Unit size or weight |
| | `arrow-left-right` | Move to another pantry |
| | `store` | Shop or price source (Leclerc, Carrefour) |
| | `external-link` | Open on Open Food Facts |
| Status | `trending-down` | Running low (amber) |
| | `triangle-exclamation-point` | Out of stock, conflict warning |
| | `circle-exclamation-point` | Error |
| | `circle-check` | Success toast |
| | `info` | Information |
| | `cloud-off` | Offline banner |
| | `refresh-cw` | Retry sync |
| | `circle-dashed` | Change pending sync (on a row, `label-tertiary`) |
| | `clock` | Last updated |
| Settings | `users` / `user-plus` / `crown` | Members, invite, owner badge |
| | `warehouse` | Pantries |
| | `layout-grid` | Categories |
| | `bell` / `bell-off` | Notifications on / refused |
| | `mail` / `link` | Invite by e-mail / by link |
| | `sun-moon` | Appearance |
| | `vibrate` | Haptics |
| | `circle-question-mark` | Help |
| | `door-open` / `log-out` | Leave household / sign out |
| Empty states | `package-open` | Empty stock |
| | `list-checks` | Nothing to buy |
| | `circle-check` | Nothing running low |
| | `search-x` | No search result |
| | `camera-off`, `cloud-off`, `bell-off` | Permission and offline states |

Category glyphs are listed in section 6. All 91 names above and in section 6 exist in lucide-static 1.71.0.

---

## 6. Default categories

Source: `docs/research/06-category-mapping.md`. Its 28 categories, slugs and French labels are adopted
**exactly**, so the mapping table there stays aligned. Its rule table (section 6.1 there) is the source of truth
for Open Food Facts tags. The "OFF tags" column below lists the main tags only. Frozen and canned take
precedence over food type (a frozen pea is Surgelés), as research/06 specifies.

### 6.1 Category colours

Twelve muted hues share the same OKLCH lightness, so no category looks more important than another. The tile
is L 0.94 (light) / 0.31 (dark) and the glyph is L 0.52 / 0.82. Each glyph passes 3:1 on its tile
(4.47 to 4.81 in light, 7.43 to 7.63 in dark). The glyph also passes 3:1 on `surface` when used as a dot
(5.20 to 5.72 light, 9.00 to 9.58 dark). Hues are shared deliberately by neighbours in the shop: wine shares
with chocolate (plum), and water shares with frozen (sky).

| Hue token | Light tile / glyph | Dark tile / glyph | Shared by |
|---|---|---|---|
| `tomato` | `#FFE4E0` / `#98524A` | `#422825` / `#F1B2A9` | viande, conserves |
| `clay` | `#FEE6D9` / `#945733` | `#412A1E` / `#EDB799` | epicerie_sucree, plats, cafe |
| `apricot` | `#FAE8D5` / `#8B5E22` | `#3D2D19` / `#E4BC8F` | pain, petit_dej, jus |
| `honey` | `#F3EBD4` / `#7D671B` | `#383018` / `#D5C38C` | feculents, biere |
| `olive` | `#EAEED6` / `#676F28` | `#30331B` / `#C2CA92` | apero, condiments |
| `sage` | `#DFF1DE` / `#437746` | `#233624` / `#A6D2A7` | legumes, animaux |
| `teal` | `#D5F2F0` / `#137875` | `#143735` / `#89D4D0` | poisson, entretien |
| `sky` | `#D8EFFC` / `#267194` | `#1A3441` / `#92CDED` | surgeles, eau |
| `iris` | `#E4EBFF` / `#5665A0` | `#292F45` / `#B3C2F6` | laitier, soft, bebe |
| `plum` | `#F7E4F7` / `#845587` | `#3B293C` / `#DEB4DF` | chocolat, vin |
| `rose` | `#FEE3EB` / `#945069` | `#412830` / `#EDB0C4` | fruits, hygiene |
| `pebble` | `#EEEBE5` / `#6D6861` | `#32302C` / `#C7C3BD` | papier, pharmacie, autre |

The OKLCH values are in 2.2 and `tokens.css` (`--color-<hue>-100/600/850/300`). Components use
`--cat-<hue>-tile` / `--cat-<hue>-fg`, or `bg-cat-<hue>-tile` / `text-cat-<hue>-fg`. Because the hue is
stored as data on the category, set it with an inline style (`background: var(--cat-${hue}-tile)`), since
Tailwind cannot see class names built at runtime. `sage` (hue 145, low chroma, used only as a tile) is
yellower and much quieter than the bottle-green accent (hue 160) and is never used for text or fills.
This keeps the "one green" rule.

### 6.2 The 28 categories

| # | Slug | Name (FR) | Lucide | Hue | Ce qui va ici | Main OFF tags (full list: research/06 §6.1) |
|---|---|---|---|---|---|---|
| 1 | `legumes` | Légumes | `carrot` | sage | Légumes frais et pommes de terre (hors conserves et surgelés) | `en:vegetables`, `en:fresh-vegetables`, `en:potatoes`, `en:leaf-vegetables` |
| 2 | `fruits` | Fruits | `apple` | rose | Fruits frais et fruits secs | `en:fruits`, `en:fresh-fruits`, `en:dried-fruits`, `en:apples` |
| 3 | `feculents` | Pâtes, riz & céréales | `wheat` | honey | Pâtes, riz, farines, légumineuses sèches, semoule | `en:pastas`, `en:rices`, `en:flours`, `en:legumes`, `en:cereal-grains` |
| 4 | `poisson` | Poisson | `fish` | teal | Poissons et fruits de mer frais ou fumés | `en:fishes`, `en:seafood`, `en:smoked-salmons`, `en:shellfish` |
| 5 | `viande` | Viande & charcuterie | `beef` | tomato | Viande fraîche, abats, jambon, saucisses, charcuterie | `en:meats`, `en:fresh-meats`, `en:prepared-meats`, `en:hams`, `en:sausages` |
| 6 | `laitier` | Produits laitiers & œufs | `milk` | iris | Lait, yaourts, fromages, crème, beurre, œufs, laits végétaux | `en:dairies`, `en:milks`, `en:yogurts`, `en:cheeses`, `en:eggs` |
| 7 | `pain` | Pain & viennoiseries | `croissant` | apricot | Pain, pains de mie, brioches, viennoiseries | `en:breads`, `en:viennoiseries`, `en:brioches` |
| 8 | `apero` | Apéritifs & snacks salés | `popcorn` | olive | Chips, biscuits apéritif, fruits à coque salés | `en:crisps`, `en:salty-snacks`, `en:appetizers`, `en:nuts` |
| 9 | `epicerie_sucree` | Épicerie sucrée | `cookie` | clay | Biscuits, gâteaux, sucre, desserts, barres | `en:biscuits`, `en:cakes`, `en:sugars`, `en:desserts`, `en:cereal-bars` |
| 10 | `chocolat` | Chocolat & confiserie | `candy` | plum | Chocolat, bonbons, chewing-gums | `en:chocolates`, `en:chocolate-bars`, `en:candies`, `en:chewing-gums` |
| 11 | `petit_dej` | Petit-déjeuner & tartinables | `sunrise` | apricot | Céréales du matin, pâtes à tartiner, confitures, miel, cacao | `en:breakfast-cereals`, `en:sweet-spreads`, `en:jams`, `en:honeys` |
| 12 | `conserves` | Conserves | `can` | tomato | Légumes, poissons, plats et fruits en conserve, tomates en boîte | `en:canned-foods`, `en:canned-vegetables`, `en:canned-fishes`, `en:canned-meals` |
| 13 | `surgeles` | Surgelés | `snowflake` | sky | Tout ce qui est congelé, glaces comprises | `en:frozen-foods`, `en:ice-creams-and-sorbets`, `en:frozen-pizzas` |
| 14 | `plats` | Plats préparés & soupes | `soup` | clay | Plats cuisinés frais, soupes, sandwichs, pizzas et quiches fraîches | `en:meals`, `en:soups`, `en:pizzas`, `en:quiches` |
| 15 | `soft` | Boissons sans alcool | `cup-soda` | iris | Sodas, sirops, limonades, boissons énergisantes | `en:sodas`, `en:syrups`, `en:soft-drinks`, `en:lemonades` |
| 16 | `jus` | Jus & nectars | `citrus` | apricot | Jus de fruits et de légumes, nectars | `en:juices-and-nectars`, `en:fruit-juices`, `en:fruit-nectars` |
| 17 | `eau` | Eaux | `glass-water` | sky | Eaux plates, gazeuses et minérales | `en:waters`, `en:mineral-waters`, `en:spring-waters` |
| 18 | `vin` | Vins | `wine` | plum | Vins, champagnes et vins effervescents | `en:wines`, `en:red-wines`, `en:white-wines`, `en:champagnes` |
| 19 | `biere` | Bières, cidres & spiritueux | `beer` | honey | Bières, cidres, alcools forts, liqueurs | `en:beers`, `en:ciders`, `en:hard-liquors`, `en:liqueurs` |
| 20 | `cafe` | Café & thé | `coffee` | clay | Café moulu, soluble, capsules, thés, infusions | `en:coffees`, `en:coffee-capsules`, `en:teas`, `en:herbal-teas` |
| 21 | `condiments` | Condiments, sauces & huiles | `cooking-pot` | olive | Sauces, moutarde, vinaigres, huiles, épices, sel, bouillons | `en:condiments`, `en:sauces`, `en:vegetable-oils`, `en:spices`, `en:broths` |
| 22 | `bebe` | Bébé | `baby` | iris | Laits infantiles, petits pots, lingettes, couches | `en:baby-foods`, `en:baby-milks`, `en:baby-wipes`, `en:diapers` |
| 23 | `animaux` | Animaux | `paw-print` | sage | Nourriture, litière et accessoires pour animaux | `en:pet-food`, `en:cat-food`, `en:dog-food`, `en:cat-litter` |
| 24 | `entretien` | Entretien & nettoyage | `brush-cleaning` | teal | Lessive, vaisselle, nettoyants ménagers | `en:household-cleaning-products`, `en:laundry-detergents`, `en:dishwasher-tablets` |
| 25 | `hygiene` | Hygiène & beauté | `soap-dispenser-droplet` | rose | Dentifrice, shampoing, gel douche, déodorant, savon, cosmétiques | `en:hygiene`, `en:toothpastes`, `en:shampoos`, `en:shower-gels`, `en:deodorants` |
| 26 | `papier` | Papier & jetables | `scroll` | pebble | Papier toilette, essuie-tout, mouchoirs, vaisselle jetable, film, aluminium | `en:toilet-papers`, `en:paper-towels`, `en:household-paper-products`, `en:food-wraps` |
| 27 | `pharmacie` | Pharmacie & compléments | `pill` | pebble | Compléments alimentaires et vitamines (pas les médicaments) | `en:dietary-supplements`, `en:vitamins` |
| 28 | `autre` | Autre | `shapes` | pebble | Tout le reste | none (final fallback) |

Icon notes: Lucide 1.71 has no bread loaf, toilet roll or sauce bottle. `croissant` stands for bakery,
`scroll` reads as a roll of paper, and `cooking-pot` stands for cooking staples. `sunrise` ("le matin") marks
breakfast, because `egg-fried` would suggest eggs, which belong to Produits laitiers & œufs. `shapes` marks
"Autre" so that `package` stays unique to the Stock tab.

### 6.3 Changes to the research/06 category set

No category was merged, split or renamed. Slugs and French labels are copied verbatim. Two notes for the
architecture thread:

1. research/06 slugs are short snake_case (`epicerie_sucree`, `petit_dej`), not kebab-case as the original
   design prompt asked. They were kept unchanged on purpose so the rule table and the seed stay aligned.
   CSS never uses category slugs (colours are keyed by hue), so the style mismatch has no cost.
2. The labels use "&" (for example "Viande & charcuterie"). This is acceptable in short French labels. In
   running text, VoiceOver reads "&" as "et" in French (UNVERIFIED). If testing shows otherwise, add an
   `aria-label` with "et" instead of changing the label.

Each household can rename, recolour (choosing among the 12 hues), re-icon (from a curated set of about 60
Lucide food and household glyphs) or hide a default category. Overrides are stored per household, and the
slug never changes.

---

## 7. Imagery and empty states

- **No illustrations, no stock photos, no emoji.** An empty state is a 64px circle in `fill-tertiary` holding
  a 28px Lucide glyph in `label-secondary`, followed by a `title-3` title, one `subhead` sentence in
  `label-secondary`, and at most one button. The whole block is centred in the remaining space.
  Example: `package-open`, "Le stock est vide", "Scanner un produit pour commencer.", [Scanner un produit].
- **Product photos (Open Food Facts):** shown in a 1:1 frame, `rounded-lg` (20) at 120px on item detail
  and `rounded-sm` (10) at 44px in the scanner tray. Use `object-fit: contain` on a light plate (`stone-0` in both
  themes, because packshots are shot on white), with 8% inner padding and a `separator` hairline ring. In dark
  mode the image gets `filter: brightness(0.9)` so the white plate does not glare. Request the 400px OFF
  image variant for the detail and the 200px variant for the tray. Use `loading="lazy"` and `decoding="async"`.
- **Fallback:** if there is no photo or it fails to load, the frame shows the category tile at frame size,
  with the glyph at 40% of the frame. It never shows a generic "image missing" icon.
- **Loading:** a `fill-tertiary` block with no shimmer, and the photo fades in over 150ms (opacity only).
- **Credit:** "Photo : Open Food Facts" in `caption-1` `label-tertiary` under the detail photo, as ODbL and
  CC BY-SA require.
- **App icon and splash:** a bottle-green (`#28704E`) square holding a stone-0 serif "C" in New York semibold.
  Splash screens are flat `#F6F4F1` (light) and `#0F0E0C` (dark), with the same mark centred.

---

## 8. Accessibility checklist

- [ ] Every text pair in use appears in 2.6 and passes. New pairs are added to the table with a computed
      ratio before they ship.
- [ ] UI component boundaries that carry meaning (buttons, scan button, focus ring, selected chip) reach 3:1.
      Fields rely on label and placeholder, and gain a 1px `edge` with Increase Contrast.
- [ ] Colour is never the only signal. Running low has `trending-down` plus text, errors have an icon plus
      text, and the selected tab changes stroke weight as well as colour.
- [ ] `:focus-visible` shows `focus-ring` (2px `focus-ring`, 2px offset) on every interactive element, and
      `outline: none` never appears without it. Focus order follows the visual order, and sheets trap focus
      and return it to their trigger.
- [ ] Dynamic Type: all text uses `type-*` roles (never raw px). Rows use min-height, not height. Layouts
      were checked at `--dt = 1.35` (xxxLarge) and `--dt = 2.35` (AX3). No text is clipped, and truncation
      only applies to row names (2 lines).
- [ ] Hit areas are at least 44 × 44px and never overlap.
- [ ] VoiceOver, in French: `<html lang="fr">`. Icon-only buttons have an `aria-label` in the `fr.ts` voice
      ("Scanner un produit", "Fermer", "Ajouter une unité", "Retirer une unité", "Plus d’actions").
      Category tiles are `aria-hidden` because the category name is in the text. Quantities read as
      "3 bouteilles", never "3". The stepper is a `role="spinbutton"` with `aria-valuenow`, `aria-valuemin="0"`
      and an `aria-valuetext` that includes the unit. Live updates (scan added, undo) go to a polite
      `aria-live` region.
- [ ] Reduce Motion: every spring falls back to the `reduced` preset (0.18s opacity cross-fade, no transform).
      See `02-motion-haptics.md`. Reduced motion never removes the feedback itself.
- [ ] Reduce Transparency and Increase Contrast: tokens switch automatically (2.5). Both modes have been
      checked on device.
- [ ] Haptics are never the only feedback: each haptic moment also has a visual change (see 02).
- [ ] The light and dark themes were both reviewed, along with the scanner (always dark).

---

## 9. Token naming (matches `tokens.css` exactly)

Tailwind utility = the namespace + the token name after the prefix, for example `--color-surface` gives
`bg-surface`, `text-surface`, `border-surface`. Components use only layers 2 and 3. Ramp utilities
(`bg-stone-50`) exist but are banned in components by review.

**Ramp, `@theme static` (layer 1).**
- `--color-stone-{0,25,50,100,150,200,300,350,400,450,500,550,600,700,800,850,900,925,950,975,990}`, `--color-black`
- `--color-green-{50,100,300,400,500,550,600,650,700,800,900,950}`
- `--color-amber-{100,300,600,700,900}`, `--color-brick-{100,300,500,600,700,900}`
- `--color-{tomato,clay,apricot,honey,olive,sage,teal,sky,iris,plum,rose,pebble}-{100,600,850,300}`
- `--font-sans`, `--font-serif-display`, `--font-rounded`, `--font-mono`
- `--text-{display,large-title,title-1,title-2,title-3,headline,body,callout,subhead,footnote,caption-1,caption-2,tab-label,quantity-xl,quantity-l,quantity,badge,badge-s}`,
  each with `--line-height`, `--letter-spacing` and `--font-weight` sub-keys (for example `--text-body--line-height`)
- `--spacing` (0.25rem)
- `--radius-{xs,sm,md,lg,xl}` (6, 10, 14, 20, 28 px)
- `--ease-out`, `--ease-sheet`, `--default-transition-duration`, `--default-transition-timing-function`
- Reset with `initial` to remove Tailwind defaults: `--color-*`, `--font-*`, `--text-*`, `--radius-*`, `--shadow-*`, `--ease-*`

**Semantic, plain `:root` custom properties (layer 2), overridden by theme, contrast and transparency.**
- Backgrounds: `--bg`, `--bg-grouped`, `--bg-elevated`, `--surface`, `--surface-elevated`
- Labels: `--label-primary`, `--label-secondary`, `--label-tertiary`, `--label-quaternary`
- Fills: `--fill-primary`, `--fill-secondary`, `--fill-tertiary`, `--fill-quaternary`
- Lines: `--separator`, `--separator-opaque`, `--edge`, `--hairline`
- Accent: `--accent`, `--accent-pressed`, `--accent-fg`, `--accent-tint`, `--on-accent`, `--focus-ring`
- States: `--success-fg`, `--success-tint`, `--warning-fg`, `--warning-tint`, `--danger`, `--danger-pressed`,
  `--danger-fg`, `--danger-tint`, `--info-fg`, `--info-tint`
- Materials: `--material-alpha`, `--material-bar`, `--material-filter`, `--scrim`, `--scanner-bg`, `--scanner-material`
- Shadows: `--shadow-thumb`, `--shadow-float`, `--shadow-accent`, `--shadow-sheet`, `--shadow-menu`
- Categories: `--cat-{hue}-tile`, `--cat-{hue}-fg` for the 12 hues
- Dynamic Type: `--dt`
- Shell: `--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left`, `--margin`, `--nav-bar-height`,
  `--large-title-height`, `--tab-bar-height`, `--tab-bar-gap`, `--tab-bar-bottom`, `--content-bottom`, `--hit-min`
- Layers: `--z-base`, `--z-sticky`, `--z-tab-bar`, `--z-scan-button`, `--z-banner`, `--z-toast`, `--z-scrim`,
  `--z-sheet`, `--z-menu`, `--z-scanner`
- Motion (CSS only): `--motion-color-duration` (150ms), `--motion-reduced-duration` (180ms)

**Bridge, `@theme inline` (layer 3), giving Tailwind utilities.**
- `--color-{bg,bg-grouped,bg-elevated,surface,surface-elevated}`
- `--color-label-{primary,secondary,tertiary,quaternary}`, `--color-fill-{primary,secondary,tertiary,quaternary}`
- `--color-{separator,separator-opaque,edge}`
- `--color-{accent,accent-pressed,accent-fg,accent-tint,on-accent,focus-ring}`
- `--color-{success-fg,success-tint,warning-fg,warning-tint,danger,danger-pressed,danger-fg,danger-tint,info-fg,info-tint}`
- `--color-{material,scrim,scanner-bg,scanner-material}`
- `--color-cat-{hue}-tile`, `--color-cat-{hue}-fg`
- `--shadow-{thumb,float,accent,sheet,menu}`

**Utilities (`@utility`).** `material`, `focus-ring`, and `type-{role}` for every text role above.

**Selectors.** `html[data-theme="light"|"dark"]` (manual theme) and `html[data-transparency="reduced"]`
(manual reduced transparency). Media queries: `prefers-color-scheme`, `prefers-contrast: more`,
`prefers-reduced-transparency: reduce`.

---

## 10. Motion pointer

All springs (`press`, `snappy`, `smooth`, `push`, `sheet`, `fling`, `pop`, `reduced`) and every haptic moment are
specified in `02-motion-haptics.md`. This file only fixes two CSS-only values: colour and opacity state
changes use 150ms `--ease-out`, and the reduced-motion cross-fade lasts 180ms.

---

## 11. Deviations from the brief

1. **Categories follow research/06 (28 categories, snake_case slugs).** The coordinator asked for this
   after the brief was written. See 6.3.
2. **`title-1` (28px) uses the serif.** The brief lists screen titles, onboarding and the wordmark for New
   York at 28pt and above. This file also applies it to the item name on item detail and to sheet hero titles,
   which are 28px. That stays within the brief's 28pt-and-above limit, and is listed here only for visibility.
3. **Title weights are 600** across the sans titles, not Apple's Regular. The reason is in 3.2.
4. **The type scale adds `display` (40px), `tab-label` (10px) and five numeric roles** to the brief's eleven
   Apple roles. The Apple sizes are unchanged.
5. **Dynamic Type works through a `--dt` multiplier on type only.** The brief says sizes are in rem "so the
   user's text size scales the layout". Here, type tokens are in rem and also scale with Dynamic Type, but
   spacing and radii do not grow with Dynamic Type, matching iOS behaviour. The reason is in 3.3.
