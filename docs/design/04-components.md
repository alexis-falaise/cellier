# 04 — Component inventory

This is the list of components the implementers build for Cellier. Each entry gives the component's purpose, its
variants, states, props (TypeScript-style, informal), accessibility notes and the motion preset it uses. Colour,
type and spacing tokens are in `01-design-system.md` and `tokens.css`. Motion presets (`press`, `snappy`, `smooth`,
`push`, `sheet`, `fling`, `pop`, `reduced`) and the four haptic sites are defined in `02-motion-haptics.md`.
Screens that use each component are in `03-screens.md`.

Conventions that apply to every component:

- **Built on** React 19 + Motion for React (`m` components inside `LazyMotion`), Tailwind v4 classes that read the
  tokens. No component-library dependency: sheets, toasts, steppers and segmented controls are written in-house.
- **Press feedback** starts on `pointerdown` and uses the `press` preset (scale values in `02`). The action commits
  on `pointerup` inside the target (with a 10 px slop), so the user can cancel by sliding away.
- **Only `transform` and `opacity` animate.** Colour, border and background state changes use a 150 ms CSS
  transition.
- **Touch targets** are at least 44 × 44 px, even when the visible element is smaller (extend the hit area with
  padding or a pseudo-element).
- **Accessibility**: every interactive element has a French accessible name; icon-only buttons carry an
  `aria-label`. Focus is shown with the `focus-ring` token through `:focus-visible` only. Text is in `rem` so it
  scales with the user's text-size setting.
- **Reduced motion**: `MotionConfig reducedMotion="user"` is set at the root; components that move along a path
  switch to the `reduced` opacity cross-fade.
- **Strings** come from the typed `fr.ts` catalogue (keys in `03-screens.md`, copy deck appendix), never inline.

---

## 1. App shell and navigation

### AppShell
- **Purpose**: root layout. Holds the active tab's stack, the tab bar, the scan button, the toast region and the
  sheet stack.
- **Behaviour**: applies `env(safe-area-inset-*)` padding; renders the last snapshot from IndexedDB on the first
  frame (no splash spinner); hosts the hidden haptic switch (see `Haptics` below).
- **Props**: `children`.
- **Accessibility**: one `<main>` per visible screen; the tab bar is a `<nav aria-label="Navigation principale">`.

### TabBar
- **Purpose**: switch between Accueil, Stock and Courses.
- **Form**: a floating 60 px capsule (bottom offset: safe-area inset − 12 px, i.e. 22 px on Face ID iPhones),
  with the `ScanButton` detached at its trailing end. Three tabs, Lucide `house`, `package`, `shopping-basket`,
  label under the icon (10 px tab-label role).
- **States**: selected (accent icon and label on a selection capsule that slides with `snappy`), unselected
  (`label-secondary`). No badges (`03` §3.1).
- **Material**: `material` token (86 % opaque) with blur; solid with `prefers-reduced-transparency`.
- **Motion**: tab change is instant (no screen cross-fade); the selected icon scales with `snappy` on press only.
  Tapping the selected tab scrolls its screen to top with `smooth`, then pops its stack to the root.
- **Props**: `active: 'accueil' | 'stock' | 'courses'`.
- **Accessibility**: `role="tablist"` is not used (these are navigation links): each tab is a link with
  `aria-current="page"` when selected.

### ScanButton
- **Purpose**: the primary entry point to the scanner; a circular accent-filled button detached from the trailing
  end of the tab bar.
- **Size**: 60 px circle, Lucide `scan-barcode` 28 px, label colour `on-accent`; elevation level 2.
- **Gestures**: tap → scanner in add mode. Long-press of 450 ms → scanner in withdraw mode; while held the button
  shrinks from 0.96 to 0.90 and its icon cross-fades to the withdraw glyph at 300 ms. The camera starts on finger
  lift, because a timer-fired long-press does not count as a user gesture for `getUserMedia`.
- **States**: default, pressed, long-press in progress, disabled (no pantry yet — hidden instead of disabled).
- **Motion**: `press` (scale 0.96); the scanner cover grows from the button's rect (`smooth`).
- **Props**: `onScan(mode: 'add' | 'withdraw')`.
- **Accessibility**: `aria-label="Scanner un produit"`; a second action exposed through
  `aria-description="Appui long pour retirer du stock"`; VoiceOver users get the mode switch inside the scanner.

### LargeTitleHeader
- **Purpose**: iOS-style large title that collapses into a compact inline title on scroll.
- **Content**: title in the display serif (Large Title, 34 px), optional `PantrySwitcher` as the title, trailing
  accessory slot (avatar, sort menu, add button), optional search field below the title.
- **States**: expanded, collapsed (compact 17 px semibold title in the sans, translucent bar material appears with a
  scroll-edge fade instead of a hard divider).
- **Motion**: scroll-linked (no spring): the large title translates and fades 1:1 with scroll; the compact title
  fades in over the last 12 px of travel.
- **Props**: `title: string | ReactNode`, `trailing?: ReactNode`, `search?: SearchFieldProps`.
- **Accessibility**: the large title is the page `<h1>`; the compact title is `aria-hidden` (no duplicate heading).

### NavBar (pushed screens)
- **Purpose**: compact header for pushed screens (item detail, settings pages inside the Réglages sheet).
- **Content**: back button (Lucide `chevron-left` + previous screen's title, truncated to "Retour" if longer than
  12 characters), centred title, trailing action slot.
- **Motion**: belongs to the pushed screen and moves with it (`push`).
- **Accessibility**: back button label "Retour vers {titre}".

### ScreenStack
- **Purpose**: per-tab push/pop container driven by TanStack Router.
- **Motion**: push slides the new screen in from the right with `push`; the parent shifts left by 30 % and dims;
  pop reverses along the same path. Left-edge swipe-to-pop follows the finger 1:1 and releases with `fling`
  (parameters in `02`).
- **Props**: `children` (route outlet).

### PantrySwitcher
- **Purpose**: shows the current pantry name as the large title and opens the pantry menu.
- **Variants**: single pantry (plain title, not interactive), several pantries (title + Lucide `chevron-down`
  17 px), "Tous les celliers" option in Stock only if `03` defines it.
- **Motion**: chevron rotates 180° with `snappy` while the menu sheet is open.
- **Props**: `pantries: Pantry[]`, `currentId: string`, `onChange(id)`.
- **Accessibility**: a button with `aria-haspopup="dialog"`, label "Cellier actuel : {nom}. Changer de cellier".

### AvatarButton
- **Purpose**: the signed-in member's Google photo (or initials on a neutral fill) at the top-right of Accueil;
  opens the Réglages sheet. Also used in member lists and history entries.
- **Sizes**: 32 px (header), 40 px (member row), 20 px (history entry).
- **Accessibility**: header variant label "Réglages"; member variants are decorative next to the name.

---

## 2. Surfaces

### SheetContainer
- **Purpose**: the single bottom-sheet primitive for every sheet (edit, pantry menu, Réglages, primers,
  confirmations, quantity entry).
- **Variants**: detents `medium` (≈ 50 % of the viewport) and `large` (top at the safe-area inset + 10 px);
  `fit` (height of content, for confirmations). Stacked: when a sheet opens over another, the parent scales down and
  dims (values in `02`); the app behind the first sheet only dims.
- **Anatomy**: grabber (36 × 5 px, radius full, `label-tertiary`), optional header (title Headline centred,
  leading "Annuler" / trailing "OK" or close `x` button), scrollable body, optional sticky footer with the primary
  button above the home indicator.
- **States**: opening, open at a detent, dragging, closing; dirty (has unsaved edits → a drag or tap on the scrim
  asks for confirmation through a `ConfirmDialog` instead of discarding).
- **Gestures**: drag on the grabber/header always moves the sheet; drag on the body moves the sheet only when the
  body is scrolled to the top. Release uses velocity sign + projection to pick the detent or dismiss.
  Rubber-band above the top detent.
- **Motion**: `sheet` without velocity, `fling` on drag release; scrim opacity follows sheet position. Haptic site 2
  fires once when a drag crosses the dismiss threshold.
- **Props**: `open`, `onOpenChange`, `detents?: ('medium'|'large'|'fit')[]`, `initialDetent?`, `title?`,
  `dirty?: boolean`, `footer?: ReactNode`, `children`.
- **State source**: open state lives in the URL search params (`?sheet=…`), so the hardware/gesture back closes it.
- **Accessibility**: `role="dialog"`, `aria-modal="true"`, labelled by its title; focus moves to the first field or
  the title on open and returns to the trigger on close; `Escape` closes; the grabber is a button labelled
  "Fermer" for VoiceOver users (a drag is not discoverable).

### ScannerCover
- **Purpose**: the scanner's full-screen container (route state `?cover=scan&mode=add|withdraw`): true black, covers the tab bar, respects safe areas for its controls.
- **Motion**: grows from the `ScanButton` rect (scale + opacity, `smooth`), closes back into it; swipe-down on the
  top area closes with `fling`.
- **Props**: `open`, `onClose`, `originRect`.
- **Accessibility**: `role="dialog"`, `aria-modal="true"`, `aria-label="Scanner"`.

### Card
- **Purpose**: a grouped surface on Accueil (running-low section, next-groceries card).
- **Anatomy**: `surface` token, radius 20, 16 px padding, optional header row (title Headline,
  trailing "Tout voir" link).
- **Motion**: appears with `smooth` (opacity 0→1, y 8→0) only on its first appearance in a session.
- **No shadow** (elevation 0).

### InsetGroupedList / ListSection
- **Purpose**: iOS Settings-style sections used by Stock, item detail, Réglages, categories, members.
- **Anatomy**: section header (Footnote, `label-secondary`, uppercase not used — sentence case), rows on a
  radius-14 surface with inset separators starting after the leading icon, optional section footer (Footnote).
- **Props**: `header?`, `footer?`, `children`.

### ListRow
- **Purpose**: generic settings/navigation row.
- **Variants**: navigation (trailing `chevron-right`), value (trailing secondary text), toggle (trailing `Switch`),
  destructive (label in `danger`), button (accent label).
- **Size**: minimum 52 px high; leading icon tile 30 px optional.
- **Motion**: no scale (rows are joined segments of a group and carry swipe gestures): the highlight fill turns on at pointer-down and fades out over 150 ms.
- **Accessibility**: navigation rows are links; toggle rows expose the switch as the control with the row text as
  its label.

---

## 3. Inventory and items

### ItemRow
- **Purpose**: one product in a pantry, used in Stock, search results and Accueil's running-low list.
- **Anatomy (60 px minimum)**: `CategoryTile` 36 px · name (Body, one line, truncated) over a secondary line
  (Subhead `label-secondary`: brand · size, or "≈ 4 j" forecast in the running-low variant) · trailing quantity
  (rounded tabular, Title 3) with unit if not "pièce" · `RunningLowMarker` dot before the quantity when low.
- **Variants**: `stock` (default), `low` (forecast secondary line, amber marker), `compact` (search results,
  52 px, no tile).
- **States**: default, pressed, pending sync (quantity shows normally; a small `SyncDot` appears only if the change
  is older than 30 s and still unsent), quantity zero (quantity in `label-tertiary`, "Épuisé" secondary line).
- **Gestures**: tap → item detail (push); `SwipeActions` for quick withdraw / add (actions defined in `03`).
- **Motion**: highlight fill on press (no scale, as `ListRow`); quantity change uses `QuantityNumber` (`pop`); insert/remove in a list uses `smooth`
  (opacity + y, never height).
- **Props**: `item: ItemView`, `variant`, `onPress`, `onQuickAdjust(delta)`.
- **Accessibility**: one accessible element reading "{nom}, {quantité} {unité}, {catégorie}[, bientôt épuisé]";
  swipe actions are also exposed as VoiceOver custom actions ("Retirer 1", "Ajouter 1").

### CategoryTile
- **Purpose**: the category's Lucide icon on its tinted rounded square.
- **Sizes**: 30 px (settings rows, icon 17 px), 36 px (item rows, icon 20 px), 56 px (item detail, editor, icon
  28 px). Radius 10 at 36 px (scale proportionally).
- **Colours**: tile tint and icon foreground from the category's colour token (light/dark pairs in `tokens.css`).
- **Props**: `category: Category`, `size: 30 | 36 | 56`.
- **Accessibility**: decorative (`aria-hidden`) when the category name is said elsewhere in the row.

### ProductImage
- **Purpose**: product photo from Open Food Facts in a 1:1 rounded frame.
- **Fallback**: `CategoryTile` at the same size when there is no image or it fails; images are lazy and cached by
  the service worker.
- **Accessibility**: `alt=""` (the name is adjacent).

### QuantityNumber
- **Purpose**: renders a quantity in rounded tabular numerals and animates changes.
- **Motion**: on change, the new value replaces the old with `pop` (scale 0.85→1, opacity 0→1 for the incoming
  digits, outgoing digits move y −6 px and fade); direction of travel follows the sign of the change (up for
  additions, down for withdrawals). Reduced motion: cross-fade.
- **Props**: `value: number`, `unit?: string`, `size: 'row' | 'stepper' | 'badge'`.
- **Accessibility**: `aria-live="polite"` only inside the stepper, not in list rows.

### QuantityStepper
- **Purpose**: change a quantity in place (scanner tray, item detail, quantity sheet).
- **Anatomy**: minus button · `QuantityNumber` (stepper size) · plus button; each button 44 × 44 px with a
  32 px visible circle on `fill-secondary`. Tapping the number opens a numeric keypad entry (`inputmode="numeric"`).
- **Behaviour**: press-and-hold repeats after 400 ms, accelerating every 1 s (cap 10 steps/s); minimum 0 (or 1 in
  the scanner tray, where reaching 0 removes the item with undo); no haptic per step (frequency rule).
- **Props**: `value`, `onChange`, `min?`, `max?`, `step?` (1 by default; decimals not supported), `size: 'regular'
  | 'large'`.
- **Accessibility**: `role="spinbutton"` with `aria-valuenow/min/max`, labelled "Quantité"; increment/decrement on
  VoiceOver swipe up/down.

### RunningLowMarker
- **Purpose**: amber 8 px dot (plus text in detail views) marking an item at or below its minimum or forecast to run
  out soon.
- **Motion**: appears with `smooth` (scale 0.6→1, opacity) when an item becomes low while visible.
- **Accessibility**: not colour-only — the row's accessible name and secondary line carry "bientôt épuisé".

### ForecastBadge
- **Purpose**: shows days of cover honestly: "≈ 4 j", "≈ 2 sem.", "Épuisé", or "Pas assez d'historique".
- **Variants**: `inline` (secondary line), `detail` (with the 80 % run-out band, e.g. "entre le 18 et le 22 nov.").
- **Props**: `daysOfCover?: number`, `band?: [Date, Date]`, `confidence: 'low' | 'ok'`.
- **Accessibility**: expands "≈ 4 j" to "environ 4 jours" in the accessible name.

### SwipeActions
- **Purpose**: horizontal swipe on a Stock row: leading swipe «+1» (purchase), trailing swipe «−1» (consume).
  Actions are 76 px wide (thresholds in `02`).
- **Gestures**: axis lock after the drag threshold; reveal width and commit fraction in `02`; full swipe commits.
  Haptic site 2 fires once when crossing the commit threshold.
- **Motion**: row follows the finger 1:1; release with `fling`; action icon scales up as the commit threshold
  approaches.
- **Props**: `leading?: SwipeAction`, `trailing?: SwipeAction`, `children`.
- **Accessibility**: actions duplicated as VoiceOver custom actions and inside the item detail.

### SearchField
- **Purpose**: diacritic-insensitive search in Stock (and the icon picker).
- **Anatomy**: 36 px high, radius 10, `fill-tertiary`, Lucide `search` leading, clear button `x` when filled,
  "Annuler" text button appears to the right while focused.
- **Motion**: none on typing (frequency rule); the "Annuler" button slides in with `snappy`.
- **Props**: `value`, `onChange`, `placeholder` (e.g. "Rechercher dans le stock").
- **Accessibility**: `type="search"`, `enterkeyhint="search"`, labelled by its placeholder text.

### StockViewSheet (sort and group)
- **Purpose**: chooses sort (nom, catégorie, récent, prix, quantité) and grouping in Stock.
- **Form**: a trailing header button (Lucide `arrow-up-down`) opening a `fit` sheet with two `SegmentedControl` or
  radio lists; current choice persists per device.
- **Accessibility**: radio groups with labels "Trier par" and "Grouper par".

### SectionIndex (optional, later)
- Not built for v1; grouped lists use sticky section headers instead.

---

## 4. Scanner

### CameraViewport, ScannerTopBar, TorchButton, LowLightHint
- **Purpose**: the content of `ScannerCover`: camera preview, reticle, mode control and tray. Overlays inside the
  scanner are component state, not URL state, because a URL change while the camera runs can stop it (`03` §9).
- **Anatomy (top to bottom)**: top bar (close `x`, `SegmentedControl` Ajouter/Retirer, torch `flashlight` /
  `flashlight-off`) · camera preview full-bleed · `Reticle` centred at 40 % of the height · target pantry chip
  ("Dans : Cellier", tap to change) · `ScannerTray` · "Terminer" primary button.
- **States**: requesting camera, camera denied, camera unavailable, scanning, low light (hint after 3 s without a
  read), paused (sheet open over it).
- **Props**: `mode`, `pantryId`, `onDone(lines)`.
- **Accessibility**: live region announces each recognised product ("{nom} ajouté, quantité 1"); every control is
  reachable without the camera.

### Reticle
- **Purpose**: shows the read region (the cropped region of interest) as four rounded corners, not a full box.
- **States**: idle (white 70 %), reading (corners tighten), success (corners flash accent, then return), failure /
  unknown (corners turn amber for 600 ms; no shake, because an unknown product is not the user's error).
- **Motion**: `snappy` for tighten/success; no looping animation while idle (no scanning laser line).

### ScannerTray
- **Purpose**: the list of products scanned in this session, newest on top, on a dark material panel at the bottom.
- **Anatomy**: up to 3 visible `ScannerTrayRow`s, then the tray scrolls; a header line "3 produits · 7 articles".
- **Motion**: a new item arrives from the reticle position into the top of the tray with `smooth`, its count badge
  with `pop`; haptic site 1 fires on the same frame (when allowed, see `02`).
- **Props**: `lines: ScanLine[]`, `onChange(lineId, qty)`, `onRemove(lineId)`.

### ScannerTrayRow
- **Anatomy**: `ProductImage` / `CategoryTile` 36 px · name + size · `QuantityStepper` (regular) · status line for
  lookups ("Recherche…", "Produit inconnu — Compléter", "Seulement 1 en stock").
- **States**: recognising, found (local / catalogue / online — source is not shown here), unknown (amber, opens
  `UnknownProductSheet`), variable-measure code (opens manual entry), withdraw exceeds stock (amber note, quantity
  capped to available).

### UnknownProductSheet
- **Purpose**: minimal manual entry when a code is not found: name (required), category (picker), optional size.
- **Uses**: `SheetContainer` (medium), `TextField`, `CategoryPicker`, primary "Ajouter".

---

## 5. Groceries and home

### «Bientôt épuisé» section (a `ListSection` of `ItemRow` `low`)
- **Purpose**: Accueil's first section: items running low, most urgent first, as `ItemRow` `low` variant (max 5,
  then "Tout voir ({n})").

### NextTripCard
- **Purpose**: Accueil's next-groceries summary: likely date ("Prochaines courses · samedi 16 nov."), item count,
  first 3 item names, link to the Courses tab.
- **States**: no cadence yet (date replaced by a plain explanation), nothing to buy.

### GroceryRow
- **Purpose**: one suggested item in Courses: check circle · name · suggested quantity ("× 3") · reason line
  ("Sous le minimum" / "Épuisé vers le 18 nov.").
- **States**: suggested, checked (strike-through is not used: the row drops to 50 % opacity and moves to the
  «Dans le panier» section with `smooth`; checking does not add stock — «Ranger» or a scan does), manual addition.
- **Motion**: check mark draws with `snappy`.
- **Accessibility**: checkbox semantics; label includes quantity.

---

## 6. Controls

### Button
- **Variants**: `primary` (accent fill, `on-accent` label, 50 px high, radius 14, full width in sheets),
  `secondary` (`fill-secondary`, accent label), `plain` (text only, accent), `destructive` (danger label or fill
  in confirmations), `icon` (44 px target, 20–24 px glyph).
- **States**: default, pressed, disabled (40 % opacity, no press motion), loading (label replaced by a 17 px
  spinner; width does not change).
- **Motion**: `press` (0.97 for text buttons, 0.92 for icon buttons).

### SegmentedControl
- **Purpose**: two to five mutually exclusive options (Ajouter/Retirer, sort, detent-free filters).
- **Anatomy**: 32 px high track on `fill-tertiary`, selected thumb on `bg-elevated` with level-1 shadow
  (on the scanner: dark material track, white thumb).
- **Motion**: thumb moves with `snappy` via shared layout; interruptible; the label swap is instant.
- **Accessibility**: `role="radiogroup"` with radios; arrow keys move selection.

### Switch
- **Purpose**: on/off settings. Uses the native `<input type="checkbox" switch>` on Safari 17.4+ (which also gives
  the platform haptic — haptic site 3), styled with the accent; a custom fallback elsewhere.
- **Accessibility**: native semantics.

### TextField
- **Variants**: single line, numeric (`inputmode="decimal"` for prices, `numeric` for quantities), with unit suffix.
- **Anatomy**: inside an inset grouped row: label left (Body), value right-aligned or full-width input below a
  section header; inline validation message under the row in `danger` (Footnote).
- **Override indicator**: when a value overrides the reference data, a small "Modifié" tag and a "Rétablir" button
  (resets to the catalogue value) appear.
- **Accessibility**: visible label always (no placeholder-only fields); errors linked with `aria-describedby`.

### CategoryPicker
- **Purpose**: choose a category: a grid of `CategoryTile` 56 px with names, 4 columns, inside a sheet; current
  selection ringed in accent.

### IconPicker / ColorSwatchPicker
- **Purpose**: categories editor: a curated grid of Lucide icons (about 60, defined in `01`) with `SearchField`;
  a row of the category colour swatches (28 px circles, selected one ringed).
- **Accessibility**: icons labelled in French (the picker keeps a French label per icon).

### Menu
- **Purpose**: short action lists (item actions, pantry menu) presented as a `fit` sheet with `ListRow`s rather than
  a floating popover, for thumb reach and consistency.

### ConfirmDialog
- **Purpose**: the only blocking confirmation, reserved for destructive and irreversible actions (delete pantry,
  remove member, leave household, discard edits). Presented as a `fit` sheet with a destructive primary button and
  "Annuler".
- **Haptic**: site 4 fires when the destructive action is confirmed.

---

## 7. Feedback and status

### Toast
- **Purpose**: transient confirmations with optional undo («3 articles ajoutés à Cave · Annuler»; exact strings in the `03` copy deck).
- **Placement**: bottom, above the tab bar and scan button; one at a time (a new one replaces the old, which leaves
  with `smooth`); 4 s visible, 6 s when it carries "Annuler"; paused while pressed.
- **Motion**: in with `smooth` (y 16→0, opacity), out the same way; swipe down to dismiss with `fling`.
- **Accessibility**: `role="status"` (`aria-live="polite"`); the undo button is reachable and extends the timer to
  10 s when focused by VoiceOver.

### SyncIndicator
- **Purpose**: the single place where sync and offline state is shown.
- **Placement and copy**: defined in `03-screens.md` (global states). A small capsule directly under the large title;
  hidden when everything is synced.
- **States**: synced (hidden), offline ("Hors ligne"), pending ("{n} modifications en attente"), syncing (spinner,
  shown only after 1 s), error ("Synchronisation impossible · Réessayer").
- **Motion**: appears/disappears with `smooth` (opacity + y 4 px); state changes inside it are cross-fades.
- **Accessibility**: `role="status"`; tapping it opens a small sheet explaining the state.

### SyncDot
- **Purpose**: per-row marker (6 px, `label-tertiary` hollow circle) for a change still unsent after 30 s.

### StatusBanner
- **Purpose**: persistent, dismissible notices at the top of a screen's content (install guidance in Safari,
  notifications denied, removed from household). Neutral surface, Lucide icon, one line of text, one action.

### EmptyState
- **Purpose**: empty screens and sections: a 56 px Lucide glyph in a tinted circle, a title (Title 3), one sentence
  (Subhead `label-secondary`) and at most one primary action.
- **No illustrations** (system policy in `01`).

### Spinner
- **Purpose**: indeterminate progress, used only for network-bound waits longer than 1 s (sign-in, online lookup,
  invite creation). Never for local-store loads.
- **Motion**: CSS rotation (allowed exception: continuous indicator), stops under reduced motion and shows "…" text.

### PullToRefresh
- **Purpose**: on Accueil and Stock, triggers a pull of remote changes (the app also pulls automatically).
- **Motion and thresholds**: in `02`; no haptic (not one of the four sites).

---

## 8. Onboarding and permissions

### OnboardingPage
- **Purpose**: full-screen step with the wordmark or a large glyph, a serif title, one paragraph, a primary button.
- **Motion**: steps advance with `push`; content within a step enters with `smooth`, staggered 40 ms.

### InstallGuide
- **Purpose**: shown in Safari (not standalone): three numbered steps with the Share glyph (Lucide `share`) and
  "Sur l'écran d'accueil" (`square-plus`), an arrow pointing to the Safari toolbar, and "Continuer dans Safari".

### GoogleSignInButton
- **Purpose**: wraps the Google Identity Services button; must follow Google's branding rules (white or dark theme,
  pill shape, "Se connecter avec Google"), so it is the one control that does not use the accent.

### PermissionPrimer
- **Purpose**: a sheet shown before a system permission prompt (camera, notifications) explaining why, with
  "Autoriser" (triggers the real prompt from this tap) and "Plus tard".
- **Denied variant**: explains how to re-enable in iOS Réglages.

---

## 9. Utilities (non-visual)

### Haptics
- **Purpose**: `haptic()` function plus the hidden `<label><input type="checkbox" switch></label>` mounted once
  in `AppShell`. Implements the four sites only, the user-activation rule, the throttle and the "Retours
  haptiques" setting (all in `02`). `navigator.vibrate` on other platforms; no-op otherwise.

### useSpring presets
- **Purpose**: one module exporting the preset transition objects (`press`, `snappy`, `smooth`, `push`, `sheet`,
  `fling`, `pop`, `reduced`) so no component declares its own spring values.

### Gesture helpers
- **Purpose**: `project(velocity, decelerationRate = 0.998)`, `rubberband(overshoot, dimension, c)`, axis-lock
  and threshold helpers shared by `SheetContainer`, `SwipeActions`, `ScreenStack`, `Toast`.

---

## 10. Components named in `03-screens.md` and not detailed above

These follow the same conventions; their layout, copy and states are specified where they appear in
`03-screens.md`. The motion column gives the preset.

| Component | Purpose | Motion |
|---|---|---|
| `TabBarItem`, `BackButton`, `IconButton` | Parts of `TabBar` and `NavBar`, and the icon variant of `Button`. | `press` |
| `SectionHeader`, `SectionFooter` | Text above and below a `ListSection` (Footnote, `label-secondary`). | none |
| `ActivityRow`, `HistoryRow` | One stock movement: who, what, how many, when (Activity screen, item history). | `smooth` on insert |
| `AttentionRow` | A decision to take in the SyncSheet «À vérifier» section (quarantined or clamped change). | `smooth` |
| `MemberRow` | Household member: avatar 40 px, name, role («Propriétaire» or «Membre»). | highlight |
| `PropertyRow` | Item detail property: label, value, `SourceCaption`. | highlight |
| `SourceCaption`, `ResetOverrideButton` | Where a value comes from (Open Food Facts, Open Prices, entered by hand) and the reset to the reference value. | `snappy` |
| `OptionCard` | 76 px choice row in onboarding (create or join a household). | `press` |
| `SkeletonRow` | Placeholder rows used only during the first sync after sign-in, when the local store is empty; never for local reads. | `reduced` fade-out |
| `CheckCircle` | The check control of `GroceryRow`. | `snappy` |
| `ChipGroup` | Tappable suggestions (pantry names «Cave», «Cuisine»…). | `press` |
| `ForecastBand` | The 80 % run-out range on item detail. | none (functional data does not animate) |
| `InviteCodeDisplay` | 8-character invite code in rounded tabular numerals, with copy and share. | `snappy` on copy |
| `Wordmark` | «Cellier» in the display serif. | `smooth` in onboarding |
| `ProductHeader` | Item detail hero: 112 px photo or tile, serif name, brand and size. | moves with the screen (`push`) |
| `NotificationPromptCard` | Inline Accueil card asking for notifications after the first scan session. | `smooth` |
| `InstallStep` | One numbered step of `InstallGuide`. | `smooth`, 40 ms stagger |
| `PantryPicker` | Choose a target pantry (scanner, move, put-away). | `snappy` |
| `QuantityKeypad` | Numeric entry opened by tapping a stepper's number. | `sheet` |
| Named sheets: `PantryMenuSheet`, `SettingsSheet`, `ItemEditSheet`, `RecountSheet`, `MoveSheet`, `NewItemSheet`, `PutAwaySheet`, `NotificationPrimerSheet`, `InstallGuideSheet`, `SyncSheet`, `StoreCodeSheet`, `ManualEntrySheet` | Instances of `SheetContainer` with the detents listed in `03` §1.3 and `02` (sheet detents table). | `sheet` / `fling` |
