# 02 — Motion and haptics

Cellier, household pantry / basement inventory PWA, installed to the iOS Home Screen.
Targets: iPhone 13, 14, 15 (60 Hz) and iPhone 13 Pro, 14 Pro, 15 Pro (ProMotion, up to 120 Hz), iOS 16.4+.

This document is the binding motion and haptics specification. It obeys the shared design brief (now merged into `README.md`, section Foundations) (preset names and
parameters, navigation model, haptic sites, voice) and `docs/architecture/00-decisions.md` (Motion for React with
`LazyMotion` + `m`, `MotionConfig reducedMotion="user"`, own sheets / toasts / steppers built on Motion, TanStack
Virtual lists, sheets in search params). Research inputs: `docs/research/18`, `19`, `20`, `10`, `08`, `21`.

Legend used below:

- **[derived]**: a value computed in this document from a stated formula. Re-check it if the formula's source changes.
- **UNVERIFIED**: a behaviour this document relies on but that no research note confirmed on a real device.
  Each one has a device test in section 10.
- Every number in this file is a design decision unless it is tagged with a source. Implementers do not invent
  other values: if a case is missing, use the closest row of the choreography table and record the gap.

---

## 0. Motion thesis

Cellier's mood is "a cool, quiet Nordic pantry with good light". Motion follows the same restraint: everything that moves
is a critically damped spring, nothing bounces unless the finger threw it, and the app has exactly one authored moment.

- **Focal moment: scan success.** A barcode is recognised, the reticle tightens, the product drops into the tray, the
  count pops, and (where iOS allows it) the phone ticks, all on the same frame. This is the moment the product exists
  for, repeated dozens of times in a batch session, so it must be short (under 300 ms of visible motion), legible
  without looking straight at the screen, and never tiring.
- **Continuity:** sheets rise from and return to the bottom edge; pushed screens enter from and leave to the right; the
  scanner cover grows out of the scan button and folds back into it; tray items fall from the reticle into the tray.
- **Feedback:** every pressable thing answers on pointer-down, inside one frame.
- **Budget:** only `transform` and `opacity` animate; no more than about 20 elements animate at once; nothing animates
  during a scroll; no loops except the activity spinner.

---

## 1. Motion principles

### 1.1 Response on pointer-down

Feedback starts on `pointerdown`, never on `click`. A free-standing button scales down on the first frame after the
finger lands; the action itself commits on `click` (pointer-up inside the target), so the user can still cancel by
sliding away. Three precise rules make this feel native rather than twitchy:

1. **Minimum visible press.** If the finger lifts less than 80 ms after it landed, the release spring starts at 80 ms
   so the press is still visible. Only the visual release waits; the action fires immediately on `click`.
2. **Scroll-safe highlight.** Inside a scroll container (lists, sheets with lists), a row's pressed highlight appears
   80 ms after `pointerdown` if the finger has not moved more than 10 px, or immediately on `pointerup` for a shorter
   tap. This mirrors UIKit's delayed content touches and stops rows from flashing while the user scrolls.
   Free-standing buttons outside scrollable regions highlight instantly.
3. **Cancel by movement.** If the pointer moves more than 10 px, or the browser fires `pointercancel` (iOS fires it
   when a native scroll takes over), the press releases with the `press` spring and no action fires.

No input path has an artificial delay. There is no double-tap anywhere in Cellier, so single taps are never delayed
for disambiguation. `touch-action: manipulation` is set on interactive elements.

### 1.2 Interruptibility from the presentation value

Every animation can be grabbed, reversed or retargeted at any instant, and input is never locked during a transition.

- Every moving surface is driven by a Motion `MotionValue` (`x`, `y`, `scale`, `opacity`). A new animation always starts
  from the value's current on-screen state (its presentation value), never from the logical target. Motion does this by
  default when `animate(value, target, transition)` is called on a running value.
- Grabbing a moving element (`pointerdown` on a sheet that is closing, on a screen that is popping) calls `.stop()` on
  its motion values, records the current value as the drag origin and tracks the finger from there. The element does
  not jump and does not finish its previous animation first.
- Routing state changes immediately (TanStack Router and search params update on the same frame); the animation is a
  visual layer on top. Tapping "Back" during a push reverses from the current `x` with the current velocity. A second
  push started during a first push makes the first incoming screen the new parent, which springs from wherever it is to
  the parent position.
- Gesture-driven motion never uses CSS transitions or keyframes. CSS transitions are used only for colour state
  (150 ms) and for the pressed highlight of rows, which carries no position.

### 1.3 Velocity hand-off

When a finger releases a dragged element, the spring that takes over starts at the finger's exact velocity, so there is
no seam between dragging and animating.

- Velocity is estimated from our own pointer history, not from a single event pair: keep the samples of the last 80 ms;
  velocity is `(p_last − p_first) / (t_last − t_first)` in px/s, computed only if the samples span at least 16 ms.
  If the last sample is older than 60 ms at release (the finger stopped before lifting), velocity is 0.
- The velocity is passed in absolute px/s to Motion: `animate(y, target, { ...fling, velocity: vy })`. Motion's
  `visualDuration` accounts for incoming velocity (research 18 §2.3, verified).
- Each axis has its own motion value and its own spring. Two-dimensional motion is never driven by a single distance.
- Releases slower than 100 px/s are treated as stationary: they use the element's base preset (`sheet`, `push`,
  `smooth`) and no bounce, because a finger that stopped has thrown nothing.

### 1.4 Momentum projection

Snap targets (detents, open / closed rows, pages, dismiss / stay) are chosen from where the gesture is going, not where
the finger lifted. Apple's `project()` from *Designing Fluid Interfaces* (WWDC18), with deceleration rate 0.998 as fixed
by the brief:

```ts
// velocity in px/s; returns the extra distance the content would travel under scroll-like deceleration
const project = (velocity: number, decelerationRate = 0.998) =>
  ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);

const projected = current + project(releaseVelocity);
const target = nearestAllowedSnap(projected); // then hand off velocity (1.3)
```

With 0.998, the projected extra travel is about 0.5 s × velocity **[derived]**: 300 px/s → 150 px, 500 px/s → 250 px,
1000 px/s → 499 px, 2000 px/s → 998 px. The physics-textbook `v² / 2a` is not used.

### 1.5 Rubber-banding

At a boundary the element keeps following the finger with increasing resistance; it never hard-stops. One formula is used
everywhere, Apple's `UIScrollView` rubber band:

```ts
// x: distance the finger has moved past the boundary (px), d: band dimension (px), c: constant
const rubberBand = (x: number, d: number, c = 0.55) => (x * d * c) / (d + c * Math.abs(x));
```

`c = 0.55` everywhere. `d` is the asymptote: the element can never move more than `d` px past the boundary however far
the finger goes. Per site: sheet top `d = 32`, swipe row in a direction without actions `d = 48`, toast upward `d = 24`.
Example **[derived]**: sheet pulled 100 px above its large detent moves 20 px; pulled 300 px, it moves 27 px.
Native scroll views keep WebKit's own rubber band; Cellier never reimplements scrolling.

### 1.6 Spatial consistency

Things leave the way they came, and originate from what caused them.

| Surface | Enters from | Leaves to |
|---|---|---|
| Sheet | Bottom edge | Bottom edge |
| Pushed screen (also pushes inside a sheet) | Right edge | Right edge |
| Scanner cover | The scan button (scale origin at its centre) | Back into the scan button |
| Toast | Bottom, just above the tab bar | Downward |
| Tray item in the scanner | From the reticle above (falls into the tray) | Swiped out sideways |
| List row inserted | In place, rising 8 px | In place, fading |
| Popover-like UI (none planned) | From its trigger (`transform-origin` at the trigger) | Back to the trigger |

### 1.7 Frequency rule: what never animates

High-frequency, functional and keyboard-initiated changes are instant (0 frames of motion):

- Search-as-you-type results, filtering, sorting, grouping, switching the sort or group option.
- Keyboard actions: the Return key submitting a field, hardware-keyboard shortcuts, focus moves between fields.
- Tab switches (content changes instantly; only a tab indicator, if the design system draws one, slides).
- Initial render and boot, restoring scroll position, returning to a screen that changed while it was hidden.
- Data that changed while the user was not looking (realtime deltas applied off-screen or during a scroll).
- Typing a quantity directly in a field (only the stepper buttons roll digits).
- Text field focus and the keyboard itself (the system animates the keyboard).
- Lists never stagger. A list that appears appears whole.

The question in review is: "Does this motion explain a change the user caused or is watching?" If not, it is removed.

### 1.8 Hinting

Intermediate frames point at the outcome. The scan button shrinks progressively while held, telegraphing the long press
before it commits. A swipe action's primary button expands across the row the moment the commit is armed, before the
finger lifts. A sheet's scrim tracks the sheet's position continuously, so the user sees the dismissal coming.

---

## 2. Presets

### 2.1 Exact Motion for React transition objects

Names and parameters are fixed by the brief. This is the only place transition objects are defined; components import
them and never write inline springs.

```ts
// motion/presets.ts (illustrative)
export const presets = {
  press:   { type: "spring", bounce: 0,    visualDuration: 0.16 },
  snappy:  { type: "spring", bounce: 0,    visualDuration: 0.22 },
  smooth:  { type: "spring", bounce: 0,    visualDuration: 0.35 },
  push:    { type: "spring", bounce: 0,    visualDuration: 0.42 },
  sheet:   { type: "spring", bounce: 0,    visualDuration: 0.38 },
  fling:   { type: "spring", bounce: 0.18, visualDuration: 0.34 }, // always with { velocity }
  pop:     { type: "spring", bounce: 0.3,  visualDuration: 0.28 },
  reduced: { type: "tween",  duration: 0.18, ease: "easeOut" },     // opacity only, never transform
} as const;
```

A hook `usePreset(name)` returns `presets.reduced` for every non-gesture transition when `useReducedMotion()` is true
(section 8 lists the exceptions).

### 2.2 Derived physical parameters

Motion converts `{ bounce, visualDuration }` into a mass–spring–damper. The conversion below is how Motion's spring
generator does it as far as this author knows; it is **[derived]** and must be checked against the installed `motion`
package source before anyone relies on the physical numbers (the visual parameters above are what ship):

```
m = 1
ω₀ = 2π / (1.2 × visualDuration)          // undamped angular frequency, rad/s
stiffness k = ω₀² × m
ζ (damping ratio) = clamp(0.05, 1, 1 − bounce)
damping c = 2 × ζ × √(k × m)
```

| Preset | bounce | visualDuration (s) | stiffness k [derived] | damping c [derived] | mass | ζ [derived] | Apple response (s) [derived] |
|---|---|---|---|---|---|---|---|
| `press` | 0 | 0.16 | 1071 | 65.4 | 1 | 1.00 | 0.192 |
| `snappy` | 0 | 0.22 | 566 | 47.6 | 1 | 1.00 | 0.264 |
| `smooth` | 0 | 0.35 | 224 | 29.9 | 1 | 1.00 | 0.420 |
| `push` | 0 | 0.42 | 155 | 24.9 | 1 | 1.00 | 0.504 |
| `sheet` | 0 | 0.38 | 190 | 27.6 | 1 | 1.00 | 0.456 |
| `fling` | 0.18 | 0.34 | 237 | 25.3 | 1 | 0.82 | 0.408 |
| `pop` | 0.3 | 0.28 | 350 | 26.2 | 1 | 0.70 | 0.336 |
| `reduced` | — | 0.18 s tween, `easeOut`, opacity only | — | — | — | — | — |

Useful consequences **[derived]**:

- For a critically damped preset (`bounce: 0`), at `t = visualDuration` the value has covered about 96.7 % of the
  distance; it is within 1 % at about 1.27 × visualDuration. So `smooth` is visually done at 350 ms and fully settled
  around 450 ms. Exit callbacks (`onAnimationComplete`, unmounting in `AnimatePresence`) may fire later than the eye
  sees the end; do not chain dependent motion on them.
- `fling` (ζ = 0.82) overshoots by about 1 % of the remaining distance plus a velocity-dependent amount; `pop`
  (ζ = 0.70) overshoots by about 4.6 % of the distance.

### 2.3 Relation with Apple's damping ratio and response

Apple's UIKit / SwiftUI spring `(response, dampingFraction)` uses `k = (2π / response)²` and `c = 4π × ζ / response`
with mass 1. Comparing with 2.2: **Apple response = 1.2 × Motion visualDuration** and **Apple dampingFraction =
1 − Motion bounce** [derived]. SwiftUI's newer `.spring(duration:bounce:)` uses the same `bounce` as Motion, and its
`duration` corresponds to `response`.

Against the values Apple ships (WWDC18, via the apple-design skill): "move / reposition" is ζ 1.0, response 0.4, which is
our `smooth` (0.42); "drawer / sheet" with momentum is ζ 0.8, response 0.3, which is close to our `fling` (ζ 0.82,
response 0.41, slightly calmer, in keeping with the quiet mood). Apple's advice "start at 100 % damping, add bounce only
when the gesture carried momentum" is exactly the brief's rule: five presets at ζ = 1, `fling` only after a release,
`pop` only for the counting moment.

### 2.4 When each preset is allowed and forbidden

| Preset | Allowed for | Forbidden for |
|---|---|---|
| `press` | Scale-down on pointer-down and release back for free-standing pressables: buttons, cards, icon buttons, stepper buttons, the scan button (including its long-press hint). | Any change of position, list rows, enter / exit, anything a finger drags. |
| `snappy` | Small controls under about a quarter of the screen: segmented-control thumb, tab indicator, checkmarks, chip selection, swipe action expanding when the commit arms, toast exit on timeout, status indicators disappearing, sheet repositioning for the keyboard. | Surfaces larger than a quarter of the screen; releases with velocity. |
| `smooth` | Default enter / exit of in-flow content: toast enter, banners, cards, running-low cards, list insert / remove / reorder (manual FLIP), status indicators appearing, inline content swaps, onboarding text. | Screens, sheets, the scanner cover, anything under the finger. |
| `push` | Screen push and pop triggered by a button or by `popstate`, pushes inside a sheet, pop-to-root on tab re-tap. | Gesture releases (use `fling`), anything that is not a navigation. |
| `sheet` | Sheet open / close / detent change without gesture velocity, the scanner cover open / close, stacked-sheet parent push-back, scanner tray detent change without velocity. | Releases with velocity of 100 px/s or more (use `fling`). |
| `fling` | Every release of a dragged element at 100 px/s or more, always with `velocity` handed off: sheets, swipe rows, toasts, edge-swipe back, onboarding pages, scanner tray. | Any programmatic motion (no finger, no `fling`); releases under 100 px/s. |
| `pop` | The quantity number in a row, the stepper digit roll, the scan-success count badge in the tray, the reticle impulse on scan success. | Everything else, explicitly: buttons, sheets, toasts, errors, onboarding, empty states. |
| `reduced` | Replacement for every non-gesture preset when Reduce Motion is on: 0.18 s opacity, `easeOut`. | Transforms of any kind. |

---

## 3. Gesture parameters

All custom gestures are built on Pointer Events with `setPointerCapture`, our own velocity estimate (1.3) and Motion
motion values. Motion's `drag` prop is not used for sheets, rows, toasts or the edge swipe, because Cellier needs its
own thresholds, axis lock, scroll hand-over and synchronous haptic calls (section 5.4 explains why haptics must be
called from our own event handlers).

Per frame during a drag, handlers write motion values only; they never set React state.

### 3.1 Common parameters

| Parameter | Value | Notes |
|---|---|---|
| Drag activation threshold (touch) | 10 px | Apple's hysteresis (WWDC18) and Vaul's touch threshold. Before 10 px the element does not move. |
| Drag activation threshold (mouse, pen) | 4 px | Desktop and iPad pointer. |
| Grab offset | Respected | The element moves by the finger's delta from where it was grabbed; it never snaps its centre to the finger. |
| Axis lock | Decided once, at activation | Horizontal if `abs(dy) ≤ 0.7 × abs(dx)` (within about 35° of horizontal), otherwise vertical. Once locked, the other axis is ignored for the rest of the gesture. |
| Native scroll coexistence | `touch-action: pan-y` on horizontally swipeable rows and screens | The browser keeps vertical scrolling; if it takes over it fires `pointercancel` and the custom gesture aborts with a release at 0 velocity. Sheet grabbers and headers use `touch-action: none`. |
| Stationary release | under 100 px/s | Base preset, no bounce (1.3). |
| Projection | `project(v)`, deceleration 0.998 | Section 1.4. |
| Rubber band | `c = 0.55`, per-site `d` | Section 1.5. |
| Overshoot bleed | 40 px | Every surface that can be released with `fling` extends its background 40 px past its edge on the overshoot side (sheets: bottom; screens: right; rows: trailing and leading), so a spring overshoot never reveals a gap. |
| Haptic budget | At most 1 haptic per gesture | Section 5. |

### 3.2 Sheets

**Detent geometry** (layout viewport height `H = 100dvh`, safe-area top inset `T`):

| Detent | Sheet top position |
|---|---|
| `large` | `T + 10 px` (leaves a 10 px strip of what is behind under the status bar) |
| `medium` | `0.5 × H` |
| `fit` | `max(T + 10, H − contentHeight)`: content height, capped at large |
| closed | `H + 40` (fully off-screen including the bleed) |

**Which sheet uses which detents:**

| Sheet | Detents | Notes |
|---|---|---|
| Pantry menu (from the large title) | `fit` | Short list of pantries. |
| Réglages (avatar button) | `large` | Pushes happen inside the sheet (section 4, push inside a sheet). |
| Edit item | `large` | Contains text fields; a medium sheet with a keyboard is cramped. |
| Manual product entry (unknown product) | `large` | Same reason. |
| Category picker (stacked over Edit or manual entry) | `medium`, `large` | Opens at medium; moves to large when its search field gains focus or the user drags up. |
| Stock view options (sort, group) | `fit` | |
| Destructive confirmation | `fit` | Action-sheet style. |
| Any other sheet | `fit` if content ≤ medium, else `medium` + `large` | Default for sheets the screens spec adds later. |
| Scanner tray (inside the cover, not a routed sheet) | `peek` (last item visible, about 96 px + bottom inset) and `medium` | Never dismissible. |

**Tracking.** The sheet follows the finger 1:1 once the 10 px threshold is crossed. If the sheet contains a scroll view,
the sheet drags only when that scroll view is at `scrollTop ≤ 0` and the finger moves down; when content reaches the top
through momentum, sheet dragging stays blocked for 100 ms (Vaul's `SCROLL_LOCK_TIMEOUT`) so a fling of the list does not
turn into a dismissal.

**Over-drag above the highest detent:** rubber band with `c = 0.55`, `d = 32 px`.

**Release algorithm** (velocity `v` in px/s, positive downward; `d` = distance dragged down from the detent the gesture
started at; `Hd` = visible height of that detent):

1. **Velocity sign veto.** If `v < −100` (finger moving up at release), the sheet cannot dismiss and cannot go down a
   detent. If `v > +100` (moving down), it cannot go up a detent. This is how Apple decides reverse vs commit: by the
   sign, not by position.
2. **Fast release (`abs(v) ≥ 400`, Vaul's 0.4 px/ms).** Target = the allowed snap point (detents or closed) nearest to
   `top + project(v)`, but at least one step in the direction of `v`.
3. **Slow release (`abs(v) < 400`).** Dismiss if `d ≥ 0.25 × Hd` (Vaul's close threshold) and the veto allows it;
   otherwise the allowed detent nearest to `top + project(v)`.
4. **Spring.** `fling` with `velocity: v` if `abs(v) ≥ 100`, else `sheet`.
5. **Haptic (site 2).** When the drag position crosses the dismissal threshold (`d` reaches `0.25 × Hd`) the haptic
   fires once; crossing back above it by 16 px re-arms it. No haptic for detent changes. A sheet flung closed without
   crossing the threshold produces no haptic; the motion is the feedback.

**Keyboard.** When a field in a sheet gains focus: a `medium` sheet moves to `large` with `sheet`. When the visual
viewport shrinks for the keyboard, the sheet's bottom inset follows with `snappy` on `visualViewport` `resize`
(UNVERIFIED timing of that event on iOS; see section 10).

**Back.** Sheets live in search params, so history back (including the custom edge swipe when no sheet is open, and
Android back) closes the top sheet with `sheet`.

### 3.3 Swipe-to-act rows

Applies to list rows that have swipe actions (Stock rows, Courses rows, scanner tray rows). Which actions exist is the
screens document's decision; the physics is this one's.

| Parameter | Value |
|---|---|
| Action button width | 76 px each, 1 or 2 actions per side |
| Reveal width `R` | `n × 76 px` |
| Open on release | if `abs(x + project(v)) ≥ 0.5 × R` and the velocity sign does not point back toward closed |
| Commit (full swipe) arms | when `abs(x) ≥ 0.6 × rowWidth` (215 px on a 358 px inset row) |
| Commit by flick | when `abs(x) ≥ R` and `abs(v) ≥ 1200 px/s` in the opening direction |
| Disarm | when `abs(x)` falls back below `0.6 × rowWidth − 16 px` |
| Velocity sign veto | if `v` points back toward closed at more than 200 px/s, the swipe never commits |
| Side without actions | rubber band `c = 0.55`, `d = 48 px` |
| Release spring | `fling` with velocity if `abs(v) ≥ 100`, else `smooth` |
| Only one row open | Opening a row closes any other open row with `smooth`. Starting a scroll closes the open row. |

When the commit arms, the primary action's button grows to fill the revealed area (`scaleX` is not used: the button
background is a full-width layer whose `x` translates with `snappy` while the secondary action fades to opacity 0), and
the haptic fires (site 2). On release while armed, the row slides out to `x = ±rowWidth` with `fling` and the action
commits, then the row is removed (section 4.2). Destructive full swipes are confirmed by the undo toast, not by a
dialog. No second haptic fires on release.

### 3.4 Press scales

| Element | Pressed scale | Spring | Notes |
|---|---|---|---|
| Buttons (filled, tinted, bordered; including full-width "Ajouter au stock") | 0.97 | `press` | Emil Kowalski's 0.97 (research 19 §6). |
| Cards (running-low cards on Accueil, any free-standing card) | 0.97 | `press` | |
| Icon buttons (nav bar, stepper −/+, close, torch) | 0.92 | `press` | Small targets need a larger visible change. Hit area stays 44 × 44 px. |
| Scan button (tap) | 0.96 | `press` | Then held, see 3.5. |
| Chips, segmented control segments | none | — | Selection itself is the feedback (`snappy` thumb). |
| Tab bar items | none | — | Tabs switch instantly on tap; a press scale would be a frame of noise on the highest-frequency control. |
| List rows | **no scale**: pressed background highlight | CSS: on at 0 ms (or after 80 ms in scroll containers, 1.1), off over 150 ms | Rows are segments of a continuous inset group joined by separators; a scaled row detaches from its neighbours and fights the swipe gesture on the same element. Apple's lists highlight, they do not scale. |

`transform-origin` is the element's centre for all presses.

### 3.5 Scan button long press (withdraw mode)

| Parameter | Value |
|---|---|
| Long-press duration | 450 ms from `pointerdown` without moving more than 10 px |
| Hint during the hold | From 0.96 (pressed) the button continues to 0.90 over the hold, driven linearly by elapsed time; at 300 ms the icon cross-fades (opacity, 120 ms) to the withdraw glyph so the user sees which mode is coming |
| Commit | At 450 ms: the scanner cover opens in withdraw mode ("Retirer" selected) |
| Cancel | Moving more than 10 px or lifting before 450 ms: button returns to 1 with `press`; a lift before 450 ms counts as a tap (add mode) |
| Click suppression | The `click` that follows a committed long press is swallowed |
| Haptic | None (not one of the four sites) |
| Camera start | The long-press commit runs from a timer, which is not a user gesture. The cover opens visually at 450 ms; `getUserMedia` and `video.play()` are called in the following `pointerup` (finger lift), which is an activation-triggering event. The cover shows the black viewfinder with the reticle until frames arrive, which takes a few hundred ms in any case. |

### 3.6 Edge-swipe back in the installed app

**Context.** Safari's back-swipe is browser chrome. In a standalone home-screen web app the widely reported behaviour,
and the owner's experience, is that there is no system back or forward swipe. Research note 21 §6 says the opposite
("iOS still provides a back swipe"), but that line is unsourced and itself flagged UNVERIFIED. This document therefore
specifies a custom gesture, gated so that it can never double up with a system gesture.

**Decision: implement a custom left-edge swipe-to-pop**, because Cellier pushes item detail from every list and Apple
users pop with the thumb, not by reaching the top-left back button on a 6.1-inch phone.

| Parameter | Value |
|---|---|
| Enabled when | `matchMedia('(display-mode: standalone)')` matches, the current stack (tab stack, or the push stack inside a sheet) has depth ≥ 2, no sheet is open above it, the scanner cover is closed |
| Disabled when | In a browser tab (iOS 26 can open a home-screen site in a tab; Safari's own swipe applies there), or when the device test in section 10 shows a system swipe exists in standalone (then a build flag turns the custom one off) |
| Start zone | `pointerdown` with `clientX ≤ 24 px` (from the left edge of the screen, or of the sheet for pushes inside a sheet) |
| Activation | 10 px horizontal movement with `abs(dy) ≤ abs(dx)` (an edge gesture is unambiguous, so the lock is looser than 3.1); otherwise the gesture is abandoned and vertical scroll proceeds |
| Priority | Wins over a row's leading swipe that starts inside the 24 px zone |
| Tracking | Top screen `x = max(0, dx)`, 1:1. Parent `x = −0.3W × (1 − x/W)`. Parent scrim opacity `= s × (1 − x/W)` with `s` from 4.1 (push row). No rubber band to the left: the top screen stops at 0 |
| Release | If `vx ≥ 300 px/s`: pop. If `vx ≤ −300 px/s`: cancel. Otherwise pop if `x + project(vx) ≥ 0.5W`, else cancel |
| Spring | `fling` with `velocity: vx` if `abs(vx) ≥ 100`, else `push` |
| Commit | On pop, `history.back()` is called at release (not at the end of the animation); the router state changes immediately and the animation completes from the current position |
| Haptic | None. iOS has none for the back swipe, and it is not one of the four sites |

### 3.7 Toast swipe

| Parameter | Value |
|---|---|
| Direction | Down (the way it came) |
| Dismiss | `dy ≥ 45 px` or `vy ≥ 110 px/s` downward (Sonner: 45 px, 0.11 px/ms) |
| Upward drag | rubber band `c = 0.55`, `d = 24 px` |
| Release | Dismiss: `fling` to `y = toastHeight + 40` with velocity. Stay: `fling` (or `smooth` under 100 px/s) back to 0 |
| Lifetime | 4000 ms; 6000 ms when the toast carries an action ("Annuler"). Paused while touched and while `document.hidden` |

### 3.8 Pull to refresh

Cellier is local-first with realtime and pulls on foreground, so refresh is rarely needed. Users still pull when they
doubt the data, and a pull that does nothing feels broken. Decision: **keep pull to refresh on Accueil, Stock and
Courses, built on WebKit's native rubber band**, not on a reimplemented scroll.

| Parameter | Value |
|---|---|
| Mechanism | The list scroll container keeps native scrolling and native bounce (`overscroll-behavior-y: contain`, which keeps the local bounce and prevents chaining to the page). During the bounce, iOS reports a negative `scrollTop` (UNVERIFIED for overflow containers in standalone; section 10). Cellier reads it in a `scroll` listener, writes it to a motion value, and never moves the content itself |
| Rubber band | Native (WebKit) |
| Threshold | `scrollTop ≤ −64 px` while the finger is down; evaluated at `touchend` |
| Spinner | A 20 px activity indicator (8 spokes) sits in the gap above the first row, attached to the content top. Spoke opacity fills progressively with pull distance from 0 to 64 px; at the threshold all spokes are lit and it starts turning (one revolution per second, 8 steps, `transform: rotate`) |
| On release past threshold | Sync starts (`pull_changes` + outbox flush). The content bounces back natively; the pull spinner rides up with it and fades (opacity, `snappy`); sync progress continues in the nav-bar sync indicator (section 4, offline/sync row) until done, minimum visible 500 ms |
| Haptic | None. Native UIKit pull to refresh ticks at the threshold, but the brief allows exactly four sites and this is not one of them |
| Fallback | If negative `scrollTop` is not exposed in standalone, pull to refresh is dropped; the sync indicator remains tappable ("Synchroniser maintenant") |

### 3.9 Onboarding paging

Horizontal pages tracked 1:1. Release: target page = nearest page to `x + project(vx)`, limited to one page per
gesture, `fling` with velocity (or `smooth` under 100 px/s). First and last pages rubber-band with `c = 0.55`,
`d = 48 px`. The page indicator dots read the same `x` motion value: each dot's opacity interpolates from 0.3 to 1 as
its page approaches. No haptic.

### 3.10 Scanner tray

The tray is a bottom panel inside the scanner cover with two detents (`peek`, `medium`), the same release algorithm as
sheets (3.2) minus dismissal, and the same rubber band at its top (`d = 32`). Tray rows use the swipe-to-act parameters
of 3.3 (swipe to remove a mistaken scan; arming fires the site-2 haptic).

---

## 4. Choreography

### 4.1 Choreography table

Abbreviations: `W` viewport width in px (read at gesture or animation start; percentage transforms are not used),
`H` viewport height, `T` safe-area top inset. "Scrim" is a black layer animated by opacity only; its colour token is
the design system's, the opacity values are fixed here. "Haptic" names one of the four brief sites: (1) scan lands in
tray, (2) swipe action or sheet drag crosses its commit threshold, (3) native switch toggles, (4) destructive action
confirmed.

| Interaction | Trigger | Preset | Properties animated (from → to) | Interruptibility | Reduced motion | Haptic |
|---|---|---|---|---|---|---|
| Press: button | `pointerdown` / release | `press` | `scale` 1 → 0.97 → 1 | Release retargets from current scale and velocity; 80 ms minimum visible press | No scale; background darkens via CSS colour (instant on, 150 ms off) | No |
| Press: list row | `pointerdown` (80 ms delay in scroll containers) | CSS colour | Row background: rest → pressed highlight (instant), back over 150 ms | Moving 10 px or `pointercancel` removes the highlight | Same (colour is not motion) | No |
| Press: card | `pointerdown` / release | `press` | `scale` 1 → 0.97 → 1 | As button | Colour only | No |
| Press: icon button | `pointerdown` / release | `press` | `scale` 1 → 0.92 → 1 | As button | Icon opacity 1 → 0.6 (instant) → 1 (150 ms) | No |
| Press: scan button (tap) | `pointerdown` / `click` | `press` | `scale` 1 → 0.96; on `click` the cover opens (below) and the button returns to 1 under it | As button | Colour only | No |
| Scan button long press | Held 450 ms | linear hold, then `press` | `scale` 0.96 → 0.90 over the hold (time-linear); icon `opacity` cross-fade to withdraw glyph at 300 ms (120 ms) | Movement > 10 px or lift cancels and springs back to 1 | No scale; icon cross-fade only | No |
| Sheet open | Tap (route search param set) | `sheet` | Sheet `y`: `H + 40` → detent top; scrim `opacity` 0 → medium 0.18 / large 0.30 (light), 0.35 / 0.50 (dark), interpolated from sheet `y` | Grabbing mid-flight stops and tracks from the current `y` | Sheet appears at its detent; sheet `opacity` 0 → 1 and scrim fade, `reduced` | No |
| Sheet close (button, scrim tap, Back) | Tap or `popstate` | `sheet` | Sheet `y`: current → `H + 40`; scrim follows `y` to 0 | Grabbing mid-flight catches it | Sheet and scrim `opacity` → 0, `reduced` | No |
| Sheet drag | Finger after 10 px | none (1:1) | Sheet `y` = finger; scrim opacity derived from `y`; rubber band above top detent (`d` 32) | Continuous | Still tracks 1:1 (user-driven) | (2) once when crossing the 25 % dismissal threshold |
| Sheet release / detent change | Finger lift | `fling` (≥ 100 px/s, with velocity) or `sheet` | Sheet `y` → chosen detent or closed (3.2) | Re-grab at any time | Snap with `snappy`, `bounce: 0` (exception, section 8); dismiss fades with `reduced` | No (already given at threshold) |
| Behind the first sheet (app root) | Sheet open | follows sheet `y` | Scrim only. The app root is **not** scaled | — | Scrim fade | No |
| Stacked sheet: parent push-back | Child sheet opens | `sheet` (follows child `y`) | Parent sheet `scale` 1 → 0.94 (origin top centre), `y` 0 → −10 px; parent's own scrim `opacity` 0 → 0.15 (light) / 0.30 (dark). All interpolated from the child's `y`, so dragging the child restores the parent continuously | Fully continuous | Parent stays; only scrims fade, `reduced` | No |
| Push inside a sheet (Réglages) | Tap row | `push` | Incoming page `x` sheetWidth → 0; parent page `x` 0 → −0.3 × sheetWidth; parent scrim 0 → value of the push row below | As screen push; edge swipe inside the sheet pops | Cross-fade, `reduced` | No |
| Keyboard in a sheet | Field focus | `sheet` then `snappy` | Medium → large `y`; bottom inset follows the visual viewport | Interruptible | Instant reposition | No |
| Scanner cover open | Scan button `click` or long press | `sheet` | Cover `scale` 0.6 → 1 with `transform-origin` at the scan button centre; cover `opacity` 0 → 1. Cover corner radius fixed at 40 px (never animated) | Tapping close mid-open reverses from the current scale | Cover `opacity` 0 → 1, `reduced` | No |
| Scanner cover close | "Terminer" or Back | `sheet` | Cover `scale` 1 → 0.6, `opacity` 1 → 0, origin at the scan button | Reopening mid-close reverses | Opacity, `reduced` | No |
| Camera ready | First video frame (`requestVideoFrameCallback` or `playing`) | `smooth` | Video `opacity` 0 → 1 over the black cover; reticle `opacity` 0 → 1 | — | Same (opacity) | No |
| Scan success: reticle | Valid code from the worker (checksum passed, not a duplicate) | `pop` | Reticle brackets `scale` impulse: target 1 with initial velocity −3 /s, dips to about 0.94 and settles [derived]; bracket colour → accent (CSS 150 ms), back to white after 600 ms | A new success adds a new impulse from the current value | Colour change only | (1) on the same frame, if allowed (section 5.5) |
| Scan success: new product in tray | Same frame | `smooth` + `pop` | New tray row `y` −16 → 0 (falls from the reticle), `opacity` 0 → 1; rows below move down by FLIP (`y` +rowHeight → 0, `smooth`); count badge impulse (`pop`, 4.3) | Next scan retargets everything from current values | Row `opacity` 0 → 1 (`reduced`); siblings jump | (1) |
| Scan success: same product again | Same frame | `pop` (+ `smooth` if it moves) | Existing row's count: number pop (4.3); if it is not the top row it moves to the top by FLIP (`smooth`) | As above | Number changes instantly; row jumps | (1) |
| Scan: unknown product or in-store code | Lookup chain finishes empty, or prefix 02 / 20–29 | `smooth` | Row as "new product" above, content "Produit inconnu" with action "Compléter", or "Code magasin" with action "Saisir le produit". Reticle stays neutral: no shake, no red | — | Opacity | **No** (not the user's error) |
| Remote lookup in progress | Code recognised but not in the local store | `smooth` | Row arrives immediately with "Recherche…" in secondary text; when data arrives, the text block cross-fades (`opacity` 0 → 1 on the new content, the old removed) | — | `reduced` | No |
| Tray detent change | Drag or tap on grabber | `fling` or `sheet` | Tray `y` between peek and medium | Re-grab | Snap with `snappy` (section 8) | No |
| Scanner mode switch (Ajouter / Retirer) | Tap segment | `snappy` | Segmented thumb `x`; label colours via CSS 150 ms | Retargets | Thumb `opacity` cross-fade between segments, `reduced` | No |
| List insert (visible rows) | Data change while the screen is visible and not scrolling | `smooth` | New row `y` +8 → 0 (relative to its slot), `opacity` 0 → 1; rows below FLIP `y` −rowHeight → 0 | Retargets on further changes | New row `opacity` only; others jump | No |
| List remove (visible rows) | Delete, withdraw to 0 with removal, swipe commit | `smooth` | Ghost of the removed row `opacity` 1 → 0 (stays at its old position, beneath); rows below FLIP `y` +rowHeight → 0, sliding over the ghost. **No height animation** | Retargets | Ghost `opacity` only; rows jump | (2) or (4) already given by the triggering gesture or confirmation |
| List reorder (data-driven) | A visible row's sort key changes (quantity, recency) | `smooth` | FLIP `y` from old slot to new slot for every visible row whose slot changed | Retargets | Rows jump | No |
| Filter, sort, group, search-as-you-type | Typing or option change | none | Nothing animates; the list re-renders on the next frame | — | — | No |
| Quantity change in a row | Value changes while the row is visible | `pop` | Number impulse: `scale` target 1 with initial velocity +5 /s, peak about 1.12 at about 60 ms, settles [derived]; the new digits are in place from frame 0 | New change: velocity = current + 5, capped at 8 | Number changes instantly | No |
| Stepper value change | Tap − or + | `pop` | Digit roll: outgoing value `y` 0 → −14 px (increment) or +14 px (decrement) with `opacity` 1 → 0; incoming value `y` +14 → 0 (or −14 → 0) with `opacity` 0 → 1. Value sits in a fixed-width slot (tabular figures, at least 3 digits wide) so nothing reflows | A newer value removes the exiting one immediately (max one outgoing) | Instant value change | No |
| Swipe row: tracking | Finger after 10 px, horizontal lock | none (1:1) | Row content `x` = finger; actions revealed underneath; rubber band on the side without actions | Continuous | Still tracks | (2) when the full-swipe commit arms |
| Swipe row: commit arms | `abs(x)` crosses 0.6 × rowWidth | `snappy` | Primary action layer `x` expands across; secondary action `opacity` → 0 | Disarms with hysteresis 16 px | Opacity swap only | (2) |
| Swipe row: release | Finger lift | `fling` or `smooth` | Row `x` → 0, `±R` (open) or `±rowWidth` (commit, then list remove) | Re-grab | `snappy`, no bounce (section 8) | No |
| Undo | "Annuler" in the toast | `smooth` + `pop` | The restored row re-enters with the list-insert treatment at its original position; a reverted quantity gets the number pop; the toast exits | — | Opacity | No |
| Toast in | Action completed | `smooth` | `y` +24 → 0, `opacity` 0 → 1. One toast at a time: a new toast replaces the current one (old exits with `snappy`, which also closes its undo window) | — | `opacity` only | No |
| Toast out (timeout) | 4000 / 6000 ms | `snappy` | `y` 0 → +12, `opacity` 1 → 0 | Touching it pauses and catches it | `opacity` | No |
| Toast swipe dismiss | Drag down | `fling` | `y` → `toastHeight + 40`, `opacity` follows `y` from 1 to 0 over the last 50 % | Continuous | Tracks; exit by `opacity` | No |
| Tab change | Tap a tab | none (instant) | Content swaps on frame 0. If the design system draws a selection indicator, it moves with `snappy` (`x`) | — | Indicator `opacity` cross-fade or instant | No |
| Tab re-tap | Tap the active tab | `push` or native | At depth ≥ 2: pop to root with the pop animation. At root: scroll to top (native smooth scroll) | — | Cross-fade / instant scroll | No |
| Screen push | Tap a row (item detail) | `push` | Incoming `x` W → 0 (with a static soft shadow on its leading edge); parent `x` 0 → −0.3W; parent scrim `opacity` 0 → 0.10 (light) / 0.30 (dark); nav-bar titles cross-fade (`opacity`) with progress | Back mid-push reverses with current velocity | Incoming `opacity` 0 → 1 over the parent, `reduced`; parent static | No |
| Screen pop (back button, `popstate`) | Tap back | `push` | Exact reverse of push | Re-push or edge-grab catches it | `opacity` 1 → 0, `reduced` | No |
| Edge-swipe back | Left-edge drag (3.6) | 1:1, then `fling` or `push` | As push, driven by the finger | Continuous | Tracks; release completes with `snappy`, no bounce | No |
| Large title collapse, nav material | Scroll | scroll-linked (no spring) | Large title scrolls natively; compact title `opacity` 0 → 1 as the large title passes under the bar; nav material layer `opacity` 0 → 1 over the first 8 px past the threshold. The blur itself is never animated | Follows scroll | Same (opacity) | No |
| Pull to refresh | Overscroll at top (3.8) | native bounce, then `snappy` | Spinner spokes `opacity` by pull distance; spinner `rotate` once armed; fades with `snappy` | — | Spokes fill; spinner still turns (status, not decoration) | No |
| Running-low card appears (Accueil) | Item crosses its minimum while Accueil is visible, or within 5 s after the scanner cover closes onto it | `smooth` | Card `y` +8 → 0, `opacity` 0 → 1; siblings FLIP. Deferred reveal starts after the cover has finished closing; at most 3 cards animate, the rest appear in place | Retargets | `opacity` only | No |
| Running-low card leaves | Restocked | `smooth` | List-remove treatment | Retargets | `opacity` | No |
| Segmented control (any) | Tap segment | `snappy` | Thumb `x` (segments are equal width, so only `x`); labels via CSS colour | Retargets; a drag of the thumb tracks 1:1 and releases with `fling` | Thumb cross-fade, `reduced` | No |
| Toggle | Tap the native switch | platform | The native `<input type="checkbox" switch>` animates itself; Cellier adds nothing | Platform | Platform | (3) free, by the platform |
| Pantry switcher | Tap the large title (chevron) | `sheet` | Opens the `fit` pantry menu sheet. On selection, the screen content swaps on frame 0 underneath the closing sheet; the title text changes instantly; the chevron does not rotate | — | As sheet | No |
| Offline indicator appear | Offline for more than 2 s | `smooth` | Nav-bar status glyph `opacity` 0 → 1, `scale` 0.9 → 1 | — | `opacity` | No |
| Offline / sync indicator disappear | Back online and outbox empty | `snappy` | `opacity` 1 → 0, `scale` 1 → 0.9; minimum visible 600 ms | — | `opacity` | No |
| Sync pending indicator | Outbox non-empty for more than 1 s | `smooth` | Same as offline indicator, glyph changes via `opacity` cross-fade | — | `opacity` | No |
| Initial load from the local store | App start | none | No skeleton, no fade: the first content frame is real data (4.5) | — | — | No |
| Onboarding pages | Swipe or "Continuer" | 1:1 + `fling`, or `push` for the button | Page `x`; illustration parallax `x` at 0.6 × the page offset; dots `opacity` from the same motion value | Continuous | Pages cross-fade (`reduced`); dots switch | No |
| Onboarding success | Last step done | `smooth` | Headline "C’est prêt !" and body `opacity` 0 → 1, `y` +8 → 0, together (no stagger). The app's one exclamation mark | — | `opacity` | No |
| Permission moment: camera | First scan button tap | `sheet` (cover) | The cover opens normally and `getUserMedia` is called in the same `click` handler; the iOS prompt appears over the dark cover. Denied: the viewfinder area's explanation and "Ouvrir les Réglages" instructions fade in (`smooth`, `opacity`) | — | `opacity` | No |
| Permission moment: notifications | Tap "Activer les alertes" in the inline card | `smooth` | `Notification.requestPermission()` runs inside the `click`. Granted: the card leaves with the list-remove treatment. Denied: card content cross-fades to the explanation | — | `opacity` | No |
| Destructive confirmation | Tap a destructive action that cannot be undone (delete pantry, remove member) | `sheet` | Opens the `fit` confirmation sheet; on confirm the sheet closes and the consequence plays (list remove, pop) | — | As sheet | (4) on the confirm tap |
| Activity spinner (anywhere) | Remote wait over 300 ms | CSS animation | `rotate` in 8 steps per second; show delay 300 ms, minimum visible 500 ms; paused when `document.hidden` | — | Kept (status) | No |
| Search field focus | Tap the search field | `snappy` | The "Annuler" button `opacity` 0 → 1. The field's width does not animate (width is layout): its final width is applied on frame 0 | — | `opacity` | No |

### 4.2 Lists under TanStack Virtual: the visible-row FLIP technique

Motion's `layout` prop is **not** used on virtualised rows: it measures every element on every render, cannot see rows
that are not mounted, and fights the virtualiser's own absolute positioning. Instead:

1. TanStack Virtual positions each mounted row absolutely with a `translateY(start)`. Cellier renders that offset
   through a per-row motion value `y` (`style={{ y }}`) instead of a static style.
2. Before committing a data change, the list records `key → start` for every mounted row (a cheap map read, no DOM
   measurement: starts come from the virtualiser).
3. After the change, for every row that is **inside the viewport (plus a 1-row margin)** and whose `start` changed, the
   new `start` is applied by `animate(y, newStart, smooth)` from the old value. This is FLIP on transform only.
   Rows outside that band are set instantly. At most about 20 rows ever animate.
4. **Insert:** the new row mounts at its slot with `opacity` 0 and an extra `+8 px` offset, then springs to its slot
   with `smooth`; rows below spring down from their old starts.
5. **Remove:** the removed row is kept for one animation as a "ghost" in an overlay layer at its old start, beneath the
   other rows (lower `z-index`), and fades `opacity` 1 → 0 with `smooth`. Rows below spring up from their old starts and
   slide over it. Its height never animates, because only `transform` and `opacity` may animate.
6. **Inset group corners:** when the first or last row of a group changes, its corner radius changes at the start of
   the motion (radius is not animated). The ghost keeps its old corners.
7. **When not to animate:** if the list scrolled in the last 150 ms, if the change was not visible when it happened, or
   if more than 20 visible rows would move (a sort change, a pantry switch), everything is applied instantly.
8. **Reduced motion:** steps 3 to 5 become instant positions; only the inserted row's `opacity` and the ghost's
   `opacity` play with `reduced`.

Non-virtual small groups (the Accueil running-low cards, the scanner tray) use the same FLIP helper so behaviour is
identical everywhere. `AnimatePresence` is used only for single conditional elements (toasts, indicators, sheets),
never around a virtual list.

### 4.3 Scan success, frame by frame

The worker returns a decode. On the main thread, in the worker's `message` handler:

1. Checksum check and duplicate debounce (1500 ms per code, frame must be clear for 300 ms; research 08 §7–8). If
   either fails, nothing happens.
2. Synchronous lookup in the in-memory store (local products). The tray state is updated and committed in the same task
   (`flushSync` around the tray update) so the new row exists before the next frame.
3. In the same task: start the reticle impulse, start the tray-row arrival, start the count badge impulse, and attempt
   the haptic (site 1). All visual changes therefore begin on the same frame, and the haptic (if it plays) lands within
   that frame.
4. If the product is not in the local store, the row shows "Recherche…" and the catalogue → Open Food Facts chain runs;
   when it resolves, only the row's text block cross-fades. The success moment does not wait for the network.

Count badge impulse (`pop`): `scale` target 1 with initial velocity +5 /s (peak about 1.12, about 60 ms) **[derived]**.
The new count text is in place from frame 0.

### 4.4 Tab change: instant, and why

Tabs switch on frame 0 with no cross-fade and no slide.

- Apple's tab bars switch instantly. Tabs are peers with no spatial relationship, so a slide would invent a direction,
  and a fade would only delay the content.
- The tab bar is the highest-frequency control in the app (Accueil ↔ Stock many times per session); research 19 §1
  (Emil Kowalski, Rauno Freiberg) says motion on such controls becomes a cognitive tax.
- Each tab keeps its own navigation stack and scroll position; the destination is already rendered, so the instant
  swap shows finished content rather than a transition.
- A cross-fade composites two full-screen layers, including two copies of the translucent nav and tab materials, on
  every switch: a cost with no information gain.

### 4.5 No skeletons for local data

The local store is in memory and selectors are synchronous; at boot, the IndexedDB snapshot is read before the first
content render.

- The content area does not render until the snapshot resolves, bounded by a 300 ms timeout. The shell (tab bar, scan
  button, large title) renders immediately. The first content frame is therefore real data: no skeleton, no fade-in,
  no stagger ("0-frame render").
- A skeleton that would be visible for under about 100 ms reads as a flash, which is worse than nothing; research 19
  §11 (Vercel guidelines) puts the show delay of loading indicators at 150 to 300 ms for exactly this reason.
- If the 300 ms timeout is exceeded (a very large store on a cold start), the content appears when ready with a single
  `reduced` opacity fade, and this is logged as a performance bug.
- Only remote-bound content shows a waiting state: inline text "Recherche…" or the activity spinner, after a 300 ms
  show delay, with 500 ms minimum visible. No shimmer anywhere (a decorative loop).

---

## 5. Haptics

### 5.1 Mechanism

| Platform | Mechanism | Patterns |
|---|---|---|
| iOS 18.0+ (Safari and installed web app) | One hidden `<label>` containing `<input type="checkbox" switch>`, created once at app start and kept in the DOM: `aria-hidden="true"`, `tabIndex = -1`, `position: fixed`, 1 × 1 px, `opacity: 0`, `pointer-events: none`, **not** `display: none`. A haptic is `label.click()` called synchronously inside a user-gesture handler; WebKit plays the system switch tick when the switch toggles (Safari 18.0 release notes, verified in research 10). Click events from the label and input are stopped from propagating. | One tick only. No multi-tick patterns on iOS: ticks after the first would come from `setTimeout`, outside the gesture, and may be silent (research 10 §9). |
| iOS 17.4 – 17.x | The switch renders but has no haptic | No-op in practice |
| iOS 16.4 – 17.3 | No switch | No-op |
| iOS 26.5+ | Reported broken by two unverified third-party sources (research 10 §3.5) | Treated as best effort; section 10 tests it |
| Android (Chrome, Firefox, Samsung) | `navigator.vibrate(pattern)` from the same handlers (needs user activation; returns `false` when hidden) | Scan success `[12]`; commit armed `[8]`; destructive confirmed `[20, 60, 20]`; switch toggled `[6]` (Android switches have no native tick, so Cellier supplies one for parity) |
| Desktop, anything else | No-op | — |

Support detection: iOS by user agent (`iPhone|iPad|iPod`, or `MacIntel` with touch points); never parse the iOS version
(iOS 26 freezes it at 18_6). `navigator.vibrate` by feature test. There is no way to detect whether the iOS tick
actually played.

### 5.2 The four sites, and why nothing else

1. **A barcode is recognised and the product lands in the scanner tray.** The user is looking at the product, not the
   screen; the tick tells their hand "done, next item". This is Cellier's core loop.
2. **A swipe action or a sheet drag crosses its commit threshold.** It marks the point of no return while the finger
   is still down, so the user can still back out. It fires once, at arming, not again on release.
3. **A native switch toggles.** Free: the platform does it. Cellier's toggles are real `<input type="checkbox" switch>`
   elements so they get it.
4. **A destructive action is confirmed.** The confirm tap in a destructive confirmation sheet ("Supprimer le
   garde-manger"). It gives weight to an irreversible act.

Nothing else: not buttons, not tabs, not the stepper, not the long press, not pull to refresh, not page changes, not
errors. iOS offers one haptic style, so its meaning comes entirely from scarcity: if it fires everywhere it means
nothing, and users stop noticing the one at the scan. A scan failure has no haptic: an unrecognised code is not the
user's error, and an "error buzz" in a basement would only make them try again with the same product.

### 5.3 Calling rules

- Called synchronously inside the event handler that causes the change: `click`, `pointerup`, `touchend`, `change`,
  or (site 2) `pointermove`. Never from `useEffect`, `setTimeout`, `requestAnimationFrame` or a promise continuation.
- **Not from Motion callbacks.** Motion's `onDrag` / `onPan` run inside its frame loop, which is batched into
  `requestAnimationFrame` rather than the event dispatch (UNVERIFIED about current internals, so assume the worst).
  This is one reason Cellier writes its own pointer handlers (section 3).
- **Site 2 and user activation.** Per the HTML user-activation model, a touch `pointerdown` and `pointermove` are not
  activation-triggering; only `pointerup` / `touchend` are. If WebKit's check (bug 285120) requires transient
  activation, a tick fired in `pointermove` when the threshold is crossed may be silent unless an earlier activation is
  still valid. Primary design: fire at the crossing (native feel). Fallback if the device test shows it silent: fire
  in `pointerup` when the release actually commits. A build flag `hapticAtCrossing` selects the behaviour.
- **Throttle:** at most one haptic per 100 ms globally, and at most one per gesture. Scans are also naturally limited
  by the 1500 ms duplicate debounce and the 300 ms clear-frame cooldown.
- **Harmony:** the haptic call sits in the same handler that sets the animation target, before any `await`. The first
  animation frame renders within one frame of the tick (8.3 ms at 120 Hz, 16.7 ms at 60 Hz). A haptic that lands after
  the visual (for example called from an effect after React commits) is a bug.
- **Always paired with a visible change.** Haptics are an enhancement; the UI must be fully understandable without them.

### 5.4 Settings toggle "Retours haptiques"

In Réglages, section "Sons et retours haptiques":

- **Retours haptiques** (native switch), on by default. Secondary text: "Au scan d’un produit, quand un glissement est
  validé et quand une suppression est confirmée."
- Stored per device (local preference, not synced: a household shares data, not phones).
- Shown on iOS and Android; hidden where support is "none".
- Turning it off silences sites 1, 2 and 4 and the Android parity tick for 3. It cannot silence the native tick of the
  iOS switch itself (site 3, including this very toggle): that belongs to the platform and to iOS's own System Haptics
  setting.

### 5.5 Scan success and user activation (the asynchronous case)

**The problem.** The scan result arrives from a Web Worker `message` event, typically 1 to 60 s after the user last
touched the screen. A `message` event is not a user gesture. The last activation was the tap that opened the scanner
(or the tap on the previous tray item).

**What research 10 says.** WebKit bug 285120 (December 2024) asked that switch haptics require user activation, and was
closed as fixed in January 2025 (r288403). The exact rule it implemented was not read: it could check transient
activation (expires after a user-agent-defined duration, typically a few seconds), sticky activation (any interaction
since page load), or "processing a user gesture" (synchronous only). The libraries (ios-haptics, web-haptics) do not
check activation, and none of them document asynchronous calls. **UNVERIFIED.**

**Expected outcome.** The purpose of the fix was to stop pages from vibrating the phone on their own, which only makes
sense if it requires a recent gesture. The working assumption is therefore that **the scan-success haptic is blocked
on iOS 18.2+ / 26** except, at best, for a scan that completes within the transient window after the opening tap.

**Specification.**

1. The visual success (reticle impulse and colour, tray arrival, count pop) is the primary confirmation and is
   designed to be readable in peripheral vision: large, near the centre and bottom, high contrast on the black cover.
2. The haptic is attempted at scan success (`label.click()` in the worker `message` handler) **only if the device test
   below passes**. A build-time flag `scanHaptic` is set from that test.
3. If the test shows the tick plays only within a short window after a touch, `scanHaptic` is **off**: a haptic that
   fires on the first scan and not on the next ones is worse than none, because its absence would then read as "not
   scanned". Android keeps `navigator.vibrate`, which uses sticky activation and works asynchronously.
4. In that case the optional sound (section 6) is the secondary non-visual cue; its setting description is the same.
5. Rejected alternative: "tap to scan" (decode only after a tap on the viewfinder) would bring the scan inside the
   activation window, but it costs one tap per item and breaks the continuous batch scanning decided in
   `00-decisions.md`.

**Device test protocol (iPhone, installed web app, then Safari tab):**

| Step | Action | Record |
|---|---|---|
| 1 | Test page with a button that calls `label.click()` directly | Tick yes / no (baseline) |
| 2 | Buttons that call it after `setTimeout` of 250, 1000, 3000, 5000, 10 000 ms | Longest delay that still ticks |
| 3 | Tap "start", then trigger from a Worker `message` 1 s, 5 s, 10 s, 30 s later without touching | Ticks yes / no per delay |
| 4 | Call on page load, no interaction | Tick yes / no (expect no) |
| 5 | Call in `pointermove` when a drag crosses 100 px (site 2 primary design) | Tick yes / no |
| 6 | Repeat steps 1–5 with System Haptics off, ringer on / off, Low Power Mode on | Matrix |
| 7 | Run on iOS 18.x and the current iOS 26.x (and 26.5+ specifically) | Matrix |
| Pass for `scanHaptic` | Step 3 ticks at 10 s and 30 s in at least 19 of 20 trials | — |
| Pass for `hapticAtCrossing` | Step 5 ticks in at least 19 of 20 trials | — |

The tick of the Taptic Engine is faintly audible: film the phone resting on a table with a second phone's microphone to
confirm both that it fired and that it is aligned with the visual frame (section 7.6).

---

## 6. Optional sound

**Decision: a scan-success sound exists, off by default.** Setting: Réglages → "Sons et retours haptiques" →
**Son au scan** (native switch), secondary text "Un son discret quand un produit est reconnu."

Why off by default:

- The mood is a quiet cellar, and Cellier is used at home, at night, next to sleeping children, in shops. Apple's own
  code scanner in Camera is silent. Sound that the user did not ask for is the fastest way to feel like a toy.
- Every other sense is already covered: the visual success is designed to be peripheral, and the haptic works where
  iOS allows it.

Why it exists at all:

- Unlike the haptic, Web Audio can play asynchronously: once an `AudioContext` has been resumed inside a user gesture,
  later playback needs no gesture. So if the scan haptic is blocked (5.5), sound is the only non-visual cue that
  reliably fires from the worker result, which matters when scanning a crate of 30 tins without looking at the phone.

Specification:

- The `AudioContext` is created and resumed inside the scan button `click` (the same gesture that opens the camera),
  only when the setting is on. The sample is decoded once and kept.
- Sound: a soft, short "tock" (wood-like, 40–60 ms, fast decay, peak about −18 dBFS), not a supermarket beep. One
  sound, only at scan success, never for unknown products, never anywhere else.
- Same frame as the visual and the haptic (started in the same `message` handler).
- Audio session: `navigator.audioSession.type = "ambient"` where supported. Ambient mixes with the user's music instead
  of interrupting it, and Web Audio on iOS is reported to obey the ringer / silent switch in this mode (research 10 §8,
  UNVERIFIED). `playback` is never used: it would play through the silent switch, which is wrong for a UI sound.
- Whether the camera's capture session interrupts or reconfigures the audio session on iOS is UNVERIFIED (section 10).

---

## 7. Performance

### 7.1 Properties

- Only `transform` (`x`, `y`, `scale`, `rotate`) and `opacity` animate. Colour changes are CSS transitions of 150 ms
  on the named properties (never `transition: all`). Width, height, top, left, margin, padding, border, border-radius,
  box-shadow, `filter` and `backdrop-filter` never animate.
- Transforms use px, computed from measured sizes at gesture or animation start; percentage transforms are avoided
  (historically not accelerated; research 18 §2.4).
- Shadows that must appear with a surface are pre-rendered on the surface or on a pseudo-element and ride along with its
  `transform` / `opacity`.

### 7.2 `will-change` policy

- Never permanent on list rows, never `will-change: all`.
- Set `will-change: transform` on `pointerdown` for the element about to be dragged (sheet, row, toast, top screen) and
  remove it when its spring settles.
- Sheets and the scanner cover carry `will-change: transform, opacity` from the frame they start opening until they
  close; at most two such layers exist at once.
- Motion may add `will-change` itself during its animations; that is acceptable as long as it is removed at rest
  (verify in the Web Inspector Layers panel).

### 7.3 Materials

- `backdrop-filter` radius is never animated, on any device, including iPhone 13 Pro (A15). Animating it re-renders the
  blur every frame. Materials appear and disappear by animating the `opacity` of a layer that is already blurred.
- At most three blurred layers on screen at once (tab bar, nav bar, one sheet surface). A sheet over the app does not
  add a fourth: the scrim is a solid colour layer, not a blur.
- The app root is not scaled behind sheets (choreography table). Scaling a root that contains two or three
  `backdrop-filter` layers forces them to re-render per frame in WebKit, and the status-bar area under
  `black-translucent` would show whatever lies behind the scaled root, which Cellier cannot style reliably in
  standalone. The scrim alone carries the depth.

### 7.4 Frame budget and refresh rate

- iPhone 13 / 14 / 15 run at 60 Hz: 16.7 ms per frame. iPhone 13 Pro / 14 Pro / 15 Pro can run at 120 Hz: 8.3 ms.
  Native scrolling is 120 Hz on ProMotion devices. Whether `requestAnimationFrame` runs at 120 Hz in an installed web
  app on those phones is UNVERIFIED (research 18 §6.1 found conflicting reports). Low Power Mode caps the display at
  60 Hz, and WebKit may throttle `requestAnimationFrame` further in that mode (UNVERIFIED).
- Design for 60 Hz and let 120 Hz be a bonus. Springs are time-based, so they look the same at both rates.
- During a gesture, JavaScript per frame stays under 4 ms (motion value writes only, no React renders, no layout
  reads). No DOM measurement during a drag: sizes are read once at `pointerdown`.

### 7.5 Layout animation limits

- No Motion `layout` prop on virtualised rows (4.2). `layout` / `layoutId` are allowed only on small, non-virtual groups
  of 5 children or fewer; the segmented thumb uses `x`, not `layoutId`.
- At most about 20 elements animate at once. If a change would move more, it is applied instantly.
- No animation starts while a scroll container has scrolled in the last 150 ms (momentum included). Realtime changes
  that arrive during a scroll apply instantly. Scroll-linked effects (large title, nav material) are the only motion
  tied to scrolling, and they write `opacity` only.

### 7.6 Device test protocol

Run on an iPhone 13 (60 Hz) and an iPhone 13 Pro or 15 Pro (120 Hz), in the installed web app, each release:

1. **Slow motion.** Film the screen with a second phone in slow motion (240 fps). Step through frame by frame:
   press response must begin within one display frame of the finger landing; sheet and row must stay under the finger
   with no lag; no frame may show a gap from spring overshoot (bleed check); the haptic click (audible on the film's
   audio track) must line up with the first visual frame of the scan success.
2. **Timelines.** Safari Web Inspector from a Mac, Timelines → Frames. Record: sheet open, sheet drag and fling,
   push / pop, edge swipe, scanner cover open (camera starting and worker warming at the same time), 15-row list remove,
   a burst of 10 scans. No frame over 16.7 ms on the 60 Hz phone; note any over 8.3 ms on the Pro.
3. **Layers.** Web Inspector Layers panel: count composited layers at rest (target ≤ 30) and check that `will-change`
   layers are released after animations.
4. **rAF rate.** A test page logs `requestAnimationFrame` deltas in the installed app on the Pro phone; record whether it
   reaches 120 Hz, in normal and Low Power Mode.
5. **Thermal.** Three minutes of continuous scanning (camera + worker + tray animations): no dropped frames in the tray,
   no visible stutter in the reticle impulse.
6. **Reduced motion.** Repeat 1 with Settings → Accessibility → Motion → Reduce Motion on, and again with "Prefer
   Cross-Fade Transitions" on.

---

## 8. Reduced motion

### 8.1 What `MotionConfig reducedMotion="user"` does

Research 18 §2.6 (verified on motion.dev): with `reducedMotion="user"`, Motion follows the device setting, and when
reduced motion is active **transform and layout animations are disabled while opacity and colour animations still
play**. Concretely, an `animate({ y, opacity })` with Reduce Motion on jumps `y` to its target and still animates
`opacity` with the given transition.

That default is not enough on its own, because opacity would still run on the original spring (for example the
0.42 s `push`). So Cellier also swaps the transition: `usePreset(name)` returns `presets.reduced` (0.18 s opacity tween,
`easeOut`) for every non-gesture transition, and components provide the explicit reduced alternative listed in the
choreography table (for example, a pushed screen fades in over its parent instead of sliding).

### 8.2 Rules

- No spatial movement that the user did not cause: no slides, no scale-ins, no parallax, no FLIP, no number pops,
  no digit rolls. These become opacity cross-fades or instant changes, per the table.
- Feedback that confirms an action stays legible: pressed colours, the reticle turning green, the tray row fading in,
  the toast fading in.
- **Exception: direct manipulation.** Dragging a sheet, a row, a toast, a tray, or the edge swipe still tracks the finger
  1:1: the motion is the user's own hand. On release, the element completes the short remaining distance with
  `snappy` and `bounce: 0` (no `fling` bounce), through a nested `MotionConfig reducedMotion="never"` scoped to those
  release animations only. This mirrors iOS, where Reduce Motion keeps interactive dismissals and scroll deceleration.
  Releases that dismiss fade with `reduced` instead of travelling off-screen.
- Native scroll, native bounce and the native switch are untouched (the platform handles them).
- The activity spinner keeps turning: it is status, not decoration.
- Haptics and sound are not motion and are unaffected by Reduce Motion; they have their own settings (5.4, 6).
- Colour transitions stay at 150 ms. The global "set every transition to 0.01 ms" CSS reset seen in research 20 §5 is
  not used, because it would also kill colour feedback.

---

## 9. Glossary

- **Presentation value:** the value an animated property has on screen right now, mid-animation, as opposed to the
  target it is heading to. Interrupted animations restart from it.
- **Velocity hand-off:** starting the release spring at the finger's measured velocity so dragging and animating join
  without a seam.
- **Momentum projection / `project()`:** estimating where a flicked element would come to rest under scroll-like
  deceleration (rate 0.998), then choosing the snap target nearest that point.
- **Rubber band:** progressive resistance past a boundary, `x·d·c / (d + c·|x|)` with `c = 0.55`; `d` is the maximum
  stretch.
- **Detent:** a resting height of a sheet (`fit`, `medium`, `large`).
- **Hysteresis / activation threshold:** the 10 px a finger must travel before a drag starts, so taps are not misread
  as drags.
- **Axis lock:** deciding once, at activation, whether a gesture is horizontal or vertical, and ignoring the other axis
  afterwards.
- **Commit threshold / arming:** the point in a drag beyond which releasing performs the action (dismiss, full-swipe
  action). Crossing it "arms" the action and fires the site-2 haptic.
- **Velocity sign veto:** at release, the direction the finger is moving overrides position: moving back means "cancel".
- **FLIP:** First, Last, Invert, Play. Record old positions, apply the new layout, offset elements back to where they
  were with a transform, then animate the transform to zero.
- **Ghost:** a temporary copy of a removed row that fades out in place while the rows below slide over it.
- **Bleed:** the 40 px of extra background on the overshoot side of a flung surface.
- **Scrim:** a solid black layer whose opacity dims what lies behind a sheet or a pushed screen.
- **Impulse:** starting a spring at its own target with an initial velocity, so the value bumps out and settles back
  (used for the number pop and the reticle).
- **visualDuration:** Motion's spring parameter for the time the motion visually takes to reach its target, including
  incoming velocity.
- **Damping ratio (ζ) / response:** Apple's spring parameters. ζ = 1 means no overshoot; lower bounces more. Response is
  the spring's natural period. Here ζ = 1 − bounce and response = 1.2 × visualDuration.
- **Transient / sticky activation:** HTML's notion of a recent user gesture (transient, expires after a short time) or
  any gesture since load (sticky). Haptics on iOS likely need the first.
- **ProMotion:** the 120 Hz adaptive display of iPhone 13 Pro, 14 Pro and 15 Pro.
- **Standalone:** the display mode of a web app opened from the Home Screen, without Safari's interface.

---

## 10. Items to verify on device

The owner decided to ship without waiting for a real-phone pass. Each item below ships with the value in the third
column. The iOS 26.3 simulator cannot exercise haptics, the camera, Home Screen gestures or ProMotion, so items 1–8
and 10 remain open for the first real-phone session.

| # | Item | Ships with (until a real-phone test says otherwise) |
|---|---|---|
| 1 | Switch haptic in the installed web app on iOS 18.x, 26.x, 26.5+ | Haptics are best effort; UI complete without them |
| 2 | Asynchronous haptic from a Worker message (5.5) | `scanHaptic` off |
| 3 | Haptic in `pointermove` at threshold crossing (5.3) | `hapticAtCrossing` off: fire on commit at `pointerup` |
| 4 | System edge-swipe back in standalone (3.6) | Custom gesture on in standalone only |
| 5 | Negative `scrollTop` during native bounce of an overflow container in standalone (3.8) | Pull to refresh dropped; sync indicator tappable |
| 6 | `requestAnimationFrame` at 120 Hz in the installed app (7.4) | Design for 60 Hz |
| 7 | `visualViewport` `resize` timing with the keyboard (3.2) | Reposition at the end with `snappy` |
| 8 | Web Audio in `ambient` obeys the silent switch, and survives the camera session (6) | Sound stays off by default |
| 9 | Motion's `{ bounce, visualDuration }` → stiffness / damping conversion (2.2) | **Verified** against `motion` 14.12.0: each preset's derived stiffness/damping curve stays within 0.11 % of travel of the `{ bounce, visualDuration }` curve over 1.5 s (peaks: `fling` 1.011, `pop` 1.045). Author with `{ bounce, visualDuration }` |
| 10 | Motion callbacks (`onDrag`) run outside event dispatch (5.3) | Own pointer handlers regardless |

---

## Deviations from the brief

1. **Drag releases under Reduce Motion use a short spring, not the `reduced` opacity tween.** The brief defines
   `reduced` as "0.18 s opacity cross-fade, no transform". For releases of a finger drag (sheet, row, toast, tray, edge
   swipe), a transform-free completion would make the element jump the remaining distance from under the user's finger.
   These releases use `snappy` with `bounce: 0`; dismissals still exit with `reduced`. Every non-gesture transition
   follows the brief exactly. Reason: iOS keeps interactive gestures under Reduce Motion, and a jump is more jarring
   than a short critically damped settle the finger itself started.
2. **The pressed highlight of list rows turns on instantly (0 ms) and off over 150 ms.** The brief says colour changes
   use 150 ms CSS transitions. A highlight that fades in over 150 ms would break the "respond on pointer-down" principle;
   only the release uses 150 ms. In scroll containers the highlight appears after an 80 ms hold (1.1), which is a
   scroll-disambiguation delay, not a colour transition.
3. **Android parity tick for switches (site 3).** The brief says the switch haptic is "free, by the platform". On
   Android there is no native switch haptic, so Cellier calls `navigator.vibrate([6])` on toggle there. Same site, same
   meaning; iOS behaviour is unchanged.

Not deviations, but decisions the brief left open: rows highlight instead of scaling (3.4); the app root is not scaled
behind sheets, the scrim carries depth (7.3); tabs switch instantly with no cross-fade (4.4); sound exists, off by
default (6). Research note 21 §6 claims a system back swipe in standalone; this document treats that claim as unverified
and specifies a gated custom gesture (3.6).
