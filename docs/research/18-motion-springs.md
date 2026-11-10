# 18. Animation toolkit for Cellier (Motion, springs, CSS-native, sheets, toasts, iOS performance)

Research date: 2026-11-10. Target: iPhone 13 to 15 Pro, iOS Safari and home-screen PWA.
Legend: **[V]** verified in a fetched primary source during this research. **UNVERIFIED** means not confirmed; check before relying on it.

---

## 1. Summary

- **Motion for React** (`motion` package, formerly `framer-motion`) is the animation core. Report says current major is **14.0** [V, motion.dev upgrade guide]. Verify the exact latest patch on npm before pinning.
- **Bundle strategy:** use `LazyMotion` with the `m` component from `motion/react-m` everywhere; keep `motion` only where the feature set needs it. Use the mini `animate` for one-off value tweens. Load features asynchronously if the first paint needs to be fast.
- **Springs:** author them as `{ bounce, visualDuration }` or `{ duration, bounce }`. Use stiffness/damping/mass only when you need physical control. Prefer transform and opacity only.
- **CSS-native first** for simple enter/exit and state transitions where Safari support is adequate (`linear()` easing, `@starting-style`, `transition-behavior: allow-discrete`). Use Motion for gestures, interruption, shared layout and velocity hand-off.
- **Sheets:** Vaul is still the best-documented iOS sheet, but its own maintenance status is unclear and the ecosystem is moving to Base UI. Decide after a spike on device.
- **Toasts:** `sonner`. Not re-verified in this pass (see Section 9).

---

## 2. Motion for React

### 2.1 Versions and imports

| Item | Finding | Status |
|---|---|---|
| Current major | 14.0. Upgrade guide says "There are no breaking changes in Motion for React in version 14." It deprecates some internal APIs and tightens versioning between internal dependencies. | [V] https://motion.dev/docs/react-upgrade-guide |
| Migration from framer-motion | Uninstall `framer-motion`, install `motion`, change imports to `motion/react`. | [V] same page |
| Breaking-change history relevant to Cellier | v13: `@emotion/is-prop-valid` removed as optional dep. v11: `MotionValue` velocity calculation changed. v10: `AnimatePresence exitBeforeEnter` throws; use `mode="wait"`. v9: tap events keyboard-accessible (`tabindex="0"` added). | [V] same page |
| `motion/react-m` | Import path for the `m` component, used inside `LazyMotion`. | [V] https://motion.dev/docs/react-lazy-motion |
| React support | v7 set `react@18` minimum. Current peer range not re-checked. | UNVERIFIED for React 19 peer range on v14 |

### 2.2 Bundle size and how to minimise it

| Approach | Size per source | Status |
|---|---|---|
| `motion` component (full feature set) | "around 43kb" | [V] figure from docs page; may be out of date for v14. UNVERIFIED for v14. |
| `LazyMotion` + `m` initial render | "as low as 5kb" | [V] same page; UNVERIFIED for v14 |
| `features` sync: `domAnimation` | Size not stated | UNVERIFIED |
| `features` async: `() => import(...)` | Size not stated. Lets site hydrate before features load. | [V] behaviour |
| `domMax` | Not described in the fetched page. Contains layout and drag features. | UNVERIFIED size |
| `strict` prop | Default `false`. `true` throws if `motion` components are used inside `LazyMotion`. Use it in CI or dev to enforce the savings. | [V] |
| Mini `animate` function | Not covered by the fetched pages. | UNVERIFIED |

**Recommended wiring:**

```tsx
// app root
import { LazyMotion, MotionConfig } from "motion/react";
const loadFeatures = () =>
  import("motion/react-m").then((m) => m.domMax); // or domAnimation if no layout/drag

export function MotionRoot({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}
```

Note: the feature export names and whether `LazyMotion` / `m` are exported from `motion/react` directly were not confirmed in v14 docs. UNVERIFIED. Check the exports of the installed package before writing this in code.

Rules:
- Use `<m.div>` everywhere in the app once `LazyMotion` is at the root, with `strict` on in dev.
- Do not import full `motion` components in shared UI primitives.
- Lazy-load the feature bundle that contains gestures and layout only where the sheet, list reorder, or shared element lives, if the initial render does not need them.

### 2.3 Springs

Options and defaults [V] https://motion.dev/docs/react-transitions:

| Option | Default | Notes |
|---|---|---|
| `stiffness` | 1 | "Higher values will create more sudden movement." |
| `damping` | 10 | Opposing force. At 0 the spring oscillates indefinitely. |
| `mass` | 1 | Higher values feel more lethargic. |
| `bounce` | 0.25 | Range -1 to 1. 0 is critically damped; 1 is extremely bouncy. Overridden if stiffness, damping or mass are set. |
| `duration` | 0.3 (0.8 with multiple keyframes) | Used for springs with `bounce`. |
| `visualDuration` | none | Overrides `duration`. Time in seconds to visually reach target. Accounts for the velocity of an interrupted animation or gesture. Best option for gesture hand-off. |

Guidance:
- Author with `bounce` + `visualDuration` (or `duration`) so values stay readable.
- Use stiffness/damping/mass when you port a spec from a physical model or from a Figma spring plugin.
- Interrupted gestures: `visualDuration` is the right knob, because it includes incoming velocity.

### 2.4 Hardware acceleration: WAAPI vs main thread

What is verified:
- Motion's docs describe transform and opacity animations running through WAAPI, which can stay off the main thread. [V in search summary of motion.dev performance pages; the pages themselves were not fetched in full. UNVERIFIED in detail.] Source: https://motion.dev/docs/performance (not fully fetched)
- Motion's own tier list (2025) says Safari is the biggest offender for hardware acceleration. Example: a `playbackRate` other than 1 disables acceleration. [V from search summary; UNVERIFIED on current Safari.] https://motion.dev/blog/web-animation-performance-tier-list-2025
- Motion animates CSS variables under the hood for some values. Those are not accelerated, even when applied to transform. [UNVERIFIED, search summary only]
- Percentage-based transforms such as `translateX(100%)` were historically not accelerated in Chrome. Status in Safari: UNVERIFIED.
- Anime.js docs state that Safari (desktop and mobile) does not hardware-accelerate a custom `linear()` easing. This is another library's claim, not Motion's. UNVERIFIED for current Safari and for Motion's spring-to-linear output. https://animejs.com/documentation/web-animation-api/hardware-accelerated-animations

Practical rules (UNVERIFIED as a Motion-specific Safari guarantee; treat as the conservative default):
- Accelerated candidates: `transform` (`translate`, `scale`, `rotate` with px and unitless values), `opacity`.
- Main-thread: `width`, `height`, `top`, `left`, `margin`, `padding`, `border*`, `box-shadow`, `filter`, `backdrop-filter`, colour animations.
- Layout animations use transform under the hood (see 2.5), so they keep the cheap path, but they add layout reads.

### 2.5 Layout animations, layoutId, LayoutGroup

[V] https://motion.dev/docs/react-layout-animations

- `layout` animates size and position using CSS transform. Make the layout change via `style` or `className`, not via `animate`/`whileHover`.
- `transition.layout` sets timing for layout alone. `transition.layout.path: arc()` curves the path.
- `layoutId` shares an element across a re-mount: the new element animates from the old position. If both are mounted, they crossfade. Wrap in `AnimatePresence` so the outgoing element stays mounted long enough to animate back.
- `LayoutGroup` is needed when components do not re-render together but affect each other's layout.
- Cost cautions from docs:
  - Scale distortion on children. Add `layout` to children to counter-scale; use `layout="position"` for aspect-ratio changes (images).
  - Border radius and box shadow are corrected only when set via `style`, `animate`, or another animation prop.
  - Animating `border` triggers layout recalculation and removes the transform benefit.
  - `display: inline` elements do not animate. Layout animations are blocked during horizontal window resize. SVG components are not supported.
- Cost: each `layout` element is measured on every React render that touches its layout. Keep `layout` on a small number of elements per screen. Do not put `layout` on the whole list; use it on the rows whose position actually changes.

AnimatePresence `mode` and `popLayout`: the fetched layout page did not document these props. **UNVERIFIED** for v14. Check the AnimatePresence reference. Known from v10 notes: `exitBeforeEnter` replaced by `mode="wait"`.

### 2.6 Gestures, hooks, reduced motion

- `useSpring`: [V] creates a motion value that springs to its latest target. Accepts numbers or unit strings. `.set()` target; `.jump()` for immediate update. `skipInitialAnimation` (default false) useful with `useScroll` measurements. https://motion.dev/docs/react-use-spring
- `useMotionValue`, `useTransform`, `useScroll`, `useReducedMotion`: not fetched in full. UNVERIFIED details.
- `MotionConfig.reducedMotion`: [V] https://motion.dev/docs/react-motion-config
  - `"user"` follows the device setting. `"always"` forces it (debug). `"never"` ignores it (default).
  - When reduced motion is active, transform and layout animations are disabled; opacity and colour still play.
  - Recommendation: `reducedMotion="user"` at the root.
- Drag with constraints, elastic and momentum, `whileTap`: API details not fetched. UNVERIFIED. Note from v9: tap is keyboard accessible via `tabindex="0"`.

### 2.7 AnimateNumber

- Motion's own `AnimateNumber` is a Motion+ member feature. Motion+ is a paid membership; its pricing page lists a $299 team price. [V from search summary, UNVERIFIED pricing today] https://motion.dev/number-animation
- Free option: **Animated Number from Motion Primitives** (MIT, installed via shadcn CLI). It uses React state and effects and depends on framer-motion's `useInView` in its basic example; check current import path. [V from search summary, licence UNVERIFIED on the page itself] https://21st.dev/motion-primitives/animated-number
- Build-your-own is also small: a `useSpring` motion value with `useTransform` into a text node, rendered via `m.span`. Use `tabular-nums` so digits do not jitter.

### 2.8 Reorder and interruption

- Reorder: `layout` on rows plus `layoutId` for moves between containers. Keep the list short or virtualised (Section 8).
- Interruption and velocity: springs started from a live motion value inherit velocity. Use `visualDuration` for gesture releases.

---

## 3. CSS-native alternatives (Safari)

| Feature | Safari support | Status |
|---|---|---|
| `linear()` easing | Safari 17.2 including iOS Safari, released 2023-12-11 [V] https://web-platform-dx.github.io/web-features-explorer/features/linear-easing and https://developer.chrome.com/articles/css-linear-easing-function | Verified via two sources. Use it to bake a spring into a CSS easing. Hardware acceleration in Safari for `linear()`: see the Anime.js caveat in 2.4. UNVERIFIED for Safari today. |
| View Transitions, same-document | Safari 18 [V, Chrome docs citing Safari] | Good enough for route or state crossfades with `view-transition-name`. |
| View Transitions, cross-document | Safari 18.2 [V] (caniuse snippet showed unsupported through 18.1). Requires `@view-transition { navigation: auto; }` on both pages and same-origin. | Usable for multi-page. Cellier is a SPA, so it matters less. |
| Scoped view transitions | Not supported in Safari (Chrome 2025 update). May be dated. | UNVERIFIED |
| `@starting-style` | WebKit bug report Oct 2025 says entry/exit transitions were not respected in Safari 26. A WebKit fix was linked (bug 301461) with a PR on 4 Nov 2025. Whether it shipped in a 26.x release is not confirmed. | UNVERIFIED for Safari 26.x and 27 |
| `transition-behavior: allow-discrete` | Not re-checked in this pass. | UNVERIFIED |
| `interpolate-size` | MDN: experimental, "not Baseline". Safari support not retrieved. | UNVERIFIED |
| Scroll-driven animations | Not re-checked in this pass. | UNVERIFIED |

Safari release notes checked: WebKit features page lists Safari 27.0, 27.1, 27.2 and STP 252-256 [V, webkit.org/blog]. The fetch did not give dates or the animation-specific items. Check the Safari 27 notes for `@starting-style`, `interpolate-size`, and scroll-driven status before shipping.

**When CSS beats a JS library:**
- Simple enter/exit of a single element, hover/focus state changes, theme transitions, route crossfades where View Transitions are supported.
- Anything that needs interruption mid-flight, gesture velocity, drag, or shared element across unmount: keep Motion.
- Fallback: wrap CSS-only paths with `@supports` and keep Motion as the default path where the CSS features are missing or unverified on Safari.

---

## 4. Sheets and drawers

### 4.1 Vaul

- Latest release: **v1.1.2**, tagged "Latest". Release notes: v1.1.2 updated React and react-dom peer deps (PR #504); fixed `onOpenChange` in nested drawers (PR #516). v1.1.1 added React 19 peer dep (PR #498) and fixed initial transform for nested drawers (PR #491). [V] https://github.com/emilkowalski/vaul/releases
- Release dates were not shown in the fetched page. npm page returned HTTP 403. **UNVERIFIED** last publish date and whether the repo is archived.
- iOS handling [V from search summary]:
  - `use-position-fixed` pins body position while a modal drawer is open, to work around iOS Safari viewport and scroll bugs.
  - `repositionInputs` moves inputs rather than scrolling them into view when the keyboard is up.
- Open issues from 2024 (status UNVERIFIED): snap points cycle eventually leaves drawer unresponsive (#364); iOS snap points with non-modal, non-dismissable drawers (#349).
- Props changed in the Base UI migration: `direction` becomes `swipeDirection`; `dismissible={false}` becomes `disablePointerDismissal`. `shouldScaleBackground` has no one-to-one replacement in Base UI. [V] from shadcn docs via search summary.

### 4.2 Base UI drawer

- shadcn's Aria drawer has moved from Vaul to Base UI. Base UI exposes `data-snap-points` and `data-expanded` attributes. [V from search summary] https://ui.shadcn.com/docs/components/aria/drawer
- iOS Safari note: overlay is absolutely positioned; body needs `position: relative` once the page has scrolled. [V from search summary]

### 4.3 Motion-built sheet

- Build with `m.div` + `drag="y"` + `dragConstraints` + `dragElastic` + spring snap to detents, velocity from `onDragEnd`, `visualDuration` for the hand-off.
- Pros: one animation system, no extra dep, full control of detents and velocity. Cons: you own iOS keyboard and scroll-lock behaviour.

### 4.4 Recommendation

- Spike two options on a real iPhone 13 Pro: (a) Base UI drawer, (b) a Motion sheet. Measure keyboard handling with an input in the sheet and scroll lock behind it.
- If Vaul is kept, pin the version and test nested drawers; check its release date and issue tracker first.

---

## 5. Toasts: sonner

- Features shown on the docs page: toast types (default, success, info, warning, error, action, promise, custom), six positions, `richColors`, close button, headless mode, `expand` and `visibleToasts`. [V] https://sonner.emilkowal.ski/
- Version, React 19 peer range, bundle size, and maintenance status: **UNVERIFIED** (page did not show them). Check npm before adding.

---

## 6. iOS Safari performance rules

1. Animate `transform` and `opacity` only in hot paths. Everything else is layout or paint.
2. `will-change`: set it only during an active animation, on a few elements, and remove it after. Permanent `will-change` on many elements costs GPU memory and can create layers that are never freed. (Standard guidance; not re-verified in this pass.)
3. Avoid animating `backdrop-filter` and large `filter: blur()`. Animate the opacity of a pre-blurred layer instead. UNVERIFIED specifics for Safari, but a well-known source of frame drops.
4. Layer explosion: many composited layers (each transformed or animated element, each `will-change`) raise memory and compositing cost. Keep the number of simultaneously animated layers low; group sibling animations under one parent when possible.
5. `layout` / shared layout: cheap per element but measured on each React render. Keep the set small.
6. Avoid animating percentage transforms and CSS variables in hot paths (see 2.4). UNVERIFIED for Safari.
7. Use `content-visibility: auto` on off-screen sections with `contain-intrinsic-size` to skip rendering work.
8. Virtualised lists: TanStack Virtual (not re-verified in this pass) with animation only on the enter/exit of visible rows; avoid `layout` on the full list.

### 6.1 120 Hz

- Safari on ProMotion: page rendering is capped at 60 fps by default; an experimental setting "Prefer Page Rendering Updates near 60fps" (Settings > Safari > Advanced > Experimental Features) controls this. Scrolling is already 120 Hz. [V from search summary, UNVERIFIED on current iOS]
- A WebKit bug report (2024) says that in PWA apps, 120 fps is disabled regardless of the flag on iPad Pro and iPhone Pro. Conflicting iOS 18 beta notes say `requestAnimationFrame` at 120 fps was added in iOS 18 beta 2 and may apply to standalone apps. **UNVERIFIED** for the current iOS 26/27 standalone PWA on iPhone 13 Pro to 15 Pro.
- Non-Pro iPhones are 60 Hz. Design for 60 Hz frame budget (16.6 ms) and test on device; do not depend on 120 Hz.
- Verify on hardware: run a `requestAnimationFrame` timing page in Safari and as a home-screen web app on an iPhone 13 Pro.

---

## 7. Recommended spring presets

These are proposals. The numbers are derived from Motion's documented option semantics (defaults and ranges from Section 2.3). They are not measured against iOS system animations. **UNVERIFIED for iOS feel**: tune on device against a reference (for example, UIKit spring of the same period and bounce).

| Preset | Use | Config (Motion) | Approx. stiffness/damping (mass 1) | Notes |
|---|---|---|---|---|
| `snappy` | Button, chip, toggle, small state changes | `{ type: "spring", duration: 0.3, bounce: 0.15 }` | stiffness 400, damping 30 | Fast settle, minimal overshoot |
| `smooth` | Card reveal, content swap, list item move | `{ type: "spring", duration: 0.45, bounce: 0.05 }` | stiffness 200, damping 28 | Near critically damped |
| `bouncy` | Playful feedback (like, success) | `{ type: "spring", duration: 0.5, bounce: 0.35 }` | stiffness 220, damping 18 | Use sparingly |
| `sheet` | Bottom sheet open/close, drag release | `{ type: "spring", visualDuration: 0.4, bounce: 0.1 }` | derived from visualDuration | Use `visualDuration` so drag velocity hand-off is correct |
| `sheetSnap` | Detent snap after drag | `{ type: "spring", visualDuration: 0.3, bounce: 0.0 }` | derived | No overshoot on snap points |
| `numberTick` | Number changes | `{ type: "spring", duration: 0.35, bounce: 0 }` | derived | Use `tabular-nums` |

```ts
export const spring = {
  snappy:    { type: "spring", duration: 0.3,  bounce: 0.15 },
  smooth:    { type: "spring", duration: 0.45, bounce: 0.05 },
  bouncy:    { type: "spring", duration: 0.5,  bounce: 0.35 },
  sheet:     { type: "spring", visualDuration: 0.4, bounce: 0.1 },
  sheetSnap: { type: "spring", visualDuration: 0.3, bounce: 0 },
  numberTick:{ type: "spring", duration: 0.35, bounce: 0 },
} as const;
```

Reduced motion: when `MotionConfig.reducedMotion` is active, transform and layout animations are disabled (see 2.6). Fallback to opacity transitions with the `smooth` duration.

---

## 8. Recommended toolkit (summary)

| Need | Choice | Confidence |
|---|---|---|
| Component animation, gestures, layout | Motion for React v14, `m` + `LazyMotion` | Medium-high (version verified; sizes UNVERIFIED for v14) |
| Simple state transitions | CSS (`transition`, `linear()`), `@starting-style` only after Safari check | Medium |
| Route/state crossfade | View Transitions (same-document, Safari 18+) | Medium |
| Sheet | Spike Base UI drawer vs Motion sheet; Vaul v1.1.2 as fallback | Low until on-device test |
| Toasts | sonner | Medium (version unverified) |
| Number animation | Motion Primitives Animated Number (free) or own `useSpring` | Medium |

---

## 9. Open items (UNVERIFIED)

- Motion v14 bundle sizes and exports of `LazyMotion`, `m`, `domAnimation`, `domMax` from `motion/react`.
- Mini `animate` function size and API.
- AnimatePresence `mode` and `popLayout` in v14.
- Motion-specific Safari acceleration guarantees for springs compiled to `linear()`.
- Safari 26.x / 27 status of `@starting-style`, `interpolate-size`, `transition-behavior: allow-discrete`, scroll-driven animations.
- Vaul release dates, repo status, and npm publish date (npm returned 403).
- sonner version and bundle size.
- TanStack Virtual details.
- Standalone PWA 120 Hz behaviour on iPhone 13 Pro to 15 Pro under current iOS.

## 10. Sources

- https://motion.dev/docs/react-upgrade-guide
- https://motion.dev/docs/react-lazy-motion
- https://motion.dev/docs/react-transitions
- https://motion.dev/docs/react-layout-animations
- https://motion.dev/docs/react-use-spring
- https://motion.dev/docs/react-motion-config
- https://motion.dev/blog/web-animation-performance-tier-list-2025
- https://motion.dev/number-animation
- https://21st.dev/motion-primitives/animated-number
- https://animejs.com/documentation/web-animation-api/hardware-accelerated-animations
- https://web-platform-dx.github.io/web-features-explorer/features/linear-easing
- https://developer.chrome.com/articles/css-linear-easing-function
- https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
- https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/linear
- https://developer.mozilla.org/en-US/docs/Web/CSS/interpolate-size
- https://webkit.org/blog/
- https://github.com/emilkowalski/vaul/releases
- https://ui.shadcn.com/docs/components/aria/drawer
- https://sonner.emilkowal.ski/
- https://www.npmjs.com/package/vaul (403, not read)
