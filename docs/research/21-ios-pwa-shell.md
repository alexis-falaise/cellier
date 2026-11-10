# 21. iOS home-screen web app shell (Cellier)

Research date: 2026-11-10. Target: iPhone 13 to 15 Pro, installed PWA (Vite + React + TypeScript on Vercel).

Legend: **[V]** verified against a fetched or searched primary/secondary source in this session. **UNVERIFIED** = from general knowledge or not confirmed in the sources consulted; check before relying on it.

Sources consulted:
- firt.dev iOS PWA compatibility notes: https://firt.dev/notes/pwa-ios/
- Apple, Configuring Web Applications (archived Safari Web Content Guide): https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
- WebKit, WebKit Features in Safari 26.0: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- WebKit, News from WWDC25: https://webkit.org/?p=16993
- MacRumors, Safari changes on iOS 26: https://www.macrumors.com/2025/06/18/safari-changes-on-ios-26/
- iDownloadBlog, iOS 26: Safari opens every bookmark added to the Home Screen as a web app: https://www.idownloadblog.com/?p=1042117
- heise, iOS 26 and iPadOS 26: Changed web app behaviour on the home screen: https://heise.de/-10749652
- vite-plugin-pwa, assets generator CLI: https://vite-pwa-org.netlify.app/assets-generator/cli
- pwa-asset-generator README: https://unpkg.com/pwa-asset-generator@8.0.5/README.md
- Device point sizes: https://useyourloaf.com/blog/iphone-15-screen-sizes/ and https://gist.github.com/ricsantos/e7baee6885626b9cb87c021a5097623f

Not fetched in this session (flagged UNVERIFIED where used): web.dev manifest and viewport docs, MDN `interactive-widget`, WebKit posts on scroll and keyboard, Apple Human Interface Guidelines graphics chapter, Apple's exact startup-image media-query list.

---

## 1. Summary: the settings that matter most

1. **iOS 26+ opens every home-screen site as a web app by default [V].** A manifest or `apple-mobile-web-app-capable` is no longer what decides this. Users can switch "Open as Web App" off in the Add to Home Screen sheet to get a browser bookmark. Cellier must still behave correctly when it opens in a browser tab, so do not rely on standalone-only features without a fallback.
2. **`apple-mobile-web-app-capable` is still required for `apple-touch-startup-image` [V].** firt.dev states that startup images only work when this meta tag is present, even though the manifest has a standalone replacement. Keep it in the head.
3. **Use `display: "standalone"` and `theme_color` in the manifest.** These are the supported standalone and colour controls [V].
4. **`apple-mobile-web-app-status-bar-style` is superseded by `theme-color` [V].** firt.dev marks it not recommended since 15.0. Keep it only to get the translucent full-screen look (`black-translucent`), which is still the only way to get a fullscreen app there [V]. Whether the value still behaves as described on iOS 26 with the Dynamic Island is UNVERIFIED.
5. **Manifest fields iOS ignores [V]:** `background_color`, `orientation`, `shortcuts` (macOS only, 17.4), `dir`, `lang`, `related_applications`, `categories`, `screenshots` (not listed as supported in firt.dev; treat as ignored), maskable and monochrome icons (ignored). `id` is supported since 16.4 [V].
6. **Icons: Apple touch icons and manifest icons both matter.** Provide `apple-touch-icon` link tags for the home-screen icon, since Apple uses those, and keep `icons` in the manifest for other platforms. Apple's rule: the most appropriate size is picked; otherwise the smallest icon larger than needed; otherwise the largest [V].
7. **Install experience: no `beforeinstallprompt` on iOS [V, firt.dev: "Installation prompt or banner: not supported"].** Build a manual Share → Add to Home Screen coach screen.
8. **Links that leave scope open in Safari, not in the app [V for "link capturing: not supported"; firt.dev says only a push message can open an installed PWA].** Plan for in-app navigation to stay inside the app and external links to open in Safari.

---

## 2. Manifest fields iOS honours (2026)

| Field | iOS status | Since | Notes |
|---|---|---|---|
| `name` | Supported [V] | 11.3 (firt.dev lists name/short_name/scope/display/start_url together) | Used as the install name. Prefer `name` over `apple-mobile-web-app-title`. |
| `short_name` | Supported [V] | 11.3 | Used under the icon on the home screen (UNVERIFIED on exact truncation). |
| `display` | `standalone` and `browser` supported [V] | 11.3 | `minimal-ui` falls back to `browser`; `fullscreen` falls back to `standalone` [V]. |
| `display_override` | UNVERIFIED | - | Not listed in firt.dev. Do not rely on it. |
| `start_url` | Supported [V] | 11.3 | Set to `/?source=pwa` if you want to detect home-screen launch. |
| `scope` | Supported [V] | 11.3 | Navigation outside scope leaves the app (see section 12). |
| `id` | Supported [V] | 16.4 | Set a stable id such as `/`. |
| `theme_color` | Supported [V] | 15.0 | Tints the status bar in standalone; see section 9 for light/dark. |
| `background_color` | Not supported [V] | - | Splash background comes from `apple-touch-startup-image` only. |
| `icons` | Supported [V] | 15.4 | PNG supported. SVG supported since 26.0 when declared in the manifest [V]. Maskable and monochrome ignored [V]. |
| `orientation` | Not supported [V] | - | Use CSS and the app's own lock logic. Do not rely on it. |
| `shortcuts` | Not supported on iOS [V] | macOS only, 17.4 | No home-screen quick actions. |
| `screenshots` | UNVERIFIED | - | Not listed as supported by firt.dev. Harmless to include for other platforms. |
| `categories` | UNVERIFIED | - | No iOS effect known. |
| `lang` / `dir` | Not supported [V] | - | Set `<html lang>` instead. |
| `related_applications` / `prefer_related_applications` | Not supported [V] | - | - |

---

## 3. Apple meta and link tags (still needed in 2026)

| Tag | Status [V unless noted] | Use in Cellier |
|---|---|---|
| `<meta name="apple-mobile-web-app-capable" content="yes">` | Since 2.0. Optional for launching as an app since 26.0 (firt.dev). **Still required for `apple-touch-startup-image`** (firt.dev). | Keep. |
| `mobile-web-app-capable` (standard) | UNVERIFIED on iOS. Apple documents only the `apple-` prefix. | Add for Android parity, harmless on iOS. |
| `apple-mobile-web-app-status-bar-style` | Values from Apple's doc: `default`, `black`, `black-translucent`. Effect applies only in standalone. Not recommended since 15.0 (firt.dev), replaced by `theme-color`. | Use `black-translucent` for a full-bleed look. Verify on the Dynamic Island devices (UNVERIFIED). |
| `apple-mobile-web-app-title` | Since 8.0. Not recommended since 11.3, replaced by `name` (firt.dev). Apple doc: default is the `<title>`. | Set anyway for the label, but keep `name` and `<title>` identical. |
| `<link rel="apple-touch-icon" sizes="180x180">` | Since 2.0. Optional since 15.4 but still useful (firt.dev). Apple uses the best-fit size. | Provide 180x180 (iPhone) and 167x167 (iPad) if you add iPad support. |
| `<link rel="apple-touch-startup-image">` | Since 8.0. Still the only way to define splash screens (firt.dev). | Generate one per device (section 5). |

Apple's icon fallback: if no `<link>` matches, Safari searches for `apple-touch-icon...` files in the root. Apple's guideline sizes come from the iOS Human Interface Guidelines and are UNVERIFIED for 2026 (not fetched).

---

## 4. Splash screens

### 4.1 Device table (CSS points at 3x)

Physical pixels are the CSS points multiplied by the device pixel ratio (3 for all devices in this table). Point sizes are from the device spec sources listed above.

| Device | CSS points (portrait) | DPR | Startup image pixels (portrait) |
|---|---|---|---|
| iPhone 13 mini | 375 x 812 | 3 | 1125 x 2436 |
| iPhone 13 | 390 x 844 | 3 | 1170 x 2532 |
| iPhone 13 Pro | 390 x 844 | 3 | 1170 x 2532 |
| iPhone 13 Pro Max | 428 x 926 | 3 | 1284 x 2778 |
| iPhone 14 | 390 x 844 | 3 | 1170 x 2532 |
| iPhone 14 Plus | 428 x 926 | 3 | 1284 x 2778 |
| iPhone 14 Pro | 393 x 852 | 3 | 1179 x 2556 |
| iPhone 14 Pro Max | 430 x 932 | 3 | 1290 x 2796 |
| iPhone 15 | 393 x 852 | 3 | 1179 x 2556 |
| iPhone 15 Plus | 430 x 932 | 3 | 1290 x 2796 |
| iPhone 15 Pro | 393 x 852 | 3 | 1179 x 2556 |
| iPhone 15 Pro Max | 430 x 932 | 3 | 1290 x 2796 |

Notes:
- The 14 Pro is 393 x 852, not 430 x 932 (corrected in the search result) [V].
- Use the full screen size (932), not the Safari viewport height (739 for 15 Pro Max), for startup images [V, from the Rocket Validator comparison].
- The 13 mini has the same CSS width as the 12 mini; there is no separate entry needed.

### 4.2 Media queries (UNVERIFIED)

The exact media query list was not found in the sources. The pattern below is the common one used by generators. Verify on a device before shipping.

```
(device-width: W px) and (device-height: H px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)
```

For dark variants add `and (prefers-color-scheme: dark)`. pwa-asset-generator supports `--dark-mode` (see 4.3). Whether iOS picks the dark image from the `media` attribute in standalone mode is UNVERIFIED.

Example for iPhone 15 Pro, light:

```html
<link rel="apple-touch-startup-image"
  href="/splash/iphone-15-pro-light.png"
  media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: light)">
```

Use `and (prefers-color-scheme: dark)` for the dark version.

### 4.3 Generators

- **pwa-asset-generator** (elegantapp, v8.x per README): supports `--splash-only`, `--portrait-only`, `--dark-mode`, and emits the link tags [V]. Source: https://unpkg.com/pwa-asset-generator@8.0.5/README.md
- **@vite-pwa/assets-generator**: CLI configured by `pwa-assets.config.*` with a `preset` and `source`. iOS splash screens are generated only when defined in the preset (`appleSplashScreens`). Verify the current built-in preset list (UNVERIFIED for 2026). Source: https://vite-pwa-org.netlify.app/assets-generator/cli

Generate the head tags, then paste them into `index.html`, or let the plugin inject them.

---

## 5. Viewport, safe area, and keyboard

All of this section is UNVERIFIED (not fetched). Standard guidance from memory; confirm on device.

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">` is the recommended combination.
  - `viewport-fit=cover` lets content reach the notch and the home-indicator edges, then use `env(safe-area-inset-*)` to pad.
  - `interactive-widget=resizes-content` makes the layout viewport shrink when the keyboard opens. Safari support is UNVERIFIED for this value. Do not rely on it alone.
- Prevent zoom on input focus by setting input font-size to at least 16px. Do not add `maximum-scale=1` or `user-scalable=no` (these hurt accessibility and are ignored by iOS 10+ for user zoom).
- `env(safe-area-inset-top|right|bottom|left)` for the Dynamic Island and home indicator. Use `padding-bottom: env(safe-area-inset-bottom)` on bottom bars.
- `100dvh` tracks the dynamic viewport (toolbar visible or not). `100svh` is the smallest, always fits. In standalone the browser chrome is hidden, so `100dvh` is typically the full screen height. Use `dvh` with a `svh` fallback.
- For a bottom bar above the keyboard, use the VisualViewport API: listen on `window.visualViewport` `resize` and `scroll`, and set the bar's `bottom` to `innerHeight - (vv.height + vv.offsetTop)`. Keep this in a small hook.

---

## 6. Scroll, gestures, and touch

All UNVERIFIED (not fetched). Use as a checklist:

- `overscroll-behavior: none` on the root for the rubber-banding of the page; keep it on scroll containers that should not chain.
- Momentum: `-webkit-overflow-scrolling: touch` is no longer needed on modern iOS (UNVERIFIED).
- Body scroll lock behind sheets: set `position: fixed` on body with the saved scroll offset, or use `overflow: hidden` on `html` plus `touch-action: none` on the sheet overlay. Test on device.
- Scroll to top on status-bar tap: iOS scrolls the topmost scroll view in the document. Behaviour in standalone is UNVERIFIED; test with a fixed-height app layout.
- `touch-action: manipulation` removes the 300 ms tap delay on modern iOS (it is already gone with `width=device-width`; keep as belt and braces).
- Tap highlight: `-webkit-tap-highlight-color: transparent` on interactive elements, paired with a visible `:active` state.
- `-webkit-touch-callout: none` on buttons and cards to suppress the long-press menu. Keep it off text and form fields.
- `user-select: none` on UI chrome only; keep text selectable where users copy values.
- Edge-swipe back gesture in standalone: iOS still provides a back swipe that pops history. Route with the History API so that back behaves naturally. Test the edge gesture against any modals that push history.
- No pull-to-refresh in standalone: iOS does not provide it, so implement a visible refresh control if needed.

---

## 7. Theme colour

- `<meta name="theme-color" content="#F7F5F0" media="(prefers-color-scheme: light)">` and a dark variant with the matching media query. Both can be set. This colours the status-bar area in standalone [V for `theme_color` manifest support; the meta-tag form is from general knowledge, UNVERIFIED].
- The manifest `theme_color` is a single value. Set it to the light colour.

---

## 8. Detecting standalone and iOS

```ts
export const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
```

- firt.dev: `navigator.standalone` is no longer recommended since 11.3; use the `display-mode` query [V]. Keep the fallback for older iOS.
- Under iOS 26 a home-screen site can open in a browser tab, so `isStandalone` can be false even when launched from the home screen. Do not gate features on it alone (UNVERIFIED consequence; reason is the 26.0 change).

---

## 9. Install experience

### 9.1 Facts

- `beforeinstallprompt` is not supported on iOS. firt.dev: "Installation prompt or banner: not supported" [V].
- Installing from Safari works since iOS 11.3 [V]. Since iOS 26.0 every website can be installed as a web app [V].
- Install from non-Safari browsers: iOS 16.4, only if the browser opts in [V]. Chrome and Edge on iOS use WebKit, and the Share sheet step must be done in Safari for Cellier unless the browser provides its own Add to Home Screen flow (UNVERIFIED for 2026).
- Login cookies copied to the installed app: iOS 17.2 [V]. Storage is not shared with the browser [V]. Users who log in in Safari may need to log in again in the home-screen app.
- Web Push works only for installed PWAs since 16.4 [V].

### 9.2 Share → Add to Home Screen steps

The step wording and icons differ by version. The step names below are from general knowledge (UNVERIFIED for iOS 17, 18 and 26 wording).

- iOS 17 and 18: Tap the Share icon (square with arrow), scroll, tap "Add to Home Screen", confirm with "Add".
- iOS 26: The Add to Home Screen sheet has an "Open as Web App" toggle, on by default [V]. Users turn it off for a browser bookmark. The exact sheet layout and icon changes are UNVERIFIED.

Design the coach screen to say: "Tap Share, then Add to Home Screen. Keep 'Open as Web App' on." Show the icon-only Share glyph and let the layout adapt.

### 9.3 Coach screen pattern

- Show after the user has completed one meaningful action, not on first load.
- Detect iOS, Safari, and not standalone. Do not show in standalone.
- Dismiss for 30 days and store the dismissal in `localStorage` (per-viewer convenience only).
- Three steps, one illustration, one button "Got it".

---

## 10. App updates (service worker)

- In a long-lived standalone app, the service worker can keep an old shell. Check for updates on `visibilitychange` (returns to foreground) and on a timer.
- `vite-plugin-pwa` `registerType`:
  - `autoUpdate`: the new SW activates and reloads the page. Silent. Good for shells with no unsaved state.
  - `prompt`: show an update banner; the user taps Reload. Use this when the app holds unsaved inventory edits. Recommended for Cellier because inventory forms can be in progress.
  - Verify exact option names against the plugin docs (UNVERIFIED, not fetched in this session).

---

## 11. Links that leave scope

- Links outside `scope` open in Safari, not inside the app (firt.dev notes link capturing is not supported) [V].
- For external links in Cellier, use `target="_blank" rel="noopener noreferrer"` and accept that they open in Safari (UNVERIFIED whether an SFSafariViewController-style in-app view appears for these links in standalone).

---

## 12. Deep links and notifications

- Only a push message can open an installed PWA from outside [V, firt.dev: "Link capturing: not supported. Only a push message can open an installed PWA"].
- Push `notificationclick` handler: call `clients.openWindow(url)` or focus an existing client. Use the same origin (UNVERIFIED on exact iOS behaviour in standalone).
- Web Push requires 16.4+ and an installed PWA [V].

---

## 13. Multiple installed instances

- iOS can have more than one home-screen icon for the same origin (for example, one from Safari 26 with "Open as Web App" on and one as a bookmark). `id` in the manifest does not guarantee a singleton [V: firt.dev lists "Singleton installation: not supported"].
- Storage and cookies may diverge between instances (UNVERIFIED for 26.x).

---

## 14. Real-device test checklist

1. Deploy a Vercel preview URL (HTTPS). Confirm `manifest.webmanifest` and icons return 200.
2. On iPhone 13 to 15 Pro, open in Safari, Share, Add to Home Screen with "Open as Web App" on and again with it off.
3. Launch from the icon. Check the status bar, safe-area padding, startup image (light and dark), and the title.
4. Focus an input: check no zoom, the bottom bar stays above the keyboard.
5. Open a sheet: check background scroll does not move.
6. Test edge-swipe back in standalone and in browser-tab mode.
7. Test an external link: it should open in Safari.
8. Background the app for a few minutes, return, and confirm the update prompt works.
9. Test push and `notificationclick` on an installed PWA.

### Web Inspector from a Mac (UNVERIFIED steps, from general knowledge)

- iPhone: Settings → Safari → Advanced → Web Inspector on.
- Mac: Safari → Settings → Advanced → Show features for web developers. Connect the iPhone by cable, then Develop → [device] → select the home-screen page.
- Use the Develop menu's Console and Network tabs. Remote debugging of a standalone app should appear in the device list (UNVERIFIED for iOS 26).

---

## 15. Ready-to-paste `index.html` head

```html
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
  <title>Cellier</title>

  <!-- Manifest and theme -->
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#F7F5F0" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#121210" media="(prefers-color-scheme: dark)" />
  <meta name="mobile-web-app-capable" content="yes" />

  <!-- iOS home-screen app -->
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Cellier" />

  <!-- Icons -->
  <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon-180.png" />
  <link rel="apple-touch-icon" sizes="167x167" href="/icons/apple-touch-icon-167.png" />
  <link rel="icon" href="/icons/icon-32.png" sizes="32x32" type="image/png" />

  <!-- Splash screens (sample: iPhone 15 Pro light and dark; generate the rest) -->
  <link rel="apple-touch-startup-image"
    href="/splash/iphone-15-pro-light.png"
    media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: light)" />
  <link rel="apple-touch-startup-image"
    href="/splash/iphone-15-pro-dark.png"
    media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait) and (prefers-color-scheme: dark)" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

Notes: `black-translucent` requires the content to handle the top safe area (UNVERIFIED on Dynamic Island devices). The `mobile-web-app-capable` tag and the 167x167 icon are optional extras.

---

## 16. Ready-to-paste `manifest.webmanifest`

```json
{
  "id": "/",
  "name": "Cellier",
  "short_name": "Cellier",
  "description": "Inventaire de cellier",
  "lang": "fr",
  "dir": "ltr",
  "start_url": "/?source=pwa",
  "scope": "/",
  "display": "standalone",
  "theme_color": "#F7F5F0",
  "background_color": "#F7F5F0",
  "orientation": "portrait",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Notes: `background_color`, `orientation`, `lang`, `dir` and the maskable icon are ignored by iOS [V] and kept for other platforms. Omit `shortcuts` (no iOS effect). `description` is optional.

---

## 17. Open questions (UNVERIFIED)

- Exact iOS 26 Add to Home Screen sheet wording and icon changes.
- Whether `black-translucent` behaves as expected with the Dynamic Island on iOS 26.
- Exact splash media queries for all twelve devices and whether dark variants are picked in standalone.
- Current built-in iOS preset list of `@vite-pwa/assets-generator`.
- Whether an in-app Safari view appears for out-of-scope links in standalone.
- Scroll-to-top on status-bar tap in standalone.
