# 10 - Haptic feedback from a web app on iOS

Research date: 2026-11-10. Target: Cellier PWA (Vite + React + TS) installed to the home screen on iPhone 13 to 15 Pro.

Legend: **VERIFIED** = confirmed in a primary source read during this research. **UNVERIFIED** = single third-party source, contradicted, or not tested on a device.

---

## 1. Summary

- **navigator.vibrate does not work on iOS Safari** (17, 18, 26). No primary WebKit source found that adds it. WebKit's standards position is negative (per third-party reporting, see section 3). **VERIFIED** that the Safari 26.0 and 26.5 release notes contain no Vibration API entry.
- **The only haptic path on iOS is the `<input type="checkbox" switch>` quirk.** Its rendering arrived in Safari 17.4 (March 2024). Haptic feedback on toggle arrived in Safari 18.0 (September 2024). **VERIFIED** from Apple release notes.
- Programmatic `label.click()` on a hidden switch fires the haptic. It is a hack, not an API. **VERIFIED** that the technique works in the libraries' sources; **UNVERIFIED** on the Cellier target devices.
- A WebKit bug (ID 285120, Dec 2024) asked that switch haptics require user activation. It was marked fixed in January 2025. **The exact final behaviour is UNVERIFIED** beyond the bug title and resolution.
- iOS can express only one haptic style via this path. Variants are produced by repeating clicks. Whether two clicks feel different from one is **UNVERIFIED**.
- Reports that the switch haptic broke on iOS 26.5 exist, but they are one forum post and one README claim. The Safari 26.5 release notes list no haptic change. **Treat as UNVERIFIED.**
- No standard haptic API ships in any browser yet. The WICG Web Haptics proposal (`navigator.playHaptics`) is an early draft with no Safari implementation. **VERIFIED** as a proposal.

---

## 2. navigator.vibrate status

| Platform | Status | Source |
|---|---|---|
| iOS Safari 17 / 18 / 26 | Not supported. No WebKit release note adds it. | Safari 17.4, 18.0, 26.0, 26.5 release notes (checked for "vibrate", none found) |
| Chrome / Edge / Samsung on Android | Supported | MDN, W3C spec |
| Firefox Android | Supported | MDN (general knowledge; table not fully extracted) |

Spec and MDN facts (**VERIFIED** from W3C Vibration API and MDN, last modified 2025-11-30):

- Requires sticky user activation. Called without prior interaction it returns `false`.
- A single number or an array of ms values alternating vibrate / pause.
- Each entry is capped at 10,000 ms. Patterns are truncated to 10 entries.
- Returns `false` when the document is not visible, when the UA disables vibration, or when hardware is absent.
- A new call cancels a running pattern. `navigator.vibrate(0)` or `[]` cancels.

Sources:
- https://www.w3.org/TR/vibration/
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
- https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes.md
- https://developer.apple.com/documentation/safari-release-notes/safari-26_5-release-notes.md

---

## 3. The `<input type="checkbox" switch>` technique

### 3.1 Timeline

| Date | Event | Status |
|---|---|---|
| Mar 5, 2024 | Safari 17.4 / iOS 17.4 adds `<input type="checkbox" switch>` and renders it as a native switch. No haptic mentioned in release notes. | VERIFIED: https://developer.apple.com/documentation/safari-release-notes/safari-17_4-release-notes.md (Forms: "Added support for `<input type="checkbox" switch>`.") |
| Dec 2023 | WebKit commit "Add `<input type=checkbox switch>` iOS haptic feedback" (bug 259380) lands in trunk. | VERIFIED title: https://lists.webkit.org/pipermail/webkit-changes/2023-December/294748.html (title only; body not read, 403) |
| Sep 16, 2024 | Safari 18.0 / iOS 18.0 release notes: "Added haptic feedback for `<input type=checkbox switch>` on iOS." (rdar 125474921) and "Fixed the iOS animation for `<input type=checkbox switch>`." | VERIFIED: https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes.md |
| Dec 23, 2024 | WebKit bug 285120 filed. Reporter says haptics could be abused from JS to vibrate, asks for user-activation requirement. | VERIFIED: https://bugs.webkit.org/show_bug.cgi?id=285120 |
| Jan 3, 2025 | Bug 285120 committed as r288403 and closed (fixed). Exact change not read. | VERIFIED closure; **UNVERIFIED** content |
| Mar 2026 | Third-party write-up says the attribute "arrived some time ago" and the author calls the approach a hack. | Blog, not primary: https://kimsal.com/blog/2026/03/20/a-bit-of-feedback/ |
| May 11, 2026 | Safari 26.5 release notes. No haptic, switch or checkbox entry. | VERIFIED: https://developer.apple.com/documentation/safari-release-notes/safari-26_5-release-notes.md |

Conclusion on versions:
- **iOS 17.4 and 17.x**: switch renders, no haptic. **VERIFIED** from the 17.4 notes plus the 18.0 "added haptic" entry.
- **iOS 18.0+**: haptic on toggle. **VERIFIED** from release notes.
- **iOS 18.x (after 18.0)**: no reports found, **UNVERIFIED** on device.
- **iOS 26.0 / 26.5**: no release-note change in either direction. The "broken on 26.5" claim is **UNVERIFIED** (see 3.5).

Note: iOS 26 freezes the UA OS version to `OS 18_6` (Safari 26.0 release notes, fixed item 156170132). **Do not parse the UA to infer 26.x.** VERIFIED.

### 3.2 How it works, exactly

The mechanism, as used by the reference libraries (sources in section 4):

1. Create a `<label>` and an `<input type="checkbox">` with a `switch` attribute. Put the input inside the label.
2. Hide the pair visually, but keep them in the DOM and not `display: none`. (Whether `display:none` breaks the haptic is **UNVERIFIED**; the libraries avoid it.)
3. Call `label.click()`. The label's activation behaviour dispatches a click on the input, which toggles its `checked` state. WebKit plays the switch haptic on that toggle.
4. The checkbox toggles on every click. The state is irrelevant; leave it or reset it.

Minimal, dependency-free example (mirrors what the libraries do; **UNVERIFIED** on Cellier devices):

```ts
const label = document.createElement('label');
const sw = document.createElement('input');
sw.type = 'checkbox';
sw.setAttribute('switch', '');
label.append(sw);
label.setAttribute('aria-hidden', 'true');
label.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
document.body.append(label);

// inside a user-gesture handler:
label.click(); // one haptic tick
```

### 3.3 Needs a user gesture?

- **Libraries do not check for one.** The ios-haptics source inserts DOM and never checks activation (**VERIFIED** from the source, see section 4).
- **WebKit bug 285120** asked for user activation to be required, and was closed as fixed (Jan 2025). **The final rule is UNVERIFIED.** Design as if a user gesture is required: call only from `click`, `pointerup`, `touchend` or `change` handlers.
- Calls made from `setTimeout`, `requestAnimationFrame` or on page load should be assumed silent. **UNVERIFIED.**

### 3.4 Standalone home-screen PWA

- Apple's Safari 26.0 notes say any website can become a web app on iOS (**VERIFIED**, item 113034903).
- Whether the switch haptic fires in a home-screen web app is **UNVERIFIED**. The Ionic requester says it should work in "web and PWA apps running in Safari" (**VERIFIED** as a request, not a test).
- **Action**: test on a real iPhone running the installed PWA before relying on it.

### 3.5 Still works on iOS 18.x and 26?

| Version | Status | Confidence |
|---|---|---|
| iOS 18.0 | Works per Apple notes | VERIFIED (release notes) |
| iOS 18.x later | No change reported | UNVERIFIED |
| iOS 26.0 | No change in notes | VERIFIED absence, behaviour UNVERIFIED |
| iOS 26.1 to 26.4 | Not checked | UNVERIFIED |
| iOS 26.5 | ios-haptics README says it stopped ("this only works on ios 17.4 to 26.4, as apple patched it in ios 26.5"). A Flarum forum post says Flarum 2.0 haptics stopped on iOS 26.5 and blames Apple restricting the system haptic path. The 26.5 release notes list nothing. | UNVERIFIED (two unrelated claims, no Apple source) |
| iOS 27 beta | Not checked | UNVERIFIED |

Sources:
- https://github.com/tijnjh/ios-haptics (README: "this only works on ios 17.4 to 26.4...")
- https://discuss.flarum.org/d/39406/17
- https://developer.apple.com/documentation/safari-release-notes/safari-26_5-release-notes.md

### 3.6 Limits

- **One haptic style.** The system switch tick. No intensity, no custom pattern. **VERIFIED** (Apple exposes no other haptic in this path; azukiazusa notes it cannot match `UIImpactFeedbackGenerator`).
- **Rate limits**: no documentation found. Rapid repeated clicks may be coalesced by the OS. **UNVERIFIED.**
- **Non-standard**: the `switch` attribute is not in the HTML spec. Open UI explainer: "Safari/WebKit: shipped unflagged since Safari 17.4." Mozilla position #990 under review. Chromium state not stated. **VERIFIED** from https://open-ui.org/components/switch.attribute.explainer/
- **Explainer omits haptics**: the Open UI explainer does not mention haptics or user activation (**VERIFIED**). The haptic behaviour is WebKit-specific, not designed in the proposal.
- **Silent mode**: unknown whether the switch haptic is suppressed by the ringer switch or the iOS System Haptics toggle (Settings > Sounds & Haptics). **UNVERIFIED.** Plausibly yes, since both are system-level; test.
- **Accessibility**: see section 6.

### 3.7 Cannot detect support reliably

- No feature test exists for haptic-on-switch. `'switch' in HTMLInputElement.prototype` is not a valid test (the attribute is an attribute, not a property).
- Best practical approach: UA check for iOS (`/iPad|iPhone|iPod/`, plus iPadOS desktop UA check), then assume the haptic works on iOS 18+. Accept silent failure on older iOS.

---

## 4. Libraries

### 4.1 ios-haptics (tijnjh)

- Repo: https://github.com/tijnjh/ios-haptics
- npm: https://www.npmjs.com/package/ios-haptics
- Versions seen: 0.0.8 (npm listing per search), 3.1.1 (unpkg README). The versions disagree, so **the current version is UNVERIFIED**; check `npm view ios-haptics version`.
- Licence: MIT per npm listing (**UNVERIFIED** from search summary).
- API (from README, **VERIFIED** read in one version):
  ```ts
  import { hapticTrigger } from 'ios-haptics'
  hapticTrigger(element) // attaches a label overlay that re-dispatches taps as haptics
  ```
  Framework usage: Svelte `{@attach hapticTrigger}`, React `ref={hapticTrigger}`, Vue `:ref="hapticTrigger"`.
- The 3.1.1 README does not expose `tap()`, `success()` or `error()`. Other sources (npm listing) mention `haptic()`, `haptic.confirm()`, `haptic.error()` (single, double, triple taps). **These are from an older version and UNVERIFIED.**
- Source excerpt (**VERIFIED**, from `src/index.ts` via GitHub):
  ```ts
  export function hapticTrigger(element: HTMLElement | undefined | null) {
    if (!element || typeof window === 'undefined') return
    if (!isIos()) return
    if (element.querySelector(':scope > [data-haptic-trigger]')) return
    const labelEl = document.createElement('label')
    labelEl.setAttribute('data-haptic-trigger', '')
    labelEl.setAttribute('aria-hidden', 'true')
    // ...styles: position absolute, inset 0, touch-action manipulation...
    const switchEl = document.createElement('input')
    switchEl.type = 'checkbox'
    switchEl.setAttribute('switch', '')
    // ...1px, visibility hidden...
    // "The switch must never sit under the finger: WebKit marks a touchstart
    //  on it as handled, which cancels scrolling."
    switchEl.addEventListener('click', event => event.stopPropagation())
    labelEl.append(switchEl)
    if (getComputedStyle(element).position === 'static') element.style.position = 'relative'
    element.insertAdjacentElement('beforeend', labelEl)
  }
  ```
  Notes: it attaches to an element and never removes the label; the overlay tap is the trigger, so it is a gesture-based design, not a programmatic one.

Source: https://unpkg.com/ios-haptics@3.1.1/README.md and https://github.com/tijnjh/ios-haptics/blob/main/src/index.ts

### 4.2 web-haptics (Lochie Axon)

- npm: `web-haptics`. Docs: https://www.mintlify.com/lochie/web-haptics/advanced/browser-support
- Behaviour (**VERIFIED** from the azukiazusa write-up, which excerpts its source): uses `navigator.vibrate()` when available. Otherwise creates a hidden `<label>` and `<input type="checkbox" switch>` lazily in `document.body`, calls `label.click()`, repeats clicks for patterns.
- Default input `[{ duration: 25, intensity: 0.7 }]`. Pattern support is approximated with repeated clicks (**UNVERIFIED** how well).
- API (**UNVERIFIED** against its README): `new WebHaptics().trigger(input?, options?)`.
- The Japanese author notes WebKit opposes the Vibration API and calls the switch approach a hack.

Source: https://azukiazusa.dev/blog/ios-safari-web-haptics.md (fetched; the 403 on other sources was on WebKit mailing list only)

### 4.3 Other

- `use-haptic` (React hook): **UNVERIFIED**. Not fetched. Search turned up `react-haptic` and `browser-haptic` which use the same trick.
- Web Haptics polyfill: https://doublej.github.io/web-haptics-polyfill/ (UNVERIFIED; not read)

---

## 5. Newer official APIs

| Item | Status | Source |
|---|---|---|
| Safari 18.0 haptic on switch | Shipped (not a general API) | VERIFIED: Safari 18 release notes |
| Safari 26.0 / 26.5 haptic API | None listed | VERIFIED: release notes |
| WICG Web Haptics (`navigator.playHaptics(effect, intensity)`, effects `hint`, `edge`, `tick`, `align`, `success`, `error`; CSS `haptic:` property) | Early ideation per authors; "Active" status on the repo; no Safari position stated. TPAC 2026 reportedly resolved to create a CSS editor's draft. | VERIFIED read of https://github.com/WICG/web-haptics (summary); TPAC claim **UNVERIFIED** |
| W3C Vibration API | Still the spec; Chromium/Gecko-style only | VERIFIED: https://www.w3.org/TR/vibration/ |
| Audio Session API (`navigator.audioSession.type`) | Safari-only implementation; spec in editor's draft | UNVERIFIED (search summary) |

No native "haptic" HTML element, CSS hook or Safari API was found for Safari 18.4, 26.0 or 26.x. **Checked Safari 26.0 and 26.5 release notes in full; Safari 18.4 and 26.1 to 26.4 not checked.**

Sources:
- https://github.com/WICG/web-haptics
- https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes.md
- https://developer.apple.com/documentation/safari-release-notes/safari-26_5-release-notes.md

---

## 6. Accessibility and system settings

- **Hidden switch**: the libraries set `aria-hidden="true"` on the label. VoiceOver can still announce toggled state if focus lands on the input, so keep it out of tab order (`tabIndex = -1`) and never make it the only feedback. **UNVERIFIED on VoiceOver.**
- **Reduced motion**: `prefers-reduced-motion` is about motion, not haptics. No standard media query for haptics exists. **VERIFIED** absence in the spec sources read.
- **System haptics setting**: iOS "System Haptics" in Settings > Sounds & Haptics. Whether the switch haptic respects it is **UNVERIFIED**. Expose an in-app toggle (`setHapticsEnabled`) as well.
- **Vibration API user settings**: the W3C spec lets the UA disable vibration per origin, and recommends a way to disable it. Android Chrome honours system settings. **VERIFIED** spec language.
- **Visibility**: `vibrate()` returns false when the page is hidden. **VERIFIED.**

---

## 7. Android fallback

- `navigator.vibrate` with user activation, from event handlers only. **VERIFIED** spec.
- Recommended patterns (design choices, not from a source; keep short, Android only):

| Kind | Android pattern (ms) | iOS equivalent (switch ticks) |
|---|---|---|
| tap | `[10]` | 1 tick |
| selection | `[6]` | 1 tick |
| success | `[12, 60, 12]` | 2 ticks, 70 ms apart |
| warning | `[25, 80, 25]` | 2 ticks, 140 ms apart |
| error | `[40, 60, 40, 60, 40]` | 3 ticks, 60 ms apart |

The iOS column is a guess at a mapping. Whether 2 or 3 ticks are distinguishable from 1 on a phone is **UNVERIFIED**; test on iPhone 13 to 15 Pro.

---

## 8. Audio as a complementary cue

- **Mute switch**: Web Audio on iOS is treated as "ambient" by default and obeys the hardware ringer / mute switch (per WebKit bug-tracker comments, bugs 237322 and related; **UNVERIFIED** against Apple docs). Sources:
  - https://lists.webkit.org/pipermail/webkit-unassigned/2024-September/1186593.html
  - https://bugs.webkit.org/show_bug.cgi?id=264473
- **Fix**: `navigator.audioSession.type = 'playback'` (Safari 17+ per a WebKit bug thread; **UNVERIFIED**). `playback` plays through the mute switch, which is wrong for a UI tick. Do not use `playback` for ticks. Use `ambient` (default) and accept that the mute switch silences it. This is the honest default.
- **When to avoid audio**: never by default. Avoid when the app is used in a shop or with a headset that is not expected; avoid for repeated quantity-stepper ticks (annoying); avoid any sound in a silent-first context. Audio tick is useful only as a backup cue on iOS where haptics may fail (for example, scan success).
- **Cost**: Web Audio needs a user gesture to unlock `AudioContext` (**UNVERIFIED** on iOS 26).

---

## 9. Dependency-free `haptics` module

Design: `tap()`, `selection()`, `success()`, `warning()`, `error()`. iOS uses the switch quirk. Elsewhere uses `navigator.vibrate`. Respects an in-app enabled flag. Throttled. SSR-safe. Not device-verified.

Save as a source file in the app when adopting. This doc does not modify the project.

```ts
// haptics.ts - dependency-free haptic feedback for Cellier.
// iOS: hidden <input type="checkbox" switch> toggled via label.click().
// Elsewhere: navigator.vibrate. Call only from user-gesture handlers.

export type HapticKind = 'tap' | 'selection' | 'success' | 'warning' | 'error';

const ANDROID_PATTERNS: Record<HapticKind, number[]> = {
  tap: [10],
  selection: [6],
  success: [12, 60, 12],
  warning: [25, 80, 25],
  error: [40, 60, 40, 60, 40],
};

// iOS has one system tick. Kinds differ only by tick count and spacing.
// Distinguishability on device is UNVERIFIED.
const IOS_PATTERNS: Record<HapticKind, { clicks: number; gapMs: number }> = {
  tap: { clicks: 1, gapMs: 0 },
  selection: { clicks: 1, gapMs: 0 },
  success: { clicks: 2, gapMs: 70 },
  warning: { clicks: 2, gapMs: 140 },
  error: { clicks: 3, gapMs: 60 },
};

const MIN_INTERVAL_MS = 30;

let enabled = true;
let lastFired = 0;
let iosLabel: HTMLLabelElement | null = null;

function canUseDOM(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function isIOS(): boolean {
  if (!canUseDOM()) return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as Mac with touch points.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** Which mechanism this device will use. */
export function hapticsSupport(): 'ios-switch' | 'vibrate' | 'none' {
  if (!canUseDOM()) return 'none';
  if (isIOS()) return 'ios-switch';
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') return 'vibrate';
  return 'none';
}

/** App-level on/off (wire to a settings toggle). */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

function ensureIOSLabel(): HTMLLabelElement {
  if (iosLabel && iosLabel.isConnected) return iosLabel;
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText =
    'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('switch', '');
  sw.tabIndex = -1;
  sw.setAttribute('aria-hidden', 'true');
  sw.style.cssText = 'position:absolute;width:1px;height:1px;margin:0;opacity:0;';
  // Keep the synthetic click from reaching app-level click handlers.
  label.addEventListener('click', e => e.stopPropagation());
  sw.addEventListener('click', e => e.stopPropagation());
  label.append(sw);
  document.body.append(label);
  iosLabel = label;
  return label;
}

function iosTick(kind: HapticKind): void {
  const { clicks, gapMs } = IOS_PATTERNS[kind];
  const label = ensureIOSLabel();
  label.click(); // first tick synchronously, inside the user gesture
  for (let i = 1; i < clicks; i++) {
    setTimeout(() => label.click(), gapMs * i);
  }
}

function fire(kind: HapticKind): void {
  if (!enabled || !canUseDOM()) return;
  const now = Date.now();
  if (now - lastFired < MIN_INTERVAL_MS) return;
  lastFired = now;

  if (isIOS()) {
    iosTick(kind);
    return;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(ANDROID_PATTERNS[kind]);
  }
}

export const tap = (): void => fire('tap');
export const selection = (): void => fire('selection');
export const success = (): void => fire('success');
export const warning = (): void => fire('warning');
export const error = (): void => fire('error');
```

Caveats for this module:
- `setTimeout` clicks after the first are **outside** the gesture. If WebKit requires activation (bug 285120), the second and third ticks may be silent. **UNVERIFIED.** If so, collapse to one tick on iOS.
- `MIN_INTERVAL_MS` may drop the second tick if called within 30 ms. It does not affect `iosTick` internals.
- The `aria-hidden` label is not focusable; keep it that way.

---

## 10. Recommendations for Cellier

1. Use `tap` for button presses, `selection` for stepper ticks, `success` for scan success, `warning` for soft validation, `error` for destructive confirmations and failures.
2. Expect **one haptic style on iOS**. Do not design a long pattern vocabulary for iOS.
3. Call only from user-gesture handlers. Never from effects, timers or on load.
4. Pair every haptic with a visible state change. Do not rely on haptics alone.
5. Before shipping, test on an iPhone 13 to 15 Pro in the installed home-screen PWA: iOS 18.x and the current iOS 26.x; with System Haptics on and off; with the ringer switch on and off; with VoiceOver on.
6. Check whether the switch haptic stops on iOS 26.5+ on your actual devices. This is the biggest open risk.

---

## 11. Sources

Primary (Apple / WebKit / W3C / MDN / WICG / Open UI):
- https://developer.apple.com/documentation/safari-release-notes/safari-17_4-release-notes.md
- https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes.md
- https://developer.apple.com/documentation/safari-release-notes/safari-26-release-notes.md
- https://developer.apple.com/documentation/safari-release-notes/safari-26_5-release-notes.md
- https://bugs.webkit.org/show_bug.cgi?id=285120
- https://lists.webkit.org/pipermail/webkit-changes/2023-December/294748.html
- https://www.w3.org/TR/vibration/
- https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate
- https://open-ui.org/components/switch.attribute.explainer/
- https://github.com/WICG/web-haptics

Libraries and community (secondary):
- https://github.com/tijnjh/ios-haptics and https://github.com/tijnjh/ios-haptics/blob/main/src/index.ts
- https://unpkg.com/ios-haptics@3.1.1/README.md
- https://www.npmjs.com/package/ios-haptics
- https://azukiazusa.dev/blog/ios-safari-web-haptics.md
- https://github.com/ionic-team/ionic-framework/issues/29942
- https://kimsal.com/blog/2026/03/20/a-bit-of-feedback/
- https://discuss.flarum.org/d/39406/17 (iOS 26.5 claim; UNVERIFIED)
- https://lists.webkit.org/pipermail/webkit-unassigned/2024-September/1186593.html (audio ambient, UNVERIFIED)

Not checked (gaps): Safari 18.1 to 18.6 notes, Safari 26.1 to 26.4 notes, iOS 27 beta notes, web-haptics README, use-haptic package, WebKit commit body for 288403, Chromium switch status, VoiceOver behaviour.
