# 01 — Cellier design system

Status: binding for implementation. Companion files: `tokens.css` (the code form of every token named here),
`02-motion-haptics.md` (springs, gestures, haptics) and the screens document. Shared foundations come from
the shared design brief (merged into `README.md`). Wherever this file departs from the brief, the departure is listed in section 11.

Legend: **UNVERIFIED** marks a platform behaviour that was not confirmed in this session. Test it on a real
iPhone before relying on it.

Mood: a cool, quiet Nordic pantry with good light. Paper-white and fog neutrals, near-black ink with a cool
undertone, one deep spruce accent, a Scandinavian grotesk for titles, SF Pro tabular figures for counts.

---

## 1. Principles

1. **One green.** Spruce green marks only the things you can act on or have just done: the primary action,
   the scan button, selection, links, progress and success. In practice, a screen whose green elements were
   all removed should leave you unable to act, and a screen with green on decoration is a bug.
2. **The list is the product.** Most of the time is spent scanning inset grouped lists, so rows get the craft
   budget: exact heights, tabular numerals, hairline separators and no card shadows. Category colour
   appears only as a 36 px tile and a dot, in near-monochrome tints. It never colours text or large areas.
3. **Counts feel physical.** Quantities use semibold SF Pro tabular figures, and they are the only
   text that animates (the `pop` spring). Every other piece of text changes instantly.
4. **Quiet by default, loud only for state.** Amber says "running low" and brick says "something went wrong".
   Offline and pending sync use neutral grey, because waiting is not an error.
5. **One display voice.** Schibsted Grotesk (a grotesk drawn in Oslo) appears only at 28 px and above
   (screen titles, the item name on its detail page, onboarding, the wordmark). Everything else is SF Pro, so
   the app feels native and the display face stays a signature, not a theme. Cellier has no illustrations,
   gradients or emoji.
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
- Neutrals are a cool fog at hue 200 with chroma 0.001 to 0.008: paper white for cells, fog for the canvas,
  mist for separators, and an ink near-black with a faint blue-green undertone. No beige. The ramp keeps the
  `stone-` token prefix so no component had to change.
- The accent is spruce (hue 165): deeper, darker and less saturated than the old bottle green (light fill
  L 0.44, C 0.06). Green was kept over a new hue because it still means "stock, fresh, done" in a pantry, and
  a dark conifer green reads Nordic and premium where a blue would read as a generic link colour.
- Semantics are restrained: amber and brick were desaturated by about a third and stay clearly readable.
- Text colours are opaque. Apple's labels are translucent, but an opaque label has one exact contrast ratio
  per background, so AA can be guaranteed. Fills, separators, materials and the scrim stay translucent
  because they have to sit on any surface.

### 2.2 Ramps

**Fog (neutral; token prefix `stone-` kept).**

| Token | OKLCH | Hex | Main use |
|---|---|---|---|
| `stone-0` | `oklch(0.995 0.001 200)` | `#FDFEFE` | Light cells (`surface`), `on-accent` |
| `stone-25` | `oklch(0.982 0.002 200)` | `#F8F9FA` | Light plain background, material tint |
| `stone-50` | `oklch(0.966 0.003 200)` | `#F2F4F4` | Light grouped canvas, `theme-color` light, manifest |
| `stone-100` | `oklch(0.942 0.004 200)` | `#E9EDED` | Spare |
| `stone-150` | `oklch(0.915 0.005 200)` | `#DFE4E4` | Spare |
| `stone-200` | `oklch(0.882 0.006 200)` | `#D4D9DA` | Opaque separator (light) |
| `stone-300` | `oklch(0.81 0.007 200)` | `#BCC2C3` | Dark label-secondary (increased contrast) |
| `stone-350` | `oklch(0.745 0.008 200)` | `#A7AEAE` | Dark label-secondary |
| `stone-400` | `oklch(0.7 0.008 200)` | `#99A0A0` | Light label-quaternary (disabled) |
| `stone-450` | `oklch(0.66 0.008 200)` | `#8D9494` | Dark label-tertiary |
| `stone-500` | `oklch(0.595 0.008 200)` | `#7A8080` | Edges with increased contrast |
| `stone-550` | `oklch(0.535 0.008 200)` | `#686F6F` | Light label-tertiary |
| `stone-600` | `oklch(0.472 0.008 200)` | `#565D5D` | Light label-secondary, dark label-quaternary |
| `stone-700` | `oklch(0.415 0.008 200)` | `#474D4D` | Light label-secondary (increased contrast) |
| `stone-800` | `oklch(0.33 0.008 200)` | `#313737` | Opaque separator (dark) |
| `stone-850` | `oklch(0.27 0.008 200)` | `#222828` | Dark cells inside sheets |
| `stone-900` | `oklch(0.232 0.008 200)` | `#191F1F` | Dark cells (`surface`), charcoal |
| `stone-925` | `oklch(0.205 0.008 200)` | `#131819` | Dark sheet canvas, dark material tint |
| `stone-950` | `oklch(0.185 0.008 200)` | `#0F1414` | Light label-primary (ink) |
| `stone-975` | `oklch(0.155 0.007 200)` | `#090D0D` | Dark canvas (deep ink), `theme-color` dark |
| `stone-990` | `oklch(0.125 0.006 200)` | `#050707` | Light label-primary (increased contrast) |
| `black` | `oklch(0 0 0)` | `#000000` | The scanner only |

**Spruce (accent; token prefix `green-` kept).**

| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `green-50` | `oklch(0.962 0.014 165)` | `#EAF6F0` | Light `accent-tint` (selected background) |
| `green-100` | `oklch(0.93 0.025 165)` | `#D9EEE4` | Spare |
| `green-300` | `oklch(0.8 0.06 165)` | `#9ACBB4` | Dark `accent-fg`, dark focus ring |
| `green-400` | `oklch(0.7 0.068 165)` | `#76AC94` | Spare |
| `green-500` | `oklch(0.6 0.07 165)` | `#568E76` | Spare |
| `green-550` | `oklch(0.52 0.066 165)` | `#42755F` | Dark `accent` (fill) |
| `green-600` | `oklch(0.44 0.06 165)` | `#2F5D4A` | Light `accent` (fill), dark `accent-pressed` |
| `green-650` | `oklch(0.42 0.058 165)` | `#2B5745` | Light `accent-fg`, light focus ring |
| `green-700` | `oklch(0.37 0.052 165)` | `#224839` | Light `accent-pressed`, accent with increased contrast |
| `green-800` | `oklch(0.31 0.042 165)` | `#1A372B` | Pressed with increased contrast |
| `green-900` | `oklch(0.26 0.032 165)` | `#142920` | Spare |
| `green-950` | `oklch(0.235 0.022 165)` | `#14211B` | Dark `accent-tint` |

The light fill (`green-600`) is a step lighter than the light text green (`green-650`). A large filled
shape reads darker than the same colour in thin text, so the two values look like the same green in use.
In dark mode the accent is lifted (`green-550` fill, `green-300` text) so it stays visible against the deep
ink canvas (3.67:1 boundary) without glowing.

**States: accent pressed and disabled.** Pressed means `accent-pressed`, together with the `press` spring
scale defined in 02. Disabled means the button's fill becomes `fill-secondary` and its label becomes
`label-quaternary`. A disabled button is never a faded green, because a faded green would still look like
something you can act on.

**Amber (warning, running low) and brick (danger).**

| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `amber-100` | `oklch(0.952 0.024 85)` | `#F7EEDD` | Light `warning-tint` |
| `amber-300` | `oklch(0.83 0.075 80)` | `#E1C390` | Dark `warning-fg` |
| `amber-600` | `oklch(0.52 0.085 70)` | `#88602D` | Light `warning-fg` |
| `amber-700` | `oklch(0.465 0.075 68)` | `#755127` | Light `warning-fg` with increased contrast |
| `amber-900` | `oklch(0.28 0.03 75)` | `#322718` | Dark `warning-tint` |
| `brick-100` | `oklch(0.952 0.017 28)` | `#FAEBE9` | Light `danger-tint` |
| `brick-300` | `oklch(0.77 0.085 28)` | `#E5A096` | Dark `danger-fg` |
| `brick-500` | `oklch(0.555 0.125 28)` | `#B05248` | Dark `danger` (fill) |
| `brick-600` | `oklch(0.5 0.12 28)` | `#9C443B` | Light `danger` and `danger-fg`, dark `danger-pressed` |
| `brick-700` | `oklch(0.44 0.105 28)` | `#833830` | Light `danger-pressed`, danger with increased contrast |
| `brick-900` | `oklch(0.28 0.04 28)` | `#3A211E` | Dark `danger-tint` |

Semantic mapping: **success reuses the accent** (`success-fg = accent-fg`, `success-tint = accent-tint`),
so the app has exactly one green. **Info and neutral** use `label-secondary` on `fill-tertiary`. Offline and
pending sync are neutral as well.

### 2.3 Semantic layer

Components use only these names. The ramps are private to `tokens.css`.

| Token | Light | Dark | Role |
|---|---|---|---|
| `bg` | stone-25 `#F8F9FA` | stone-975 `#090D0D` | Plain (non-grouped) screens |
| `bg-grouped` | stone-50 `#F2F4F4` | stone-975 `#090D0D` | Canvas behind inset groups (Accueil, Stock, Courses) |
| `bg-elevated` | stone-50 `#F2F4F4` | stone-925 `#131819` | Sheet canvas |
| `surface` | stone-0 `#FDFEFE` | stone-900 `#191F1F` | Cells and cards in a group |
| `surface-elevated` | stone-0 `#FDFEFE` | stone-850 `#222828` | Cells inside a sheet |
| `label-primary` | stone-950 `#0F1414` | stone-50 `#F2F4F4` | Titles, row names, values |
| `label-secondary` | stone-600 `#565D5D` | stone-350 `#A7AEAE` | Subtitles, inactive tab items, section headers |
| `label-tertiary` | stone-550 `#686F6F` | stone-450 `#8D9494` | Placeholders, units, timestamps, chevrons |
| `label-quaternary` | stone-400 `#99A0A0` | stone-600 `#565D5D` | Disabled text only (exempt from contrast) |
| `fill-primary` | `oklch(0.55 0.01 200 / 0.2)` | `/ 0.32` | Stepper buttons, the switch track if custom |
| `fill-secondary` | `/ 0.16` | `/ 0.26` | Secondary buttons, disabled fills |
| `fill-tertiary` | `/ 0.12` | `/ 0.2` | Search field, segmented control track, info tint |
| `fill-quaternary` | `/ 0.07` | `/ 0.14` | Pressed row highlight |
| `separator` | `oklch(0.33 0.008 200 / 0.17)` ≈ `#DADCDC` on a cell | `oklch(0.85 0.006 200 / 0.15)` ≈ `#333939` | Hairline between rows (0.5 px) |
| `separator-opaque` | stone-200 `#D4D9DA` | stone-800 `#313737` | Separators over material |
| `edge` | transparent | transparent | Cell and control outline. Becomes stone-500 with Increase Contrast |
| `accent` | green-600 `#2F5D4A` | green-550 `#42755F` | Filled primary button, scan button, progress |
| `accent-pressed` | green-700 `#224839` | green-600 `#2F5D4A` | Pressed fill |
| `accent-fg` | green-650 `#2B5745` | green-300 `#9ACBB4` | Links, text buttons, checkmarks, the active tab |
| `accent-tint` | green-50 `#EAF6F0` | green-950 `#14211B` | Selected row, selected chip |
| `on-accent` | stone-0 `#FDFEFE` | stone-0 `#FDFEFE` | Text and glyph on `accent` and `danger` |
| `focus-ring` | green-650 | green-300 | Keyboard focus outline |
| `warning-fg` / `warning-tint` | amber-600 / amber-100 | amber-300 / amber-900 | "Bientôt épuisé", running-low badge |
| `danger` / `danger-pressed` | brick-600 / brick-700 | brick-500 / brick-600 | Destructive filled button |
| `danger-fg` / `danger-tint` | brick-600 / brick-100 | brick-300 / brick-900 | Error text, error banner |
| `material` | `oklch(0.982 0.002 200 / 0.86)` + `blur(20px) saturate(180%)` | `oklch(0.205 0.008 200 / 0.86)` + same | Tab bar, scrolled nav bar, toasts |
| `scrim` | `oklch(0.185 0.008 200 / 0.3)` | `oklch(0 0 0 / 0.55)` | Behind sheets and menus |
| `scanner-bg` / `scanner-material` | `#000` / `oklch(0.205 0.008 200 / 0.72)` | same | The scanner is always dark |

`theme-color` metas: light `#F2F4F4`, dark `#090D0D` (the grouped canvas of each theme, so the status
bar area blends into the screen). The manifest `theme_color` and `background_color` use `#F2F4F4`.

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
  1 px stone-500 outline on cells, fields and buttons (3.98:1 on a light cell and 4.16:1 on a dark one, which
  passes the 3:1 non-text rule). Materials become solid. In dark mode, labels go lighter (stone-0, stone-300,
  stone-350). The accent fill stays green-550, because a darker spruce would fall under 3:1 against the canvas.
  Verified in the iOS 26.3 simulator: Safari parses the query and it matches when Increase Contrast is on.
- `prefers-reduced-transparency: reduce`. `--material-alpha` becomes 1 and `--material-filter` becomes
  `none`. Only these two variables change, so the rule works with every theme. `research/20` reported that
  Safari does not support this media query; the iOS 26.3 simulator shows Safari now parses it, so it works on
  current iOS. Older iOS versions may not support it. The manual hook `html[data-transparency="reduced"]` is therefore
  provided as well. A "Réduire la transparence" switch in Réglages is optional and not required for v1.
- Manual theme: `html[data-theme="light" | "dark"]` overrides the system setting. With no attribute, the
  system setting applies.

### 2.6 Contrast table

Ratios are WCAG 2.x, computed from the exact sRGB values (OKLCH converted to 8-bit sRGB, then relative
luminance), recomputed for the Nordic palette. Translucent tokens were composited onto their real background
first. "Worst of 3 bases" means the lowest ratio over `surface`, `bg-grouped` and `surface-elevated`. All pairs
pass in light, dark and both increased-contrast variants.

| Pair | Where | Light | Dark | Needed | Result |
|---|---|---|---|---|---|
| `label-primary` on `bg-grouped` | Large titles, section text | 16.83 | 17.69 | 4.5 | Pass |
| `label-primary` on `surface` | Row titles | 18.39 | 15.13 | 4.5 | Pass |
| `label-primary` on `surface-elevated` | Rows in sheets | 18.39 | 13.57 | 4.5 | Pass |
| `label-primary` on `bg-elevated` | Sheet titles | 16.83 | 16.23 | 4.5 | Pass |
| `label-secondary` on `bg-grouped` | Section headers and footers | 6.10 | 8.66 | 4.5 | Pass |
| `label-secondary` on `surface` | Row subtitles | 6.66 | 7.40 | 4.5 | Pass |
| `label-secondary` on `surface-elevated` | Subtitles in sheets | 6.66 | 6.64 | 4.5 | Pass |
| `label-secondary` on `bg-elevated` | Footers in sheets | 6.10 | 7.94 | 4.5 | Pass |
| `label-tertiary` on `surface` | Placeholders, units, chevrons | 5.08 | 5.41 | 4.5 | Pass |
| `label-tertiary` on `surface-elevated` | Placeholders in sheets | 5.08 | 4.85 | 4.5 | Pass |
| `label-tertiary` on `bg-grouped` | Meta on canvas | 4.65 | 6.32 | 4.5 | Pass |
| `label-tertiary` on `bg-elevated` | Meta on a sheet canvas | 4.65 | 5.80 | 4.5 | Pass |
| `accent-fg` on `bg-grouped` | Links, text buttons | 7.45 | 10.77 | 4.5 | Pass |
| `accent-fg` on `surface` | Checkmarks, selected values | 8.14 | 9.21 | 4.5 | Pass |
| `accent-fg` on `surface-elevated` | Sheet toolbar buttons | 8.14 | 8.26 | 4.5 | Pass |
| `accent-fg` on `bg-elevated` | Sheet header buttons | 7.45 | 9.87 | 4.5 | Pass |
| `on-accent` on `accent` | Primary button label, scan glyph | 7.46 | 5.27 | 4.5 | Pass |
| `on-accent` on `accent-pressed` | Same, pressed | 10.12 | 7.46 | 4.5 | Pass |
| `accent-fg` on `accent-tint` | Selected chip text | 7.42 | 9.16 | 4.5 | Pass |
| `label-primary` on `accent-tint` | Text on a selected row | 16.75 | 15.06 | 4.5 | Pass |
| `accent` on `bg-grouped` | Button and scan button boundary | 6.83 | 3.67 | 3 | Pass |
| `accent` on `bg-elevated` | Primary button in a sheet | 6.83 | 3.36 | 3 | Pass |
| `focus-ring` on `bg-grouped` | Focus outline | 7.45 | 10.77 | 3 | Pass |
| `focus-ring` on `surface` | Inset focus ring on a row | 8.14 | 9.21 | 3 | Pass |
| `warning-fg` on `surface` | "Bientôt épuisé" text and icon, low dot | 5.53 | 9.87 | 4.5 | Pass |
| `warning-fg` on `bg-grouped` | Warning text on canvas | 5.06 | 11.54 | 4.5 | Pass |
| `warning-fg` on `warning-tint` | Running-low badge | 4.85 | 8.62 | 4.5 | Pass |
| `danger-fg` on `surface` | Destructive text, errors | 6.29 | 7.80 | 4.5 | Pass |
| `danger-fg` on `surface-elevated` | Destructive rows in sheets | 6.29 | 6.99 | 4.5 | Pass |
| `danger-fg` on `danger-tint` | Error banner | 5.49 | 6.92 | 4.5 | Pass |
| `on-accent` on `danger` | Destructive filled button | 6.29 | 5.01 | 4.5 | Pass |
| `on-accent` on `danger-pressed` | Same, pressed | 8.08 | 6.29 | 4.5 | Pass |
| `label-primary` on `fill-primary` (worst of 3 bases) | Stepper, segmented label | 13.23 | 9.59 | 4.5 | Pass |
| `label-primary` on `fill-tertiary` (worst of 3 bases) | Search text, join code | 14.60 | 10.99 | 4.5 | Pass |
| `label-secondary` on `fill-primary` (worst of 3 bases) | Placeholder on the strongest fill | 4.79 | 4.69 | 4.5 | Pass |
| `label-secondary` on `fill-tertiary` (worst of 3 bases) | Search field placeholder | 5.29 | 5.38 | 4.5 | Pass |
| `accent-fg` on `fill-primary` (worst of 3 bases) | Accent glyph on a fill button | 5.86 | 5.83 | 4.5 | Pass |
| `accent-fg` on `fill-tertiary` (worst of 3 bases) | Selected tab on its pill | 6.47 | 6.69 | 4.5 | Pass |
| `label-primary` on `material` (pure white or black behind) | Tab labels, nav title | 12.78 | 10.70 | 4.5 | Pass |
| `label-secondary` on `material` (pure white or black behind) | Inactive tabs | 4.63 | 5.24 | 4.5 | Pass |
| `accent-fg` on `material` (pure white or black behind) | Active tab | 5.66 | 6.51 | 4.5 | Pass |
| Category glyph on its tile (12 hues) | Category tiles | 5.02 to 5.29 | 7.42 to 7.64 | 3 | Pass |
| Category glyph on `surface` (12 hues) | Category dots | 5.76 to 6.14 | 8.74 to 9.09 | 3 | Pass |
| White on `black` / `green-300` on `black` | Scanner text, scanner accent | 21.0 / 11.58 | same | 4.5 | Pass |
| `label-quaternary` on `surface` | Disabled text (exempt) | 2.63 | 2.48 | none | Exempt |

Pairs checked with increased contrast (light / dark): label-primary on bg-grouped 18.29 / 19.33; label-secondary on bg-grouped 7.81 / 10.83; label-secondary on material 8.18 / 9.93; label-tertiary on surface 6.66 / 7.40; label-tertiary on surface-elevated 6.66 / 6.64; accent-fg on surface 10.12 / 9.21; on-accent on accent 10.12 / 5.27; accent on bg-grouped 9.26 / 3.67; warning-fg on surface 7.02 / 9.87; warning-fg on warning-tint 6.15 / 8.62; danger-fg on surface 8.08 / 7.80; on-accent on danger 8.08 / 5.01; label-secondary on fill-primary 5.54 / 5.87; `edge` on surface 3.98 / 4.16 and on bg-grouped 3.64 / 4.86. All pass.

Rules that keep the table true:

- Text on a material is only `label-primary`, `label-secondary` or `accent-fg`.
- `label-quaternary` never carries information. Use it for disabled controls only.
- Text on fills is `label-primary`. `label-secondary` is allowed on any fill (worst case 4.69), but `label-tertiary` is not.
- Category colours never colour text.

---

## 3. Typography

### 3.1 Families

| Token | Stack | Used for | Why |
|---|---|---|---|
| `font-sans` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | All UI text | SF Pro on iOS: optical sizes and native metrics, no licence, no download. Off Apple devices it falls back to each platform's UI font. |
| `font-display` | `"Schibsted Grotesk", "Schibsted Grotesk Fallback", -apple-system, …, sans-serif` | `display`, `large-title`, `title-1` only (28 px and above), the wordmark | A Scandinavian grotesk with a quiet, compact build: it gives Cellier its own voice in titles while SF Pro keeps everything else native. |
| `font-rounded` | Same stack as `font-sans` | Quantities, stepper, badges, "dans 4 j", join code | Name kept so the components that use `font-rounded` did not change. Every numeric role adds `tabular-nums`. |
| `font-mono` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | The GTIN on item detail, debug only | Barcode digits must not be mistaken for a quantity. |

**Choosing the display face.** Four free fonts were rendered in the iOS 26.3 simulator ("Cave", "Créer le
foyer", "Bientôt épuisé", "samedi 14 nov." and «Cellier» at 34, 28 and 22 px, light and dark):

| Candidate | Origin, licence | French glyphs | Tabular figures | Verdict |
|---|---|---|---|---|
| Schibsted Grotesk | Oslo (Bakken & Bæck for Schibsted), SIL OFL 1.1, weight 400 to 900 | All (é è ê à ç œ « » ’) | `tnum` feature, verified in Safari | **Chosen** |
| Albert Sans | Copenhagen-inspired geometric, SIL OFL 1.1 | All | None (no `tnum`, proportional digits) | Calm, but fails the tabular requirement |
| Instrument Sans | SIL OFL 1.1, width and weight axes | All | `tnum` | Clean, but so close to SF Pro that titles lose their own voice |
| Familjen Grotesk | Stockholm, SIL OFL 1.1 | All | Tabular by default | Too much character (ink traps, heavy at 600) for a minimal brief |

Schibsted Grotesk was chosen because it is the only candidate that is both genuinely Scandinavian in origin
and drawing, and complete for the job: full French coverage, a `tnum` feature, and a slightly narrow build that
keeps long French titles («Accès au foyer retiré», «Tous les celliers») on one line at 34 px.

**Numerals.** Quantities moved from SF Pro Rounded to SF Pro (semibold, `tabular-nums`). Rounded read as
playful next to the new grotesk; SF Pro's tabular figures match the row text they sit beside, are tuned for
every size, and cost nothing to load. Schibsted's own tabular figures were not used for counts: its tabular
comma is as wide as a digit, so prices such as «1,89 €» look gapped.

**Self-hosting.** `public/fonts/schibsted-grotesk-latin.woff2` is the official Google Fonts "latin" subset of
the variable font (Basic Latin, Latin-1 Supplement, œ Œ, general punctuation including ’ … « » and the narrow
no-break space, €): 46 KB. The licence is `public/fonts/OFL.txt`. `@font-face` (in `tokens.css`) uses
`font-display: swap`; a second face, "Schibsted Grotesk Fallback", maps Helvetica Neue Medium with
`size-adjust: 104.4%`, `ascent-override: 93.6%`, `descent-override: 24.7%`, `line-gap-override: 0%` (computed
from both fonts' advance widths and Schibsted's vertical metrics at weight 600), so a title barely moves when
the web font arrives. `index.html` preloads the file, and the service worker precaches it (`woff2` is in the
Workbox `globPatterns`), so the installed app never waits for it after the first visit. The file was not
re-subset locally: `pyftsubset` is present but cannot write WOFF2 without the `brotli` module, and the Google
subset already contains exactly the ranges needed.

### 3.2 Type scale

Sizes are the iOS Dynamic Type "Large" defaults (`research/20`). "Display" means `font-display` (Schibsted
Grotesk) and "Num" means `font-rounded` (SF Pro) + tabular. Tracking for SF Pro roles is the Apple table, for
reference only (see below); tracking for the display roles is explicit and applied. The utility `type-<role>` sets family, size, leading, tracking and weight together.

| Role | Size / leading (px) | rem | Weight | Tracking | Family | Use |
|---|---|---|---|---|---|---|
| `display` | 40 / 46 | 2.5 | 600 | −0.022em (applied) | Display | "Cellier" wordmark, onboarding headline |
| `large-title` | 34 / 41 | 2.125 | 600 | −0.018em (applied) | Display | Collapsing screen titles, pantry name |
| `title-1` | 28 / 34 | 1.75 | 600 | −0.014em (applied) | Display | Item name on item detail, sheet hero title |
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
| `quantity-xl` | 48 / 52 | 3 | 600 | 0 | Num | Stepper value in the scanner tray and quantity sheet |
| `quantity-l` | 34 / 41 | 2.125 | 600 | 0 | Num | Stock count on item detail |
| `quantity` | 17 / 22 | 1.0625 | 600 | 0 | Num | Trailing count in item rows |
| `badge` | 13 / 16 | 0.8125 | 600 | 0 | Num | "dans 4 j", "× 3", counts in pills |
| `badge-s` | 11 / 13 | 0.6875 | 700 | +0.01em | Num | Tab badge, tray counter |

Decisions:

- Titles use weight 600 instead of Apple's Regular. The grotesk needs the weight to hold up at 34 px, and the
  SF Pro titles match it so the hierarchy stays consistent.
- **Tracking is left to the system for SF Pro (verified).** In the iOS 26.3 simulator, `-apple-system`, `ui-rounded` and
  `ui-serif` text (measured before the display font changed) gets wider per em as the size drops (about +4 at 11 px down to +0.8 at 34 px, in thousandths of
  an em per character, against 0 for Helvetica at every size). So WebKit already applies the fonts' size-specific
  tracking and optical sizes, and an explicit `letter-spacing` is added on top (−1 px gave exactly −1 px per
  character). Every SF Pro `--text-*--letter-spacing` token is therefore `normal`, and the Apple tracking values in
  the table above are for reference only. Do not add letter-spacing to system-font text.
- **Display tracking is explicit.** Schibsted Grotesk is a web font, so WebKit applies no size-specific
  tracking to it. Its three roles carry their own, tightening with size like Apple's display tracking:
  −0.014em at 28 px, −0.018em at 34 px, −0.022em at 40 px. Being in em, the values scale with Dynamic Type.
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
shadows are tinted toward the fog hue (200), never pure black. Cards in lists never cast a shadow (from the brief).
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

Twelve near-monochrome tints share the same OKLCH lightness and chroma, so no category looks more important
than another and a long list reads calm: the hue is a whisper on a fog-grey tile, not a colour block. The tile
is L 0.948 C 0.014 (light) / L 0.29 C 0.016 (dark) and the glyph is L 0.50 C 0.05 / L 0.80 C 0.045. `pebble` uses
the neutral fog hue. Each glyph passes 3:1 on its tile (5.02 to 5.29 in light, 7.42 to 7.64 in dark), and on
`surface` when used as a dot (5.76 to 6.14 light, 8.74 to 9.09 dark). Hues are shared deliberately by
neighbours in the shop: wine shares with chocolate (plum), and water shares with frozen (sky).

| Hue token | Hue | Light tile / glyph | Dark tile / glyph | Shared by |
|---|---|---|---|---|
| `tomato` | 28 | `#F7EBE9` / `#7D5953` | `#332827` / `#D9B3AE` | viande, conserves |
| `clay` | 50 | `#F6EBE6` / `#7B5B4A` | `#322924` / `#D7B6A4` | epicerie_sucree, plats, cafe |
| `apricot` | 70 | `#F4ECE4` / `#765E44` | `#312A23` / `#D1B99F` | pain, petit_dej, jus |
| `honey` | 92 | `#F1EEE4` / `#6D6342` | `#2E2B22` / `#C8BD9D` | feculents, biere |
| `olive` | 115 | `#EDEFE5` / `#626746` | `#2B2C23` / `#BCC2A1` | apero, condiments |
| `sage` | 145 | `#E8F0E8` / `#516B52` | `#272E26` / `#ACC6AC` | legumes, animaux |
| `teal` | 192 | `#E4F1F0` / `#3F6D6B` | `#222E2D` / `#9DC7C5` | poisson, entretien |
| `sky` | 232 | `#E5F0F6` / `#45697B` | `#242D32` / `#A2C4D6` | surgeles, eau |
| `iris` | 272 | `#EAEDF8` / `#596280` | `#282B34` / `#B3BDDC` | laitier, soft, bebe |
| `plum` | 325 | `#F3EBF3` / `#725A73` | `#302930` / `#CDB4CE` | chocolat, vin |
| `rose` | 358 | `#F6EAEE` / `#7B5763` | `#32282B` / `#D7B2BD` | fruits, hygiene |
| `pebble` | 200 | `#EBEFEF` / `#5E6565` | `#282C2C` / `#B9BFBF` | papier, pharmacie, autre |

The OKLCH values are in 2.2 and `tokens.css` (`--color-<hue>-100/600/850/300`). Components use
`--cat-<hue>-tile` / `--cat-<hue>-fg`, or `bg-cat-<hue>-tile` / `text-cat-<hue>-fg`. Because the hue is
stored as data on the category, set it with an inline style (`background: var(--cat-${hue}-tile)`), since
Tailwind cannot see class names built at runtime. `sage` (hue 145, chroma 0.014 to 0.05, used only as a tile)
is yellower and far quieter than the spruce accent (hue 165, chroma 0.06) and is never used for text or fills.
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
- **App icon and splash:** a spruce (`#2F5D4A`) square holding a stone-0 "C" in Schibsted Grotesk SemiBold.
  Splash screens are flat `#F2F4F4` (light) and `#090D0D` (dark), with the same mark centred. The shipped PNGs in
  `public/icons/` still carry the previous bottle-green serif mark and must be regenerated (`pnpm icons`) with
  these values; this restyle did not touch them.

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
- `--font-sans`, `--font-display`, `--font-rounded` (SF Pro, numeric roles), `--font-mono`
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
2. **`title-1` (28px) uses the display font.** The brief lists screen titles, onboarding and the wordmark for
   the display face at 28pt and above. This file also applies it to the item name on item detail and to sheet
   hero titles, which are 28px. That stays within the 28pt-and-above limit, and is listed here only for visibility.
3. **Title weights are 600** across the sans titles, not Apple's Regular. The reason is in 3.2.
4. **The type scale adds `display` (40px), `tab-label` (10px) and five numeric roles** to the brief's eleven
   Apple roles. The Apple sizes are unchanged.
5. **Dynamic Type works through a `--dt` multiplier on type only.** The brief says sizes are in rem "so the
   user's text size scales the layout". Here, type tokens are in rem and also scale with Dynamic Type, but
   spacing and radii do not grow with Dynamic Type, matching iOS behaviour. The reason is in 3.3.
6. **Restyle (November 2026): Schibsted Grotesk replaces New York, and a Nordic palette replaces warm stone.**
   The owner asked to drop the serif for a minimalist, Scandinavian display font and to move the colours toward
   premium. The brief's New York serif and SF Pro Rounded numerals are therefore superseded (3.1), the display
   font is a self-hosted web font (46 KB, precached) instead of a zero-byte system font, and the neutrals, accent,
   semantics and category tints were re-tuned (2.1, 2.2, 6.1). Token names are unchanged, except
   `--font-serif-display`, renamed `--font-display` because no component referenced it. The ramp prefixes
   `stone-` and `green-` and the `--font-rounded` name were kept on purpose so no component had to change.
