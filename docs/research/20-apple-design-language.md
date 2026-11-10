# Apple design language, translated to web tokens

Research date: 2026-11-10. Target: Cellier, iOS-first PWA for iPhone 13 to 15 Pro.

Legend: **VERIFIED** = read from the cited primary page in this session. **SECONDARY** = from a third-party source, check before shipping. **UNVERIFIED** = not confirmed; do not treat as a spec.

---

## 1. Typography

### 1.1 Dynamic Type, iOS/iPadOS sizes (VERIFIED)

Source: https://developer.apple.com/design/human-interface-guidelines/typography.md (Dynamic Type sizes tables, December 16 2025 revision adds emphasized weights).

| Style | Weight | Size (pt) | Leading (pt) | Emphasized weight |
|---|---|---|---|---|
| Large Title | Regular | 34 | 41 | Bold |
| Title 1 | Regular | 28 | 34 | Bold |
| Title 2 | Regular | 22 | 28 | Bold |
| Title 3 | Regular | 20 | 25 | Semibold |
| Headline | Semibold | 17 | 22 | Semibold |
| Body | Regular | 17 | 22 | Semibold |
| Callout | Regular | 16 | 21 | Semibold |
| Subhead | Regular | 15 | 20 | Semibold |
| Footnote | Regular | 13 | 18 | Semibold |
| Caption 1 | Regular | 12 | 16 | Semibold |
| Caption 2 | Regular | 11 | 13 | Semibold |

Other iOS sizes from the same page (VERIFIED), needed if you implement the scale with `clamp()`:
- xSmall: Large Title 31/38, Title 1 25/31, Title 2 19/24, Title 3 17/22, Headline 14/19, Body 14/19 (Body row inferred from the same table: see page; the fetched excerpt shows Headline 14/19 only, so re-check Body before use).
- xLarge: Large Title 36/43, Title 1 30/37, Title 2 24/30, Title 3 22/28, Headline 19/24, Body 19/24, Callout 18/23, Subhead 17/22, Footnote 15/20, Caption 1 14/19, Caption 2 13/18.
- xxLarge: Large Title 38/46, Title 1 32/39, Title 2 26/32, Title 3 24/30, Headline 21/26, Body 21/26, Callout 20/25, Subhead 19/24, Footnote 17/22, Caption 1 16/21, Caption 2 15/20.
- xxxLarge: Large Title 40/48, Title 1 34/41, Title 2 28/34, Title 3 26/32, Headline 23/29, Body 23/29, Callout 22/28, Subhead 21/28, Footnote 19/24, Caption 1 18/23, Caption 2 17/22.
- AX1 to AX5 are listed on the page (AX1 Large Title 44/52 up to AX5 Large Title 60/70). Use the page for exact values.

Default text size and minimum: iOS/iPadOS default 17 pt, minimum 11 pt (VERIFIED, same page).

### 1.2 Tracking (VERIFIED, SF Pro table on the same page, units 1/1000 em and points)

Values for sizes Cellier will use most. Apply as `letter-spacing` in px (1 pt = 1 CSS px on the web).

| Size (pt) | Tracking (pt) | Tracking (em) |
|---|---|---|
| 11 | +0.06 | +6 |
| 12 | 0.00 | 0 |
| 13 | -0.08 | -6 |
| 15 | -0.23 | -16 |
| 16 | -0.31 | -20 |
| 17 | -0.43 | -26 |
| 20 | -0.45 | -23 |
| 22 | -0.26 | -12 |
| 28 | +0.38 | +14 |
| 34 | +0.40 | +12 |
| 40 | +0.37 | +10 |
| 96 | 0 | 0 |

The SF Pro table is the "SF Pro" (text/display) tracking. The same page also lists SF Pro Rounded, New York, SF Compact (watch), with separate values.

### 1.3 Optical sizes (VERIFIED for the tracking table; cutover size UNVERIFIED)

SF Pro is applied in two optical variants; the tracking table above is the one to copy. The exact cutover (Text vs Display, commonly cited as 19 pt) is UNVERIFIED on the fetched page. Apple's `font-optical-sizing: auto` behaviour on Safari for system fonts is UNVERIFIED.

### 1.4 System font on the web

- `font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;` is the usual stack. `-apple-system` resolves to SF on Apple platforms (SECONDARY, WebKit blog).
- `ui-rounded` (SF Pro Rounded), `ui-monospace` (SF Mono): generic families from CSS Fonts 4. Safari support not verified in this session (UNVERIFIED).
- `font: -apple-system-body` (SECONDARY, https://dynamictype.netlify.app and https://furbo.org/?p=2791): Safari has honoured the `-apple-system-*` font keywords since Safari 14 on Big Sur and iOS. Chrome does not. The shorthand also forces the system font, and setting `font-size` on the same element can break the Dynamic Type link. Put size on a child, or use `@supports`. Treat as a progressive enhancement, not a guarantee.
- Dynamic Type in a web app: no reliable, documented hook. Support for the setting through `-apple-system-body` is SECONDARY and was reported to fail on some iOS versions (iOS 11.1.2 report). Plan for `rem`-based type plus a user-facing text size if needed.

### 1.5 Token block (typography)

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, system-ui, "Helvetica Neue", sans-serif;
  --font-rounded: ui-rounded, var(--font-sans);
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;

  --text-large-title: 34px; --lh-large-title: 41px; --tr-large-title: 0.40px; --fw-large-title: 400;
  --text-title-1: 28px;     --lh-title-1: 34px;    --tr-title-1: 0.38px;     --fw-title-1: 400;
  --text-title-2: 22px;     --lh-title-2: 28px;    --tr-title-2: -0.26px;    --fw-title-2: 400;
  --text-title-3: 20px;     --lh-title-3: 25px;    --tr-title-3: -0.45px;    --fw-title-3: 400;
  --text-headline: 17px;    --lh-headline: 22px;   --tr-headline: -0.43px;   --fw-headline: 600;
  --text-body: 17px;        --lh-body: 22px;       --tr-body: -0.43px;       --fw-body: 400;
  --text-callout: 16px;     --lh-callout: 21px;    --tr-callout: -0.31px;    --fw-callout: 400;
  --text-subhead: 15px;     --lh-subhead: 20px;    --tr-subhead: -0.23px;    --fw-subhead: 400;
  --text-footnote: 13px;    --lh-footnote: 18px;   --tr-footnote: -0.08px;   --fw-footnote: 400;
  --text-caption-1: 12px;   --lh-caption-1: 16px;  --tr-caption-1: 0;        --fw-caption-1: 400;
  --text-caption-2: 11px;   --lh-caption-2: 13px;  --tr-caption-2: 0.06px;   --fw-caption-2: 400;
}
```

Tracking values for Large Title, Title 1 and Headline/Body are taken from the SF Pro tracking table at the nearest listed size (34, 28, 17). Check that the table row matches the size you ship. The Large Title/Title 1 tracking values above are reconciled from the table (34 pt = +0.40; 28 pt = +0.38).

---

## 2. System colours

### 2.1 Source and caveat

Source: https://developer.apple.com/design/human-interface-guidelines/color.md (changelog: updated system colour values June 9 2025; Liquid Glass guidance December 16 2025). Values below are the RGB numbers in the swatch names on that page, converted to hex by us. Apple states: "Avoid hard-coding system color values in your app... The actual color values may fluctuate from release to release." Use these as design reference, not as a runtime contract.

### 2.2 Chromatic colours (VERIFIED RGB, hex converted)

| Name | Light default | Dark default | Light, increased contrast | Dark, increased contrast |
|---|---|---|---|---|
| Red | #FF383C | #FF4245 | #E9152D | #FF6165 |
| Orange | #FF8D28 | #FF9230 | #C55300 | #FFA056 |
| Yellow | #FFCC00 | #FFD600 | #A16A00 | #FEDF43 |
| Green | #34C759 | #30D158 | #008932 | #4AD968 |
| Mint | #00C8B3 | #00DAC3 | #008575 | #54DFCB |
| Teal | #00C3D0 | #00D2E0 | #008198 | #3BDDEC |
| Cyan | #00C0E8 | #3CD3FE | #007EAE | #6DD9FF |
| Blue | #0088FF | #0091FF | #1E6EF4 | #5CB8FF |
| Indigo | #6155F5 | #6D7CFF | #564ADE | #A7AAFF |
| Purple | #CB30E0 | #DB34F2 | #B02FC2 | #EA8DFF |
| Pink | #FF2D55 | #FF375F | #E7124D | #FF8AC4 |
| Brown | #AC7F5E | #B78A66 | #956D51 | #DBA679 |

Note: systemBlue light is #0088FF on the current page (RGB 0,136,255). Older references show #007AFF (pre-2025 values). Use the 2025 value and mark the change.

### 2.3 Gray scale (VERIFIED, iOS/iPadOS UIKit gray set)

| Name | Light default | Dark default | Light, increased contrast | Dark, increased contrast |
|---|---|---|---|---|
| systemGray | #8E8E93 | #8E8E93 | #6C6C70 | #AEAEB2 |
| systemGray2 | #AEAEB2 | #636366 | #8E8E93 | #7C7C80 |
| systemGray3 | #C7C7CC | #48484A | #AEAEB2 | #545456 |
| systemGray4 | #D1D1D6 | #3A3A3C | #BCBCC0 | #444446 |
| systemGray5 | #E5E5EA | #2C2C2E | #D8D8DC | #36363A |
| systemGray6 | #F2F2F7 | #1C1C1E | #EBEBF0 | #242426 |

### 2.4 Labels, backgrounds, separators, fills

Label (`label`, `secondaryLabel`, `tertiaryLabel`, `quaternaryLabel`), system and grouped backgrounds, separator and fill colours: the Color page lists the semantic roles and UIKit names (VERIFIED: label, secondaryLabel, tertiaryLabel, quaternaryLabel, placeholderText, separator, opaqueSeparator, link; background set systemBackground / secondarySystemBackground / tertiarySystemBackground and grouped equivalents). **The numeric values for these are not in the fetched text: UNVERIFIED.** Do not copy values from memory. Read them from UIKit (`UIColor.label.resolvedColor(with:)` in each trait collection) or from the Apple Design Resources UI kit.

Rules from the page (VERIFIED):
- Use grouped backgrounds for grouped table views, system backgrounds otherwise.
- Primary background for the whole view, secondary for grouping, tertiary for grouping inside secondary.
- Do not use separator as text colour, or secondaryLabel as background.
- Do not use colour alone to convey state; provide text or glyph shapes too.
- Use system colours where possible; if you define custom colours, supply light, dark, and increased-contrast variants.

### 2.5 Token block (colour)

```css
:root {
  --sys-blue: #0088FF;   --sys-green: #34C759;  --sys-indigo: #6155F5; --sys-orange: #FF8D28;
  --sys-pink: #FF2D55;   --sys-purple: #CB30E0; --sys-red: #FF383C;    --sys-teal: #00C3D0;
  --sys-yellow: #FFCC00; --sys-mint: #00C8B3;  --sys-cyan: #00C0E8;    --sys-brown: #AC7F5E;

  --sys-gray: #8E8E93;  --sys-gray2: #AEAEB2; --sys-gray3: #C7C7CC;
  --sys-gray4: #D1D1D6; --sys-gray5: #E5E5EA; --sys-gray6: #F2F2F7;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --sys-blue: #0091FF;   --sys-green: #30D158;  --sys-indigo: #6D7CFF; --sys-orange: #FF9230;
    --sys-pink: #FF375F;   --sys-purple: #DB34F2; --sys-red: #FF4245;    --sys-teal: #00D2E0;
    --sys-yellow: #FFD600; --sys-mint: #00DAC3;  --sys-cyan: #3CD3FE;    --sys-brown: #B78A66;

    --sys-gray: #8E8E93;  --sys-gray2: #636366; --sys-gray3: #48484A;
    --sys-gray4: #3A3A3C; --sys-gray5: #2C2C2E; --sys-gray6: #1C1C1E;
  }
}
:root[data-theme="dark"] { /* same values as the dark block above */ }

@media (prefers-contrast: more) {
  :root { /* use the increased-contrast light or dark values from 2.2 and 2.3 */ }
}
```

`prefers-contrast: more` support in Safari is UNVERIFIED in this session; the tokens are correct regardless.

Labels and backgrounds: add `--label`, `--label-2`, `--label-3`, `--label-4`, `--bg`, `--bg-2`, `--bg-3`, `--grouped-bg` etc. once values are read from UIKit (UNVERIFIED).

---

## 3. Layout

- **Margins 16 and 20 pt, 8-point grid, 44 x 44 pt minimum hit target, corner radii:** the fetched Layout page (https://developer.apple.com/design/human-interface-guidelines/layout.md) does not contain these numbers. They are UNVERIFIED. Do not write them into tokens until checked against the live page or the Apple Design Resources templates.
- Layout guidance that IS on the page (VERIFIED): size classes, not device type, drive layout. Respect safe areas. Support text-size changes: horizontally adjacent views may need to stack, and rows must grow instead of clipping.
- List row heights: UNVERIFIED.

### 3.1 Corner radii and "continuous" (squircle) corners

- Apple's continuous corner is a superellipse curve, not a circular arc. The fetched pages do not give radius numbers (UNVERIFIED).
- `corner-shape: squircle` (CSS Borders 4): Chromium-based browsers only as of the 2026 sources found (Chrome and Edge 139+, SECONDARY, https://squircle.js.org/blog/squircles-in-css). Safari and Firefox: not supported in sources dated up to 2026-08 (SECONDARY, https://savvy.co.il/en/blog/css/css-corner-shape/). Safari support is UNVERIFIED against WebKit release notes.
- Fallback options:
  - Plain `border-radius` (use this as the default and the progressive base).
  - `@supports (corner-shape: squircle)` to upgrade in Chromium.
  - JS polyfill such as Hyperellipse (SECONDARY, https://hyperellipse.vercel.app/), which activates only where the property is missing. Adds JS cost; prefer for a small number of hero surfaces.
  - SVG clip path or `mask` with a superellipse path for static surfaces. Costs one asset per size.

### 3.2 Safe area, iPhone 13 to 15 Pro

| Device | Viewport (CSS px = pt) | Top inset (status/island) | Bottom inset | Island/notch |
|---|---|---|---|---|
| iPhone 15 Pro | 393 x 852 | 59 pt (VERIFIED, SECONDARY useyourloaf) | 34 pt (VERIFIED, SECONDARY) | Dynamic Island |
| iPhone 14 Pro | 393 x 852 | UNVERIFIED (expect 59) | UNVERIFIED (expect 34) | Dynamic Island |
| iPhone 13 | 390 x 844 | UNVERIFIED (expect 47) | UNVERIFIED (expect 34) | Notch |

Viewport sizes come from model lists (SECONDARY). iPhone 13 and 14 base models share 390 x 844 with a notch and a 47 pt status bar (SECONDARY). Use CSS `env(safe-area-inset-*)`; do not hard-code 59 or 47.

```css
.screen { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
```

Requires `<meta name="viewport" content="viewport-fit=cover">`.

---

## 4. Navigation patterns and Liquid Glass

What the HIG pages fetched support (VERIFIED from the Materials page, June 2025 and September 2025 revisions):
- Liquid Glass forms a functional layer for controls and navigation (tab bars, sidebars) that floats above content.
- "Don't use Liquid Glass in the content layer." Use standard materials for content backgrounds.
- "Use Liquid Glass effects sparingly." Limit to the most important functional elements.
- Regular variant for text-heavy components (alerts, sidebars, popovers); clear variant only over visually rich media, with a 35% dark dimming layer if the background is bright.
- Colour on glass: apply colour to the background of the primary action only, not to many controls.

Tab bars, large-title nav that collapses on scroll, sheets and detents, context menus, swipe actions, pull to refresh, search placement: not covered by the fetched pages (UNVERIFIED for specifics such as detent heights). Use Apple's Design Resources or a live device check.

Web implication: a floating tab bar with one glass surface is a reasonable imitation. Stacking many `backdrop-filter` layers is not (see section 5).

Concentric radii, "floating" margins for the tab bar, and exact glass parameters: UNVERIFIED.

---

## 5. Materials and vibrancy

- iOS standard materials (VERIFIED): ultra-thin, thin, regular (default), thick, used in the content layer. Vibrancy levels: label, secondaryLabel, tertiaryLabel, quaternaryLabel (avoid quaternary on thin and ultra-thin). Fills: fill, secondaryFill, tertiaryFill. Separator: one level.
- Use vibrant colours on top of materials; non-vibrant grey on a translucent button fails legibility (VERIFIED, example in Materials page).
- `backdrop-filter` on the web: Safari needs `-webkit-backdrop-filter` (prefix until Safari 18, SECONDARY). Support is broad on iOS.
- Cost (SECONDARY and community, no Apple measurement): keep blur radius modest (community range 8 to 16 px), limit the number of blurred elements on screen, avoid animating blurred layers, and profile on a real iPhone in Safari Web Inspector Timelines. No authoritative WebKit guidance was found for 2026.
- Reduce Transparency: `prefers-reduced-transparency` is not supported in Safari per web-features explorer and Chrome developer docs (SECONDARY, https://web-platform-dx.github.io/web-features-explorer/features/prefers-reduced-transparency). Plan a solid fallback class and make it the default for Safari reduction via user setting is impossible on the web; ship opaque surfaces as the baseline if the glass is decorative.
- Reduce Motion: `prefers-reduced-motion` is supported in Safari since 10.1 (SECONDARY). Use it.

```css
:root {
  --glass-blur: 12px;
  --glass-bg: color-mix(in srgb, var(--sys-gray6) 72%, transparent); /* UNVERIFIED tuning value */
}
.glass { background: var(--glass-bg); -webkit-backdrop-filter: blur(var(--glass-blur)); backdrop-filter: blur(var(--glass-blur)); }
@media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }
```

The 72% and 12 px values are design starting points, not Apple values (UNVERIFIED).

---

## 6. Iconography

### 6.1 SF Symbols licence (SECONDARY, not the licence text)

The official SF Symbols page (https://developer.apple.com/sf-symbols/) and terms index (https://developer.apple.com/support/terms/) do not reproduce the SF Symbols licence text in the fetched copy. Forum and blog quotes describe the licence as limited to "creating user interfaces for software products running on Apple's iOS, iPadOS, macOS, tvOS or watchOS operating systems", with a mock-up grey area, and a Developer Forums answer of "NO" for non-Apple platforms (https://developer.apple.com/forums/thread/757407, https://developer.apple.com/forums/thread/739523).

Conclusion for Cellier: **do not use SF Symbols in a web PWA.** A PWA runs on Android and desktop browsers as well as iOS. Treat this as the working position until you read the current licence text in the SF Symbols app.

### 6.2 Free alternatives

Licence check (SECONDARY, https://muz.li/blog/best-free-icon-libraries-for-ui-design-in-2026/, https://icon-sets.iconify.design):
- Lucide: ISC. Commercial use, no attribution required.
- Tabler: MIT.
- Iconoir: MIT.
- Phosphor: listed MIT, one source says Apache 2.0; check the repository LICENSE.
- Hugeicons: free set under MIT per Iconify; a paid Pro tier exists. Use only the free set.

### 6.3 Recommendation

Use **Lucide** (ISC, consistent 24 px grid, 2 px stroke that reads close to SF Symbols at body size). Pair with `stroke-width` 1.75 to 2 at 17 pt. Keep Phosphor as a fallback for a filled variant if a glyph is missing. Do not mix libraries in one screen.

---

## 7. Colour, contrast, accessibility media queries

- Contrast and differentiation: use the increased-contrast palette in 2.2 and 2.3; the page recommends it when "the color differences become far more apparent" (VERIFIED).
- Never rely on colour alone (VERIFIED).
- Dark mode: system colours already adapt; for custom colours supply light, dark and increased-contrast variants (VERIFIED).
- WCAG contrast ratios for text: UNVERIFIED on the fetched pages. Use WCAG 2.2 AA (4.5:1 body, 3:1 large) as the baseline; verify each token pair with a checker.
- Media queries: `prefers-color-scheme` (supported), `prefers-reduced-motion` (supported in Safari, SECONDARY), `prefers-contrast` (Safari support UNVERIFIED), `prefers-reduced-transparency` (not supported in Safari, SECONDARY).

---

## 8. Apple Design Awards: what the winners share

Source: https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/ (announced June 2 2026). The 2026 programme has no Productivity category (SECONDARY, MacStories/9to5Mac coverage). Utility and productivity winners therefore could not be sampled from 2026; 2024 and 2025 were not researched in this pass (UNVERIFIED for those years).

Five concrete examples, with the detail Apple's newsroom gives:

1. **Moonlitt: Moon Phase Tracker** (Flipping Hues, Interaction). Apple cites "best-in-class Liquid Glass integration" and easy onboarding for tracking celestial events.
2. **Sago Mini Jinja's Garden** (Sago Mini, Interaction, Apple Arcade game). "Effortless swipe-to-move controls" so kids explore without reading instructions. Lesson: one gesture, no tutorial text.
3. **grug** (Ocho, Delight and Fun). Daily prompts delivered as a single short reflective moment ("a small but meaningful moment of reflection"). Lesson: restraint in copy and cadence.
4. **Guitar Wiz** (Bijoy Thangaraj, Inclusivity). Uses Dynamic Type, Increased Contrast, and Differentiate Without Color, with spoken guidance. Lesson: system accessibility settings wired from the start, not added later.
5. **Tide Guide: Charts & Tables** (Condor Digital, Visuals and Graphics). Full-screen tide charts with custom animation, Liquid Glass styling, and a palette that matches the sky. Lesson: one restrained palette derived from context.

Also named: "Is This Seat Taken?" (Poti Poti Studio, Delight and Fun game), Pine Hearts (Inclusivity game, adjustable motion and haptics).

Common thread (inference from the above, flagged as analysis): one dominant gesture or interaction, system typography and accessibility wired in, restrained colour that carries meaning, and Liquid Glass used on navigation rather than content.

---

## 9. Open items to verify before shipping

1. Label, background, separator, fill values (section 2.4): read from UIKit or Apple Design Resources.
2. 16/20 pt margins, 44 pt hit target, corner radii, list row heights (section 3): check the live Layout page or Design Resources.
3. iPhone 13 and 14 Pro insets (section 3.2): measure on device or from Apple's device specs.
4. Safari support for `corner-shape`, `prefers-contrast`, `-apple-system-body` on current iOS: check WebKit release notes and Can I Use.
5. SF Symbols licence text: read the current agreement in the app.
6. Liquid Glass numeric parameters and tab bar geometry: check the Liquid Glass adoption guide and WWDC25 session 219 and 356.

## Sources

- https://developer.apple.com/design/human-interface-guidelines/typography.md
- https://developer.apple.com/design/human-interface-guidelines/color.md
- https://developer.apple.com/design/human-interface-guidelines/layout.md
- https://developer.apple.com/design/human-interface-guidelines/materials.md
- https://developer.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/ (mirror: https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/)
- https://developer.apple.com/forums/thread/757407 (SF Symbols licence quote, SECONDARY)
- https://developer.apple.com/forums/thread/739523 (SECONDARY)
- https://squircle.js.org/blog/squircles-in-css (SECONDARY)
- https://savvy.co.il/en/blog/css/css-corner-shape/ (SECONDARY)
- https://hyperellipse.vercel.app/ (SECONDARY)
- https://web-platform-dx.github.io/web-features-explorer/features/prefers-reduced-transparency (SECONDARY)
- https://dynamictype.netlify.app and https://furbo.org/?p=2791 (SECONDARY, `-apple-system-body`)
- https://useyourloaf.com/blog/iphone-15-screen-sizes/ (SECONDARY, device sizes)
- https://muz.li/blog/best-free-icon-libraries-for-ui-design-in-2026/ (SECONDARY, icon licences)
