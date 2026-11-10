# 19 - Interaction Craft Rulebook (for Cellier implementers)

Research date: 2026-11-10. Scope: Emil Kowalski (emilkowal.ski, Vaul, Sonner, animations.dev), Rauno Freiberg (rauno.me), Vercel Web Interface Guidelines, Apple WWDC18 "Designing Fluid Interfaces" and WWDC23 "Animate with springs".

## How to read this file

- **Source tags**: each rule ends with its source in brackets. Short names: `[EK-tips]` = https://emilkowal.ski/ui/7-practical-animation-tips, `[EK-good-vs-great]` = https://emilkowal.ski/ui/good-vs-great-animations, `[EK-great]` = https://emilkowal.ski/ui/great-animations, `[EK-transforms]` = https://emilkowal.ski/ui/css-transforms, `[EK-clip]` = https://emilkowal.ski/ui/the-magic-of-clip-path, `[EK-origin]` = https://emilkowal.ski/ui/origin-aware-animations, `[EK-toast]` = https://emilkowal.ski/ui/building-a-toast-component, `[EK-drawer]` = https://emilkowal.ski/ui/building-a-drawer-component, `[Vaul]` = https://github.com/emilkowalski/vaul (src/index.tsx, src/constants.ts, src/helpers.ts), `[Sonner]` = https://github.com/emilkowalski/sonner (src/index.tsx), `[ADEV]` = https://animations.dev/, `[VIG]` = https://github.com/vercel-labs/web-interface-guidelines (README and command.md), `[RF-craft]` = https://rauno.me/craft/interaction-design, `[WWDC18]` = https://developer.apple.com/videos/play/wwdc2018/803/, `[WWDC23-notes]` = https://wwdcnotes.com/notes/wwdc23/10158 (secondary).
- **UNVERIFIED** marks a value or claim I could not confirm in a primary source, or one that is my own inference. Do not ship an UNVERIFIED value without testing it.
- No value below is invented. Where a source gives no number, the rule says so.

## Source status (read this first)

| Brief item | Status |
|---|---|
| emilkowal.ski articles (tips, good-vs-great, great, transforms, clip-path, origin-aware, toast, drawer) | Fetched. Several URLs listed in the brief (e.g. `/ui/good-animations-are-not-fast-or-slow`, `/ui/how-can-the-background-be-animated`) return 404 and were dropped. |
| animations.dev | Fetched the public landing page only. It is a course sales page with no numeric rules. Rules attributed to it come from the course outline and the "Great animations" article. |
| Vaul / Sonner source | Fetched `src/index.tsx`, `src/helpers.ts`, `src/constants.ts` (Vaul) and `src/index.tsx` (Sonner). Their `styles.css` files were **not** fetched, so toast/drawer CSS easings are UNVERIFIED. |
| Emil's own cubic-bezier values | Only secondary sources (mirrors/gists of his `emil-design-eng` skill) were found. The primary `SKILL.md` URL returned 404. Treat the curves in section 3 as UNVERIFIED against the primary source. |
| Vercel "Web Interface Guidelines" | Fetched from `vercel-labs/web-interface-guidelines`. Its README thanks Adam, Jimmy, Jonnie, Lochie, Paco, Joe, Austin. **Emil is not named there.** The claim that Emil contributed is UNVERIFIED. |
| Rauno "Web Interface Guidelines" | **Not found.** Only "Invisible Details of Interaction Design" (`rauno.me/craft/interaction-design`) was fetched. It contains no numeric values. |
| WWDC18 "Designing Fluid Interfaces" | Fetched via the session page (transcript summary). Principles are sourced; no numeric projection formula is given. |
| WWDC23 "Animate with springs" | The session page did not yield the transcript. Defaults come from a secondary note. Apple's `Spring` docs page returned only its title. Default values are UNVERIFIED. |

---

## 1. When to animate, and when not to

1. **Animate only when it serves a purpose.** Purposes listed: explaining how something works, indicating a state change, animating a modal's enter or exit. `[Sonner-ish: ADEV "Frequency and purpose"]`
2. **Frequency decides.** Remove animations or hover effects for interactions users repeat many times a day, since they become annoying and make the interface feel slower. `[EK-tips, rule 6]`
3. **Never animate keyboard-initiated actions.** Quoted from the animations.dev page: "Never animate keyboard initiated actions," because they can repeat "hundreds of times a day." `[ADEV]`
4. **Functional data does not animate.** Example given: a functional graph such as a banking app's should not animate at all. `[EK-good-vs-great]`
5. **Do not add animations everywhere.** Users can get overwhelmed and animations lose their impact. `[ADEV]`
6. **Repetition dulls motion.** Quoted from Rauno: animation can become "cognitive burden after seeing the same animation for the hundredth time." After removing motion from a high-frequency interaction, he "suddenly felt like I was moving much faster." Context menus and the macOS app switcher appear without animation. `[RF-craft, Frequency & Novelty]`
7. **Instant changes are sometimes better on the web.** Emil says so but does not say when. `[EK-good-vs-great]` (UNVERIFIED on the threshold)

**Cellier rule of thumb:** keyboard shortcuts, search-as-you-type, list filtering, and any action the user repeats per session get no motion, or a 0 ms state change. Sheets, toasts, and first-time onboarding get motion.

---

## 2. Duration

- **Keep UI animation under 300 ms.** Quoted: UI animations should generally stay under `300ms`. `[EK-tips, rule 6]`. Quoted from the animations.dev reading: animations should usually be "shorter than 300ms." `[ADEV]`
- A **180 ms** select animation "feels more responsive than a 400ms one." `[EK-tips, rule 6]`
- The Raycast example criticises a "500ms enter animation" for a keyboard-opened interface. `[ADEV]`
- A dropdown at **300 ms** with `ease-out` "felt faster" than the same duration with `ease`. `[EK-tips, rule 4]`
- Tooltip exit/enter in Emil's example: `0.125s` (`125ms`) `ease-out`. `[EK-tips, rule 3]`
- Toast enter: `400ms ease`. `[EK-toast, Enter animation]`
- Toast exit completion window: `TIME_BEFORE_UNMOUNT = 200` ms, which "matches exit animation duration". `[Sonner]`
- Drawer: `0.5s` (500 ms), which Emil says "mimic[s] iOS's Sheet". `[EK-drawer; Vaul constants TRANSITIONS.DURATION = 0.5]`
- Clip-path image reveal: `1s` (1000 ms). `[EK-clip]`
- Reduced-motion example: `0.2s` for both bounce and fade. `[ADEV]`
- Faster spinners "make an app seem to load faster". `[EK-tips, rule 6]`

**Ranges to use (derived; UNVERIFIED as a rule, consistent with the above):**
- Press feedback: 100-150 ms.
- Tooltips, popovers, selects, dropdowns: 125-200 ms.
- Sheets, drawers: ~500 ms (Vaul default).
- Toast enter: ~400 ms; toast exit: ~200 ms.
- Anything over 300 ms needs a reason in review.

---

## 3. Easing

- **Use `ease-out` for elements entering or exiting.** It starts fast, which feels responsive. `[EK-tips, rule 4]`
- **Avoid `ease-in` for UI.** It speeds up at the end, "the opposite of what UI needs." `[EK-tips, rule 4]`
- **Built-in CSS easings are usually not strong enough.** Use custom curves. `[EK-tips; EK-good-vs-great]`
- **For elements already on screen, use `ease-in-out`.** So motion mimics natural acceleration and deceleration. `[EK-good-vs-great]`
- **`ease` is fine for basic hover effects** such as background colour. Anything else needs a custom curve. `[EK-good-vs-great]`
- **Recommended tools for custom curves:** easing.dev and easings.co. No values are given in the article. `[EK-good-vs-great]`. Emil's "great animations" article uses `ease` for the Sonner toast for a more elegant feel. `[ADEV/EK-great]`

### Exact curves (from Emil's skill, via secondary sources; UNVERIFIED against primary)

```css
:root {
  /* strong ease-out for UI interactions; = easeOutQuint */
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  /* strong ease-in-out for on-screen movement; labelled ease-in-out in the skill */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
}
```

- `cubic-bezier(0.23, 1, 0.32, 1)`: the ease-out curve. Secondary source calls it the quint ease-out. UNVERIFIED.
- `cubic-bezier(0.77, 0, 0.175, 1)`: the in-out curve. Secondary sources disagree on its name (one calls it quart in-out, Tailwind's quint in-out is `(0.86, 0, 0.07, 1)`). UNVERIFIED name. Used for the 1 s clip-path image reveal in `[EK-clip]`, which confirms the value appears in Emil's own work. `[EK-clip]`
- `cubic-bezier(0.32, 0.72, 0, 1)`: the **iOS-like drawer curve** used by Vaul as `TRANSITIONS.EASE`. Vaul credits it to Ionic Framework. `[Vaul constants.ts; EK-drawer]`

**Drawer transition (exact, from Vaul/EK-drawer):**
```css
transform 0.5s cubic-bezier(0.32, 0.72, 0, 1);
```

- Ease-in is banned for UI (see above).
- No cubic-bezier for the Sonner or Vaul CSS `styles.css` could be verified. UNVERIFIED.

---

## 4. Springs vs easing

- **Springs are for decorative, physically driven motion.** Emil: springs are for decorative animations. Functional UI should not animate at all. `[EK-good-vs-great]`
- **Mouse-driven values should not be bound 1:1 to the cursor.** Emil uses a spring (`useSpring`, now Motion) so values interpolate. `[EK-good-vs-great]`
- **Gesture-driven motion with momentum should have a little overshoot.** Apple: "if the gesture that's driving the motion itself has momentum, then you should reward that momentum with a little bit of overshoot." `[WWDC18]`
- **Damping as a design control.** Apple: "100% damping, where there will be no overshoot to 0% damping where the spring would oscillate indefinitely." Recommended start: "we recommend starting with 100% damping, or no overshoot." Music app example: tap to show Now Playing at 100% damping; swipe to dismiss at 80% damping. `[WWDC18]`
- **Avoid "duration" as the mental model for springs.** Apple: it "reinforces this concept of constant dynamic change." `[WWDC18]`
- Emil's Motion/Framer springs: no exact stiffness/damping values are given. UNVERIFIED for numbers.

### Apple spring parameterisation (WWDC23 "Animate with springs")

- Parameters are `duration` and `bounce`. Bounce range is -1.0 to 1.0. Secondary notes say values above about 0.4 "may feel too exaggerated for a UI element." `[WWDC23-notes]`
- Presets (names from the secondary note of WWDC23 "Explore SwiftUI animation"): `smooth` (no bounce, the default in `withAnimation` since iOS 17), `snappy` (small bounce), `bouncy` (medium bounce). `[WWDC23-notes, secondary]`
- **Defaults:** secondary notes say "when you're not sure, use a spring with bounce 0". The docs-level default (`duration 0.5`, `bounce 0.0`) is recalled from memory and is **UNVERIFIED**. Check `developer.apple.com/documentation/swiftui/spring` before relying on it.
- Apple's own physics form (mass, stiffness, damping) is what the duration/bounce form is built on. `[WWDC18]`

```swift
// SwiftUI, parameterised by duration + bounce (WWDC23 form)
withAnimation(.spring(duration: 0.5, bounce: 0.0)) { isOpen.toggle() }  // no overshoot (UNVERIFIED default values)
withAnimation(.spring(duration: 0.5, bounce: 0.2)) { /* gesture release with momentum */ }
```

**Decision rule:** UI state change with no momentum: easing curve (section 3). Gesture release or decorative motion: spring. Use 0 bounce for sheets and popovers. Reserve bounce for drag releases that carry velocity.

---

## 5. Origin-aware animations (transform-origin)

- **The default `transform-origin: center` is wrong for most popovers.** Popovers should scale in from their trigger. `[EK-tips, rule 5]`
- **Dropdown from a button:** `transform-origin: bottom center`. `[EK-good-vs-great]`
- **Radix and Base UI expose CSS variables:**
```css
.radix  { transform-origin: var(--radix-dropdown-menu-content-transform-origin); }
.radix-popover { transform-origin: var(--radix-popover-content-transform-origin); }
.baseui { transform-origin: var(--transform-origin); }
```
`[EK-tips; EK-good-vs-great]`
- Animating from the origin "feels more natural, and this is often overlooked." `[EK-origin]`
- **SVG:** transforms on a `<g>` wrapper with `transform-box: fill-box; transform-origin: center`. `[VIG]`
- **Set the correct `transform-origin`.** `[VIG]`

**Cellier:** a sheet opened from a tab-bar button scales from its trigger. A sheet opened from the screen edge uses the bottom or edge origin, not centre.

---

## 6. Scale on press and scale start values

- **Button press:** `transform: scale(0.97)` on `:active`, with a short ease-out transition. `[EK-tips, rule 1]`
- **Tooltip / popover enter start:** `scale(0.97)` with `opacity: 0`, `transition: transform 0.125s ease-out, opacity 0.125s ease-out`. `[EK-tips, rule 3]`
- **Never animate from `scale(0)`.** Quoted: "scale(0) feels wrong because it looks like the element comes out of nowhere." Start at `0.9` or above; Emil's example uses `0.93`. `[EK-tips, rule 2]`
- **Agents with Taste:** `scale(0.95)` as the starting value for elements that would otherwise appear from nothing. Source is a search summary of `emilkowal.ski/ui/agents-with-taste` (not fetched); UNVERIFIED.
- **Almost never animate from `scale(0)`.** Combine an initial scale like `0.5` with an opacity animation instead. `[EK-transforms]` (Note: this contradicts the 0.9 advice only in degree; use 0.9-0.95 for popovers, 0.5 + opacity for large surfaces.)
- Avoid mismatched axis scaling (`scaleX` vs `scaleY`) because "they usually look awkward." `[EK-transforms]`
- Scaling also scales children (font size and icons). Use width/height if the child must keep its size. `[EK-transforms]` (inference, UNVERIFIED on the width/height advice)

```css
button { transition: transform 150ms var(--ease-out); }
button:active { transform: scale(0.97); }
```

---

## 7. Enter vs exit asymmetry

- Enter and exit both use `ease-out` per Emil's rule. `[EK-tips, rule 4]`
- Toast exit has its own unmount delay of 200 ms, matching the exit duration. `[Sonner]`
- **Exit should be quicker than enter.** Not stated numerically in the sources; UNVERIFIED as a rule. Derived from the 200 ms toast exit versus 400 ms toast enter `[EK-toast; Sonner]`.
- Spatial consistency: an element "should have a consistent offscreen path as it enters and leaves." `[WWDC18]`
- Hinting: an object "should transition smoothly between these two states in a way that it grows from the initial state to the final state." Control Center modules grow "up and out towards your finger" before they "pop open." `[WWDC18]`
- Dynamic Island: "The Clock app will never open from its icon. It always jumps out from the Island, even when expanded." `[RF-craft, Spatial Consistency]`

---

## 8. Interruptibility and redirection

- **Animations must be interruptible.** Users can change state at any time. CSS transitions "can redirect smoothly to a new value even before the previous transition finishes." `[ADEV]`
- Vercel: "Animations interruptible—respond to user input mid-animation." `[VIG]`
- Apple: "we built a fully redirectable interface." "the thought and gesture happen in parallel." `[WWDC18]`
- Anti-pattern (Rauno): Settings is criticised because "swiping back immediately does not interrupt the animation — you have to wait for it to end." `[RF-craft]`
- Rauno: the app-dismiss gesture "retains the momentum and angle at which it was thrown." `[RF-craft]`
- Apple: "The iOS App Switcher will never dismiss an app before the gesture ends." (destructive actions only commit at gesture end) `[RF-craft]`
- Lightweight actions (overlays) can trigger during the swipe. `[RF-craft]`

**Implementation (UNVERIFIED pattern, consistent with the quotes):** drive interruptible motion from a value that is retargeted on each input, not from a keyframe that must finish. For CSS, a changing `transform` target does this natively; for JS, re-spring from the current value and current velocity.

---

## 9. Gestures: tracking, momentum, drawers

### 9.1 Principles (Apple WWDC18)

1. **Response:** "Everything needs to respond instantly." Look for delays "everywhere": taps, presses, every interaction. Avoid timers where possible.
2. **Redirection and interruption:** see section 8.
3. **1:1 tracking:** "When swiping or dragging, the contents should stay attached to the gesture." Hysteresis "is usually 10 points in iOS." Never drag from the image centre; use the touch's relative position. Use touch history so motion transfers fully on release.
4. **Spatial consistency:** consistent offscreen path in and out.
5. **Hinting:** grow from the initial to the final state; do not pop.
6. **Rubber-banding:** "we're softly indicating boundaries of the interface." Without it, "you actually wouldn't know the difference between a frozen phone, and phone that's just at the top of the edge of the screen."
7. **Momentum projection:** "Don't just use position, use all of the information that's at your disposal." Compute a projected endpoint from velocity and deceleration, then retarget there. Apple names `UIScrollView.DecelerationRate` as the deceleration source; no numeric default is in the transcript summary. UNVERIFIED for the numeric projection formula.

Apple's frame-rate point: "it's not just about framerate. It's what's in the frames." `[WWDC18]`

### 9.2 Drawer thresholds (Vaul, exact)

From `src/constants.ts` and `src/index.tsx` `[Vaul]`:

| Constant | Value | Meaning |
|---|---|---|
| `CLOSE_THRESHOLD` | `0.25` | Fraction of the drawer dragged to close (JSDoc default `@default 0.25`) |
| `VELOCITY_THRESHOLD` | `0.4` | Velocity above which a flick closes. Velocity = `Math.abs(distMoved) / timeTaken` (px/ms) |
| `WINDOW_TOP_OFFSET` | `26` | Top gap for the scaled background (px) |
| `NESTED_DISPLACEMENT` | `16` | Nested drawer displacement (px) |
| `BORDER_RADIUS` | `8` | Drawer corner radius (px) |
| `TRANSITIONS.DURATION` | `0.5` | Seconds |
| `TRANSITIONS.EASE` | `[0.32, 0.72, 0, 1]` | Easing curve |
| `SCROLL_LOCK_TIMEOUT` | `100` | ms. Blocks drag for 100 ms after reaching scroll top again `[EK-drawer]` |

Other hardcoded values in Vaul `[Vaul]`:
- Open grace period: `< 500` ms after open, closing is ignored.
- Nested close reset: `setTimeout(..., 500)`.
- Just-released flag: `velocity > 0.05` sets `justReleased` for `200` ms.
- Handle long press: `250` ms. Double tap: `120` ms.
- Swipe start threshold: `10` px for touch, `2` px otherwise.
- Keyboard change detection: `> 60` px change in viewport height.
- "Tall enough" drawer: `drawerHeight > totalHeight * 0.8`.

**Dismissal rule (Cellier):** close when `dragged >= 0.25 * height` OR `velocity > 0.4 px/ms`, on release, in the close direction.

### 9.3 Damping past bounds

- **Vaul's damping function** (`src/helpers.ts`, exact): `return 8 * (Math.log(v + 1) - 2);`. `[Vaul]` UNVERIFIED for usage: as written it returns negative values for small `v`, so the call site must be read before reuse. Do not copy the formula blindly.
- **Sonner's damping** for swipes outside the allowed direction: `const factor = Math.abs(delta) / 20; return 1 / (1.5 + factor);`. `[Sonner]`
- Vaul: "the drawer will damp the drag" when dragging up past the top. No factor given in the article. `[EK-drawer]`

**Cellier:** use Sonner's form for rubber-banding past bounds (exact, verified). Use a 1/(1.5 + |d|/20) style factor so the tracked motion slows smoothly.

### 9.4 Snap points

- Snap points can be "a fraction of the viewport or a fixed value in pixels." Vaul accepts numbers 0-100 or px strings, example `[0.2, 0.5, 0.8]`. `[EK-drawer; Vaul]`
- On release, the drawer snaps to the closest point. A hard flick can skip points or close the drawer. `[EK-drawer]`
- `snapToSequentialPoint` defaults to `false`. `fadeFromIndex` defaults to `snapPoints.length - 1`. `[Vaul]`
- Apple: project the release target from velocity; do not snap to the nearest point on position alone (section 9.1, item 7). UNVERIFIED for the exact Cellier formula.

### 9.5 Background scale behind a sheet (Vaul, exact)

- Base scale: `(window.innerWidth - WINDOW_TOP_OFFSET) / window.innerWidth` (with `WINDOW_TOP_OFFSET = 26`). `[Vaul]`
- During drag: `Math.min(getScale() + percentageDragged * (1 - getScale()), 1)`. `[Vaul]`
- Background radius during drag: `8 - percentageDragged * 8` px (8 to 0). `[Vaul]`
- Background translate during drag: `Math.max(0, 14 - percentageDragged * 14)` px. `[Vaul]`
- Overlay opacity while dragging: `1 - percentageDragged`. `[Vaul]`
- Nested drawer: scale `(innerWidth - 16) / innerWidth`, translate `-16` px. `[Vaul]`
- Dragging sets `transition: none` for the element. `[Vaul]`
- Emil: "Dragging the drawer down by 40% will change the border radius to 60% of its max value." `[EK-drawer]`

```css
/* background wrapper, values from Vaul; scale is set inline in JS */
[data-vaul-drawer-wrapper] { transition: transform 0.5s cubic-bezier(0.32, 0.72, 0, 1); }
```

Note: Emil says "We used 10ms, because we have 50 colors and our CSS transition is 500ms" for Safari theme-colour interpolation (50 steps, 10 ms cadence). `[EK-drawer]`.

---

## 10. Toasts (Sonner, Emil's toast write-up)

Constants `[Sonner]`:
- `VISIBLE_TOASTS_AMOUNT = 3`
- `TOAST_LIFETIME = 4000` ms (auto-dismiss). Pauses on hover, interaction, and when `document.hidden`. `[EK-toast; Sonner]`
- `SWIPE_THRESHOLD = 45` px
- Dismissal velocity: `Math.abs(swipeAmount) >= SWIPE_THRESHOLD || velocity > 0.11`. Velocity = `Math.abs(swipeAmount) / timeTaken`. `[Sonner]`
- Direction locks once movement exceeds 1 px (`Math.abs(xDelta) > 1 || Math.abs(yDelta) > 1`). `[Sonner]`
- `TIME_BEFORE_UNMOUNT = 200` ms. `[Sonner]`
- `TOAST_WIDTH = 356`, `GAP = 14`, `VIEWPORT_OFFSET = 24px`, `MOBILE_VIEWPORT_OFFSET = 16px`. `[Sonner]`
- Z-index: `toasts.length - index`. Offset: `heightIndex * gap + toastsHeightBefore`. `[Sonner]`

Stacking (Emil's toast write-up, `[EK-toast]`):
- Stack Y offset = gap times index: `Y(-14px)` for the next, `Y(-28px)` for the one after, `Y(0)` for the front.
- Scale drops `0.05` per index: `scale(0.95)`, `scale(0.9)`, `scale(1)` for the front.
- Stacked toasts match the front toast's height.
- Enter: `transform 400ms ease`, from `translateY(100%)` to `translateY(0)`, driven by `data-mounted`. The article suggests `@starting-style` as an alternative.
- Pointer: capture all pointer events on drag start so dragging continues when the pointer leaves the toast. Use `::after` pseudo-elements to fill gaps so hover is stable.
- Dragging up past the limit: friction, then it stops (rather than a hard stop). `[EK-toast]`

**Cellier note:** the 45 px / 0.11 px-per-ms pair belongs to toasts. Drawers use 0.25 and 0.4. Do not mix them.

---

## 11. Tooltips

- **Keep the delay before the first tooltip.** Once one is open, neighbours open with no delay and no animation. `[EK-tips, rule 3]`
- Implementation: `[data-instant] { transition-duration: 0ms; }`. Base UI and Radix skip the delay after the first tooltip. `[EK-tips]`
- Vercel: "Only the first tooltip in a group has a delay; peers have none." `[VIG]`
- Tooltip CSS (exact, from `[EK-tips]`):

```css
.tooltip {
  transition: transform 0.125s ease-out, opacity 0.125s ease-out;
  transform-origin: var(--transform-origin);
  &[data-starting-style], &[data-ending-style] { opacity: 0; transform: scale(0.97); }
  &[data-instant] { transition-duration: 0ms; }
}
```

- Loading indicators: show-delay of about 150-300 ms, minimum visible about 300-500 ms. `[VIG]`

---

## 12. Clip-path, blur, crossfades

- `clip-path` has no effect on layout. `[EK-clip]`
- Shapes: `clip-path: circle(50% at 50% 50%);`. `[EK-clip]`
- Hide whole: `inset(100%)`. Right half: `inset(0 50% 0 0)`. Bottom half: `inset(0 0 50% 0)`. `[EK-clip]`
- Image reveal: `inset(0 0 100% 0)` to `inset(0 0 0 0)`, `1s`, `forwards`, `cubic-bezier(0.77, 0, 0.175, 1)`. `[EK-clip]`
- Theme switch: same inset reveal, 1 s, same easing. `[EK-clip]`
- Tabs: a duplicated, active-styled list clipped with `inset(0px 75% 0px 0% round 17px)`, animated to reveal the new tab. Duration not given. `[EK-clip]`
- Why clip-path for tabs: "makes the color transition blend with the highlighted tab." `[EK-good-vs-great]`
- **Blur:** if easing and duration tweaks still feel off, add `filter: blur(2px)`. Blur blends old and new states in a crossfade. Combine with the 0.97 press scale. `[EK-tips, rule 7]`
- The clip-path article does not mention blur. Blur is in the tips article only.

---

## 13. Hover, touch, hit targets, focus, typography, reduced motion

### Hover vs touch

- The Vercel guidelines give no `@media (hover: hover)` rule. Their only media-query rule is `@media (pointer: fine)` for overscroll suppression: "Page rubber-band suppression: `overscroll-behavior: none` on `<html>` inside `@media (pointer: fine)`." `[VIG]`
- Buttons and links need a `hover:` state. `[VIG]`
- Interactive states increase contrast: hover/active/focus more prominent than rest. `[VIG]`
- Use `@media (hover: hover) { ... }` to gate hover-only effects. **UNVERIFIED** (standard CSS, not in the sources; use it for touch devices, the PWA target).

### Hit targets

- "Hit targets are at least 24px. On mobile, they are at least 44px." `[VIG]`
- Checkboxes/radios: label and control share one hit target (no dead zones). `[VIG]`
- Input font size at least 16px on mobile (or viewport meta). `[VIG]`
- Fitts: "The bigger the target, and the closer it is to where your pointer is, the better." Screen-edge corners have infinite size because "the pointer can't overshoot past the corner." `[RF-craft]`

### Focus

- Interactive elements need visible focus: `focus-visible:ring-*` or equivalent. `[VIG]`
- Never `outline: none` without a focus replacement. `[VIG]`
- Use `:focus-visible` over `:focus` (no ring on click). `[VIG]`
- Group focus with `:focus-within` for compound controls. `[VIG]`

### Typography

- `font-variant-numeric: tabular-nums` for number columns and comparisons. `[VIG]`
- `text-wrap: balance` or `text-pretty` on headings. `[VIG]`
- Optical alignment, font smoothing: **no source found. UNVERIFIED / not covered.**
- Shadows instead of borders: **no source found. UNVERIFIED / not covered.**

### Reduced motion

- Honour `prefers-reduced-motion` (provide a reduced variant or disable). `[VIG]`
- Muted decorative loops must stop under `prefers-reduced-motion`. `[VIG]`
- CSS: swap bounce for fade with `@media (prefers-reduced-motion: reduce)`. `[ADEV]`
- Framer/Motion: `useReducedMotion`, and set the x offset to `0` instead of `"-100%"` when reduced motion is preferred. `[ADEV]`
- Autoplay motion over 5 s alongside other content needs pause, stop, or hide controls. `[VIG]`

```css
@media (prefers-reduced-motion: reduce) {
  .sheet, .toast { transition-duration: 0.2s; animation: none; }
  .fade-only { transition: opacity 0.2s ease-out; }
}
```
(The `0.2s` value is from `[ADEV]`; the rest of the snippet is my construction, UNVERIFIED as a pattern.)

---

## 14. Performance

- **Animate `transform` and `opacity` only.** Vercel: "Animate `transform`/`opacity` only (compositor-friendly)." Emil: padding and margin trigger layout, paint and composite. `[VIG; ADEV]`
- **Never `transition: all`.** List properties explicitly. `[VIG]`
- Use CSS or WAAPI when the main thread is busy; hardware-accelerated animations stay smooth. Aim for 60 fps. `[ADEV]`
- **No layout reads in render** (`getBoundingClientRect`, `offsetHeight`, `offsetWidth`, `scrollTop`). Batch DOM reads and writes. `[VIG]`
- Large lists (>50 items): virtualise or use `content-visibility: auto`. `[VIG]`
- Vaul renders drag position with `transform: translateY(...)` set directly on the element, not via an inherited CSS variable. `[EK-drawer]`. This is the source-backed reason to avoid driving per-frame drag through a CSS variable on a parent: it forces style recalculation of the subtree. The "recalculation" explanation is UNVERIFIED as a measured claim.
- **`will-change`**: no source found. UNVERIFIED. Use only on an element that is about to animate, then remove it.
- Apple: "look for delays everywhere" and touch-level gesture recognisers that report position and velocity, not only at gesture end. `[WWDC18]`
- Long POST/PATCH/DELETE under 500 ms; above-the-fold images preloaded; rest lazy. `[VIG]`

---

## 15. Apple fluid-interface principles (WWDC18 summary)

| Principle | Rule | Cellier use |
|---|---|---|
| Response | Instant, no timers in gesture detection | Start drag on pointerdown, no delay |
| Redirection and interruption | Layer and redirect gestures mid-motion | Re-target on each input |
| 1:1 tracking | Content stays under the finger; hysteresis ~10 pt | Sheets track the touch exactly |
| Spatial consistency | Same offscreen path in and out | Sheet exits the way it entered |
| Hinting | Grow towards the final state | Morph from trigger, not pop |
| Rubber-banding | Soft boundary, never a hard stop | Use Sonner's damping |
| Momentum projection | Project endpoint from velocity and deceleration | Choose snap from projected endpoint |

Apple's teaching points: "think about animation and behavior more as a conversation between you and the object"; "show rather than tell"; gestures that report position, velocity and size. `[WWDC18]`

---

## 16. One-page review checklist

Apply during design or code review. Each item is pass/fail.

**Purpose and frequency**
- [ ] Does the motion explain a state change or a spatial relation? If not, remove it.
- [ ] Is it triggered by a keyboard shortcut or by a high-frequency action? If yes, no animation.
- [ ] Is the motion functional data (charts, numbers)? If yes, no animation.

**Timing**
- [ ] Duration is under 300 ms for UI, or it has a stated reason (sheets ~500 ms).
- [ ] Enter and exit use `ease-out` (or the custom curve). No `ease-in`.
- [ ] Easing is custom (`--ease-out`, `cubic-bezier(0.23, 1, 0.32, 1)`) rather than the built-in `ease`, except for hover colour.
- [ ] Gesture-driven releases use a spring with bounce only when velocity is present.

**Origin and scale**
- [ ] Popovers, dropdowns and tooltips set `transform-origin` from the trigger.
- [ ] Press feedback is `scale(0.97)` on `:active`.
- [ ] No animation starts from `scale(0)`. Start at 0.9-0.95 or use 0.5 + opacity.

**Gestures**
- [ ] Content tracks the touch 1:1 with ~10 pt hysteresis.
- [ ] Release closes on `dragged >= 0.25 * height` OR `velocity > 0.4 px/ms` (drawers). Toasts: `45 px` OR `0.11 px/ms`.
- [ ] Past-bounds motion is damped, not hard-stopped.
- [ ] Snap is chosen from projected endpoint, not position alone.
- [ ] Interrupting mid-animation redirects immediately.

**Stacking and background**
- [ ] Background behind a sheet scales to `(innerWidth - 26) / innerWidth`, radius 8 px, with progress-linked changes.
- [ ] Toast stack: gap 14 px, scale -0.05 per index, max 3 visible, 4000 ms lifetime, pauses on hover and hidden tab.

**Tooltips**
- [ ] First tooltip has a delay; neighbours are instant (`data-instant`).

**Touch and hover**
- [ ] Hover effects gated by `@media (hover: hover)` (UNVERIFIED pattern).
- [ ] Hit targets >= 24 px, >= 44 px on mobile.
- [ ] Inputs >= 16 px on mobile.

**Accessibility and polish**
- [ ] `prefers-reduced-motion` respected; decorative loops stop.
- [ ] `:focus-visible` ring present; no bare `outline: none`.
- [ ] Numbers that change use `tabular-nums`.
- [ ] Headings use `text-wrap: balance` or `text-pretty`.

**Performance**
- [ ] Only `transform` and `opacity` animate. No `transition: all`.
- [ ] No layout reads during a drag frame.
- [ ] Per-frame drag sets `transform` on the element, not via an inherited CSS variable.

---

## 17. Anti-patterns

1. Animating keyboard-triggered actions. `[ADEV]`
2. Animating from `scale(0)`. `[EK-tips; EK-transforms]`
3. `ease-in` on UI. `[EK-tips]`
4. Default `transform-origin: center` on a popover. `[EK-tips]`
5. Built-in CSS easings for everything. `[EK-tips]`
6. Animating a 500 ms enter for a keyboard-opened UI. `[ADEV]`
7. Animating padding or margin instead of transform. `[VIG; ADEV]`
8. `transition: all`. `[VIG]`
9. `outline: none` with no focus replacement. `[VIG]`
10. Hard-stopping a drag past bounds instead of rubber-banding. `[WWDC18]`
11. Non-interruptible animations: "you have to wait for it to end." `[RF-craft]`
12. Animating a functional graph. `[EK-good-vs-great]`
13. Delaying every tooltip, not just the first. `[EK-tips; VIG]`
14. Animating every element; "Users can get overwhelmed." `[ADEV]`
15. Mismatched axis scales (`scaleX` vs `scaleY`) that "usually look awkward." `[EK-transforms]`
16. Gesture recognisers that report only at completion (e.g. `UISwipeGestureRecognizer` pattern). `[WWDC18]`
17. Dragging from the element centre rather than the touch's relative position. `[WWDC18]`
18. Pinch-to-zoom that "exponentially zoom[s] in after a certain threshold." `[RF-craft]`
19. Animating the trigger's `scale` from `1` with no origin and no press feedback. Covered by 4 and the press rule.
20. Motion that does not respect `prefers-reduced-motion`. `[VIG]`

---

## 18. Gaps and what to verify next

- Emil's primary `emil-design-eng` SKILL.md (`github.com/emilkowalski/skills`) was not fetched; ease-out and ease-in-out values are UNVERIFIED.
- Sonner and Vaul `styles.css` not fetched; CSS easings and durations for those components are UNVERIFIED beyond the JS constants.
- Apple WWDC23 "Animate with springs" transcript not retrieved; `Spring` defaults (`duration 0.5`, `bounce 0.0`) are UNVERIFIED.
- Rauno "Web Interface Guidelines" not found; the Vercel guideline attribution to Emil is UNVERIFIED (not named in the README).
- Rauno "Invisible Details" contains no numeric values; its rules are qualitative.
- animations.dev public page has no numeric rules. The course material is paid.
- `will-change`, shadow-vs-border, optical alignment, font smoothing, and `@media (hover: hover)`: no primary source found.
