# 17 - Google sign-in with Supabase inside an iOS home-screen PWA

Research date: 2026-11-10. Scope: Cellier (Vite + React + TS SPA on Vercel, supabase-js v2, installed to the home screen on iPhone 13 to 15 Pro, Google is the only sign-in method).

Legend: **[V]** verified against a primary source fetched for this note. **[S]** secondary source (forum, press, blog) only. **UNVERIFIED** = inference or memory, not confirmed in any source fetched. Dates are the dates of the cited source.

---

## 0. TL;DR

- **Recommended in 2026:** Google Identity Services (GIS) button rendered in the page, returning an ID token that goes to `supabase.auth.signInWithIdToken({ provider: 'google', token, nonce })`, with a hashed nonce. No redirect leaves the page, so no verifier or cookie has to survive a context switch. **[V]** for the Supabase and GIS nonce mechanics. **UNVERIFIED** that the GIS popup behaves inside a standalone iOS 16.4 to 26 window (see section 3).
- **Fallback:** `signInWithOAuth({ provider: 'google' })` with `flowType: 'pkce'`, a dedicated `/auth/callback` route, and `detectSessionInUrl: false` with an explicit `exchangeCodeForSession`. Known risk: the redirect may leave the standalone window and return to Safari, where the PKCE verifier is missing. **[S]** plus strong inference, **UNVERIFIED** on current iOS.
- **Google's embedded-webview ban** is real and documented **[V]** (`disallowed_useragent`, enforced 2021-09-30). Whether a home-screen web app counts as an embedded webview is **UNVERIFIED**. Community reports from 2017 say yes; nothing from 2024 to 2026 was found to confirm it either way. Test on device.
- **Session:** Supabase refresh tokens do not expire but are single-use with a 10 s reuse window **[V]**. Google's Testing-mode 7-day limit applies to Google's own refresh tokens, not to the Supabase session **(inference, UNVERIFIED)**.
- **Human must configure by hand:** Google Cloud OAuth client and consent screen, Supabase Google provider secret, Supabase Site URL and redirect allow-list. The Management API can set the provider and URL fields (section 7).

---

## 1. The two integration paths

### 1A. `signInWithOAuth({ provider: 'google' })` (redirect, PKCE)

Supabase's Google page: the default call is `supabase.auth.signInWithOAuth({ provider: 'google' })`. For PKCE you pass a `redirectTo` pointing to a callback route, add that URL to the redirect allow-list, and exchange the code in the callback. **[V]** https://supabase.com/docs/guides/auth/social-login/auth-google

Flow: app calls `signInWithOAuth` → navigates to Google → Google redirects to the Supabase callback (`https://<project-ref>.supabase.co/auth/v1/callback`) → Supabase redirects to your `redirectTo` with `?code=...` → your app calls `exchangeCodeForSession(code)`.

PKCE facts **[V]** (https://supabase.com/docs/guides/auth/sessions/pkce-flow):
- The code verifier "is created and stored locally when the Auth flow is first initiated". The exchange therefore has to happen in the same browser and device where the flow began.
- `flowType: 'pkce'` selects PKCE. The default is `implicit` **[V]** (auth-js `DEFAULT_OPTIONS`, https://raw.githubusercontent.com/supabase/auth-js/master/src/GoTrueClient.ts).
- The code "expires after 5 minutes and works only once".
- "As the flow is run server side, `localStorage` may not be available." A custom `storage` adapter (cookies) is supported.
- The verifier is stored under `${storageKey}-code-verifier` **[V]** (same auth-js source).

### 1B. GIS button or One Tap → `signInWithIdToken` with nonce

Supabase Google page **[V]**:
- Call: `supabase.auth.signInWithIdToken({ provider: 'google', token: response.credential })` plus `nonce` when used.
- Nonce is "optional but recommended" for One Tap. Generate it randomly per sign-in, SHA-256 hash and hex-encode it, put the **hashed** value in Google (`data-nonce` or the `nonce` option of `initialize`), and pass the **raw** value to `signInWithIdToken`.
- Nonce validation is on by default. `skip_nonce_check` / "Skip nonce check" exists "only if your client libraries cannot properly handle nonce verification". Do not enable it for a web app.
- Cached Google tokens can carry a stale or missing nonce and produce a "nonce mismatch" **[S]** (third-party plugin docs). Fix: sign out of Google and retry.

### 1C. Which to pick

| | 1A OAuth redirect PKCE | 1B GIS button + `signInWithIdToken` |
|---|---|---|
| Leaves the page | Yes, to Google, then back to Supabase, then back to app | Google popup or FedCM sheet; page context kept |
| Needs verifier/cookie to survive a context hop | Yes | No (nonce lives in page memory or sessionStorage) |
| Google `disallowed_useragent` exposure | Full redirect to accounts.google.com | Popup/FedCM; **UNVERIFIED** |
| Works without third-party cookies | Yes (first-party redirect) | GIS relies on Google's iframe/FedCM; **UNVERIFIED** on iOS standalone |
| Supabase provider config | Same | Same, plus client ID list including web client |

---

## 2. Behaviour inside an iOS home-screen web app

### 2.1 Where the redirect goes (in-window vs Safari)

- **[S]** A home-screen web app keeps cookies and website storage separate from Safari. A login active in Safari may not carry over. https://www.cloudspress.com/?p=373269 (via search summary; the article could not be fetched) and the search result from `9to5mac.com/?p=1012329`.
- **[S]** iOS 26 changed the home-screen behaviour: every site added to the Home Screen opens as a web app by default, with an "Open as Web App" toggle. Before iOS 26 only sites with web-app metadata did. Source: https://heise.de/-10749652 (German, not fetched) and https://forums.macrumors.com/threads/ios-26-add-web-app-or-bookmark-to-iphone-home-screen.2462753 (search result). Practical effect: a non-PWA site added in iOS 26 gets a separate cookie jar it did not have before.
- **[S]** Navigating a standalone web app to a third-party origin (Google) generally leaves the standalone window. Safari opens the page, and the callback returns to Safari, not to the home-screen app. Reported in the context of an oidc-client-js "No matching state found in storage" error: the state was in the PWA's localStorage, the callback landed in Safari. Source: https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/53948916/oidc-and-pwa-add-to-home-screen (2014-era Q&A mirror, not current).
- **UNVERIFIED for iOS 16.4, 17, 18, 26:** whether `signInWithOAuth` in a standalone window ever stays in the window (for example via an in-app SFSafariViewController sheet). No Apple or WebKit primary source found. Test on each target device.

### 2.2 Does the session come back to the PWA?

- If the callback lands in Safari, Safari gets the session (in Safari storage). The PWA does not. The user sees a signed-out PWA. **Inference from 2.1, UNVERIFIED end to end.**
- Cookie-based sessions: **[S]** a WebKit bug (`REGRESSION (iOS 17.x): Session cookies being reset randomly in a Home Screen web app`, bugs.webkit.org/show_bug.cgi?id=272325, status NEW/unassigned at the time fetched) reports that persistent cookies in Home Screen web apps reset to defaults after close and reopen on iOS 17.2 to 17.4.1, with a later comment mentioning iOS 18.1. The bug is still open per the fetched page; date of fetch not the date of the bug.
- **[S]** Progressier help article: from iOS 16.7, adding a PWA after login transfers the domain's existing cookies. Unverified. https://intercom.help/progressier/en/articles/9519381-google-oauth2-is-not-working-in-my-pwa-on-ios-why

### 2.3 Google `disallowed_useragent`

- **[V]** Google's policy (https://developers.googleblog.com/en/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/): OAuth requests inside embedded webview libraries are prohibited. Warnings from 2021-08-30, blocking from 2021-09-30. Non-compliant requests get a `disallowed_useragent` error at the Authorization Endpoint. Test flag: `disallow_webview=true`.
- **[V]** Google recommends the system browser or Custom Tabs / SFSafariViewController for native apps.
- **[S]** A 2017 Auth0 thread (https://community.auth0.com/t/getting-google-disallowed-useragent-with-web-app-added-to-ios-homescreen/6705) reports Google login failing once a web app is added to the iOS home screen. Its suggested workaround (turn off `apple-mobile-web-app-capable`) was not confirmed by anyone. Date: 2017-05-22.
- **[S]** A search summary cites a Firebase maintainer saying there is no working Google sign-in in an iOS home-screen app. https://github.com/firebase/firebase-js-sdk/issues/77 (not fetched, date unknown).
- **UNVERIFIED for 2026:** whether iOS 16.4 to 26 standalone WKWebView UA triggers the block. Treat it as a live risk and test. The GIS button path is less exposed than a top-level redirect, but this is not confirmed.

### 2.4 FedCM and third-party-cookie restrictions (One Tap in Safari)

- **[V]** Google's FedCM migration page (https://developers.google.com/identity/gsi/web/guides/fedcm-migration) says FedCM "is available in Chrome 117 or later" and recommends automatic sign-in developers migrate "as soon as possible". It documents `use_fedcm_for_button` for the Button flow. It does **not** name a mandatory date or Safari behaviour in the fetched text.
- **[S]** Corbado blog (Dec 2025, not fetched by me) says FedCM became mandatory for One Tap and Sign-In button in August 2025 and that Safari has no FedCM implementation planned. **UNVERIFIED** against Google's pages.
- **[S]** Google's GIS release notes list One Tap on ITP browsers as a supported feature (search summary, https://developers.google.com/identity/gsi/web/reference/release-notes, not fetched).
- Practical reading (**UNVERIFIED**): on Safari/iOS, One Tap runs on the non-FedCM path. Expect the cooldown and suppression behaviour and cross-site storage limits. Build the app so the Google button is the primary entry point and One Tap is optional.

---

## 3. Recommended flow in 2026 and fallback

### 3.1 Primary: GIS button + `signInWithIdToken` (nonce)

Why: no page-to-Google-to-page redirect round trip inside the standalone window. Nonce state stays in memory or sessionStorage of the PWA. Google's sign-in is a popup or FedCM sheet, which the PWA can receive without a cross-context hop.

Caveats (all UNVERIFIED on iOS standalone): popup may open a Safari sheet; the popup result postMessage must reach the standalone context; if it does not, fall back to 3.2.

### 3.2 Fallback: `signInWithOAuth` PKCE to `/auth/callback`

Use it if the GIS popup fails on the target devices. Known risk: verifier is in the PWA's storage, callback may open in Safari. Mitigation options (UNVERIFIED, test each):
1. Store the verifier in a cookie via a custom `storage` adapter (Supabase doc permits this).
2. Same-origin callback: `redirectTo` must be the same origin that started the flow, so Safari and the PWA share origin but not storage. This does not solve the storage split.
3. Show an in-app message "finish sign-in in the app" if the callback arrives without a verifier, rather than a silent failure.

### 3.3 Things that do not work

- Google sign-in in a `WKWebView` (native wrapper) is blocked by the same policy; use the system browser or ASWebAuthenticationSession only if you ever wrap the app natively. **[V]** policy, **UNVERIFIED** for ASWebAuthenticationSession on iOS 26.

---

## 4. Manifest and config settings that affect it

- `scope` and `start_url`: set `start_url` to the exact app entry (for example `/`) and `scope` to `/` so any OAuth return inside the app origin stays in scope. Scope mismatch makes iOS treat the return URL as Safari. **UNVERIFIED** on iOS 26.
- `display: "standalone"` is required for the home-screen window. `display_override` is not read by iOS **(memory, UNVERIFIED for current iOS)**.
- Same-origin redirect URL: use the production origin exactly, e.g. `https://cellier.vercel.app/auth/callback`. Do not use the preview `*.vercel.app` URL as the production Site URL.
- `flowType: 'pkce'` for fallback. Default is `implicit` **[V]**.
- `detectSessionInUrl`: default `true` **[V]**. For PKCE with an explicit callback route, set `false` and call `exchangeCodeForSession` yourself, otherwise the code could be exchanged twice (the SDK does it automatically when detection is on, per the PKCE page **[V]**). Double exchange is UNVERIFIED as a failure mode; the single-use code makes it likely.
- `persistSession` and `autoRefreshToken`: default `true` **[V]**. Storage default is `localStorage` when available **[V]**.
- Dedicated callback route: `/auth/callback` with its own handler, not a catch-all, so the code is not lost to a router redirect. **Inference**.

---

## 5. Session persistence, refresh and offline use

### 5.1 Token lifetimes and rotation (Supabase) **[V]**

https://supabase.com/docs/guides/auth/sessions:
- "refresh tokens never expire but can only be used once".
- Each refresh issues a new access + refresh pair.
- Reuse window: "By default this is 10 seconds and we do not recommend changing this value."
- A reuse outside the window and the parent-token exception "the whole session is regarded as terminated and all refresh tokens belonging to it are marked as revoked". Can be disabled in Advanced Settings, "generally not recommended".
- JWT lifetime: default 1 hour; "should use the default", minimum recommended 5 minutes.
- Sessions end on sign-out, password change, inactivity or time-box limits, or sign-in on another device. The page does not give a numeric inactivity limit (UNVERIFIED).

### 5.2 What happens on a failed refresh offline

- The Supabase docs do not describe offline refresh failure **[V, gap]**.
- auth-js behaviour (memory, **UNVERIFIED**): a network error during refresh keeps the stored session and retries; only an invalid or revoked refresh token clears it. Verify in the installed auth-js version (check `node_modules/@supabase/auth-js` source for `_callRefreshToken` and `NetworkError` handling).
- Google Testing-mode 7-day expiry **[V]** (https://developers.google.com/identity/protocols/oauth2#expiration) applies to Google refresh tokens for non-basic scopes. It does not apply to the Supabase session unless you use Google's provider token. Basic scopes (name, email, profile) are exempt. Inference: no effect on Supabase session.
- Google refresh-token cap: 100 per Google Account per OAuth client ID, oldest invalidated; unused refresh tokens expire after 6 months **[V]** (same page).

### 5.3 Keeping a long-offline user signed in and able to use cached data

- Keep the Supabase session in localStorage (default). On boot, read the session locally and render the cached UI before any network call. Only sign out on an explicit auth error from `onAuthStateChange` / `getSession` with an invalid refresh token.
- Cache data in IndexedDB (or an offline store), keyed by user id. Write queued changes locally and replay on reconnect. Do not clear cache on `SIGNED_OUT` from a network failure.
- iOS storage eviction (UNVERIFIED for iOS 26): script-writable storage may be evicted after a period of disuse for sites not added to the Home Screen. Home-screen web apps are generally exempt, which is the reason to keep users on the home-screen app. Confirm with WebKit ITP documentation (not fetched).

### 5.4 Storage choice

| Store | Use for | Note |
|---|---|---|
| localStorage (Supabase default) | Session tokens | Per origin, per browser context. Not shared with Safari. |
| Cookie via custom `storage` adapter | PKCE verifier if using fallback | Needed for server-side style flows. Session cookies in standalone iOS had a reset bug (WebKit 272325). |
| IndexedDB | Offline app data | Larger, survives reloads |
| sessionStorage | GIS nonce only | Dies with the window, fine for a single attempt |

---

## 6. Sign-out and account switching

- Sign out locally: `supabase.auth.signOut({ scope: 'local' })`. Use the global scope only if you want to revoke all sessions.
- Google account switch: for the OAuth redirect, pass `queryParams: { prompt: 'select_account' }`. **UNVERIFIED** that this param is honoured in the OAuth flow when Supabase proxies the request; test.
- For GIS, disable auto-select after sign-out: `google.accounts.id.disableAutoSelect()` before showing the button again. **Memory, UNVERIFIED**, check the GIS reference.
- Google refresh tokens from the provider (only if you requested `access_type: 'offline'`) are not revoked by `signOut`. Revoke them at `https://oauth2.googleapis.com/revoke` if needed. Not needed for Cellier if you do not store Google tokens.

---

## 7. Setup checklist

### 7.1 Google Cloud Console

Source: https://supabase.com/docs/guides/auth/social-login/auth-google **[V]** unless noted.

1. Google Auth Platform → **Branding** and **Audience** (OAuth consent screen).
   - User type: **External**.
   - Publishing status: **Testing** while building. Testing = "only available to users you add to the list of test users" **[V]**.
   - Add your Google account and any other testers under **Test users**.
   - The fetched page did not state the "100 test users" limit. Google's user-cap rule for unverified apps exists **[V]** ("A user cap restricts the number of Google Accounts able to grant access to your unverified app"). The number 100 is **UNVERIFIED**.
   - Before go-live: switch to **In production** (Publish app). If the app shows a logo or display name on the consent screen, verification is required **[V]**. Scopes `openid`, `email`, `profile` are non-sensitive; verification is then not required for basic sign-in **(inference, UNVERIFIED)**.
2. Google Auth Platform → **Clients** → **Create a new OAuth client ID** → **Web application** **[V]**.
3. **Authorised JavaScript origins** (needed for the GIS button) **[V]**:
   - `https://<production-domain>` (Vercel production domain, e.g. `https://cellier.vercel.app` or the custom domain).
   - `http://localhost:<port>` for local dev (e.g. `http://localhost:5173` for Vite).
   - Vercel preview domains cannot be wildcarded in Google. Add the preview origin you actually use, or only test on production and localhost **(inference)**.
4. **Authorised redirect URIs** **[V]** for the redirect path (1A) and the Supabase path:
   - `https://<project-ref>.supabase.co/auth/v1/callback` (copy the exact URL from Supabase Dashboard → Authentication → Sign-in providers → Google; the doc says to copy it from the Dashboard).
   - Local Supabase CLI: `http://127.0.0.1:54321/auth/v1/callback` **[V]**.
   - Your app's `/auth/callback` is **not** added here. Google only redirects to Supabase; Supabase redirects to the app. Your app URLs go in Supabase's allow-list (section 7.2).
5. Copy **Client ID** and **Client Secret**. Create a **separate iOS client ID** only if you later ship a native wrapper (not needed for the PWA).
6. Scopes: add `openid` manually; `userinfo.email` and `userinfo.profile` are added by default **[V]**.
7. Optional, for the redirect flow: `access_type: 'offline'`, `prompt: 'consent'` only if you need a Google refresh token **[V]**. Not needed for sign-in.

### 7.2 Supabase Dashboard

Source: https://supabase.com/docs/guides/auth/social-login/auth-google and https://supabase.com/docs/guides/auth/redirect-urls **[V]** unless noted.

1. Authentication → Sign-in providers → **Google** → Enable.
2. Client IDs: paste the **web** client ID first. If you add the iOS client ID later, comma-separate after the web one **[V]**.
3. Client Secret: paste.
4. **Skip nonce check**: leave **OFF** for web **[V]**. Enable only for a native client that cannot handle nonces.
5. Authentication → URL Configuration:
   - **Site URL**: `https://<production-domain>` (no path). Default redirect when `redirectTo` is omitted **[V]**.
   - **Redirect URLs** (allow-list), one per line **[V]**:
     - `https://<production-domain>/auth/callback` (exact path, recommended for production).
     - `http://localhost:5173/auth/callback` (Vite default; match your port).
     - Preview: `https://*-<team-or-account-slug>.vercel.app/**` (docs example pattern) **[V]**. Replace the slug with your Vercel team/account slug. The docs pattern is `https://*-<slug>.vercel.app/**`, with `**` matching any path.
     - Wildcard syntax: `*` matches non-separator characters, `**` matches any characters (separators `.` and `/`) **[V]**. `http://localhost:3000/*` does not match `/foo/bar`.
   - Fallback when `redirectTo` is not in the list: not documented (UNVERIFIED). Assume it falls back to Site URL and test.
6. Set `NEXT_PUBLIC_SITE_URL`-style env var if you reuse Supabase's sample `getURL()` helper (Next.js example; Vite equivalent is `import.meta.env.VITE_SITE_URL`) **[V]** for the docs example. Cellier is Vite, so use `VITE_SITE_URL`. Name is a convention, not a Supabase requirement.

### 7.3 Local CLI config (`supabase/config.toml`)

```toml
[auth]
site_url = "http://127.0.0.1:5173"
additional_redirect_urls = ["http://127.0.0.1:5173/auth/callback", "http://localhost:5173/auth/callback"]

[auth.external.google]
enabled = true
client_id = "<web-client-id>"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)"
skip_nonce_check = false
```

The `[auth.external.google]` block is **[V]** (Supabase Google page). `site_url` and `additional_redirect_urls` keys in `[auth]` are **UNVERIFIED** against the fetched text, they are from memory; check against the config reference.

### 7.4 Can the Supabase part be done without the dashboard?

- **Management API** **[V]**: `PATCH https://api.supabase.com/v1/projects/{ref}/config/auth` ("Updates a project's auth config"). Google fields: `external_google_enabled`, `external_google_client_id`, `external_google_secret`, `external_google_additional_client_ids`, `external_google_skip_nonce_check`, `external_google_email_optional`. Redirect fields: `site_url` (string), `uri_allow_list` (string, format not in the fetched text, presumably comma-separated; **UNVERIFIED**). Auth: a personal access token. Never commit the token; never paste it into a chat.
- **CLI**: `supabase config push` is in the CLI reference sidebar **[S]**, but the fetched page was truncated and I could not confirm it pushes `[auth]`/`[auth.external.google]` to a hosted project. **UNVERIFIED**. `supabase config pull` / `config diff` also listed **[S]**.
- Bottom line: the Google client secret is the one value you should set by hand or via a secret store, not in committed config. The Management API route is viable for scripting the rest, **UNVERIFIED** end to end.

### 7.5 Checklist (human steps)

- [ ] Google: consent screen, External, Testing, add test users.
- [ ] Google: Web OAuth client, JS origins (prod + localhost), redirect URI = Supabase callback.
- [ ] Google: save Client ID and Secret.
- [ ] Supabase: Google provider enabled, Client ID (web), Secret, Skip nonce check OFF.
- [ ] Supabase: Site URL = production origin; allow-list incl. `/auth/callback` and localhost and Vercel preview wildcard.
- [ ] App: `VITE_SUPABASE_URL` and publishable key set on Vercel and locally.
- [ ] Device test on iPhone (iOS 16.4, 17, 18, 26 if available): sign in, kill app, reopen, still signed in; airplane mode for 1 hour then reopen.
- [ ] Before production publish: confirm consent screen branding does not trigger verification you cannot meet.

---

## 8. TypeScript: client and callback route

Assumes React Router. Adjust routing if you use another router.

### 8.1 `src/lib/supabase.ts`

```ts
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

// Default storage is localStorage (auth-js DEFAULT_OPTIONS / constructor, verified).
// flowType 'pkce' is only needed for the redirect fallback. detectSessionInUrl is false
// because the /auth/callback route calls exchangeCodeForSession explicitly.
export const supabase = createClient(url, key, {
  auth: {
    flowType: 'pkce',
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: true,
  },
})
```

### 8.2 `src/auth/google.ts` (primary: GIS + nonce)

```ts
import { supabase } from '../lib/supabase'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as string
const NONCE_KEY = 'gis_nonce_raw'

declare global {
  interface Window {
    google?: any
  }
}

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Raw nonce goes to Supabase; SHA-256 hex of it goes to Google.
export async function createNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const hashed = await sha256Hex(raw)
  try {
    sessionStorage.setItem(NONCE_KEY, raw)
  } catch {
    // sessionStorage can be blocked; the flow still works within the same tick.
  }
  return { raw, hashed }
}

function readRawNonce(): string | undefined {
  try {
    return sessionStorage.getItem(NONCE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

async function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('GIS script failed to load'))
    document.head.appendChild(s)
  })
}

// Render the GIS button into a container. Call once per mount.
export async function renderGoogleButton(container: HTMLElement, onDone: (err?: Error) => void) {
  await loadGis()
  const { raw, hashed } = await createNonce()

  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce: hashed,
    use_fedcm_for_prompt: true, // Chrome; Safari uses the non-FedCM path (UNVERIFIED)
    callback: async (resp: { credential: string }) => {
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: resp.credential,
        nonce: readRawNonce() ?? raw,
      })
      onDone(error ?? undefined)
    },
  })

  window.google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
  })
}

// Call on sign-out so the next GIS prompt does not auto-select the previous account.
export function disableGoogleAutoSelect() {
  window.google?.accounts?.id?.disableAutoSelect?.()
}

// Fallback: redirect PKCE. Starts the flow; the verifier is written by supabase-js.
export async function signInWithGoogleRedirect() {
  const origin = window.location.origin
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { prompt: 'select_account' }, // UNVERIFIED that this is honoured via Supabase
    },
  })
  if (error) throw error
}
```

Notes:
- `use_fedcm_for_prompt` is a GIS `initialize` option name from memory; the fetched FedCM migration page did not confirm it **(UNVERIFIED)**. Remove it if the GIS reference does not list it.
- The button flow has no `google.accounts.id.prompt()` call here. One Tap is optional; add it only after testing on iOS.

### 8.3 `src/routes/AuthCallback.tsx` (dedicated PKCE callback)

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [message, setMessage] = useState('Signing you in...')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')
      const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error')

      if (oauthError) {
        if (!cancelled) setMessage(`Sign-in failed: ${oauthError}`)
        return
      }
      if (!code) {
        // Often: the verifier is missing because the flow started in another context
        // (Safari vs home-screen app). Tell the user to start again in this window.
        if (!cancelled) setMessage('Sign-in could not complete here. Start sign-in again from the app.')
        return
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (cancelled) return
      if (error) {
        setMessage('Sign-in could not complete. Start sign-in again from the app.')
        return
      }
      // Remove code from the URL before navigating so a reload does not retry the used code.
      window.history.replaceState({}, '', '/auth/callback')
      navigate('/', { replace: true })
    })()
    return () => {
      cancelled = true
    }
  }, [navigate])

  return <p style={{ padding: 16 }}>{message}</p>
}
```

Route: `<Route path="/auth/callback" element={<AuthCallback />} />`, outside any auth guard. The `exchangeCodeForSession` call and the single-use 5-minute code are **[V]**. The React StrictMode double-invocation is guarded by `cancelled`, but the exchange itself can still run twice in dev; if so, the second call fails with a used code. Guard with a module-level `let exchanged = false` if this shows up.

### 8.4 Auth state and offline boot

```ts
import { supabase } from '../lib/supabase'

// Render from cache first; only treat a definitive auth error as signed-out.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') {
    // Clear user-scoped cache here, and only here. Never on a network error.
  }
  // session may be null while offline on first boot if no stored session exists.
})
```

---

## 9. Open items and gaps (summary)

- **UNVERIFIED**: whether `signInWithOAuth` leaves the standalone window on iOS 16.4, 17, 18, 26 (and on which version a Safari sheet appears).
- **UNVERIFIED**: whether GIS popup/FedCM works inside a home-screen web app on iOS, and whether the popup result returns to the standalone context.
- **UNVERIFIED**: whether Google's `disallowed_useragent` block applies to home-screen web apps in 2026. Google's policy page is primary **[V]**; the iOS-specific application is not.
- **UNVERIFIED**: auth-js behaviour on a network error during refresh (believed to keep the session; check installed version source).
- **UNVERIFIED**: Google's "100 test users" cap; `supabase config push` scope for auth; `uri_allow_list` format; redirect-URL fallback when `redirectTo` is not allowed.
- **UNVERIFIED**: iOS storage eviction policy for home-screen web apps on iOS 26 (WebKit ITP doc not fetched).
- **Gaps**: no Apple or WebKit primary source for OAuth in standalone home-screen apps was found. Recommend a 30 minute device test matrix on the target iPhones before committing to either flow.

---

## 10. Sources

Primary (fetched for this note):
- Supabase, Sign in with Google: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase, PKCE flow: https://supabase.com/docs/guides/auth/sessions/pkce-flow
- Supabase, Sessions and refresh tokens: https://supabase.com/docs/guides/auth/sessions
- Supabase, Redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase, Management API update auth config: https://supabase.com/docs/reference/api/v1-update-auth-service-config
- Supabase JS init options: https://supabase.com/docs/reference/javascript/initializing
- auth-js source (defaults, verifier key): https://raw.githubusercontent.com/supabase/auth-js/master/src/GoTrueClient.ts
- Google, OAuth embedded webview policy (2021): https://developers.googleblog.com/en/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/
- Google, OAuth refresh-token expiration: https://developers.google.com/identity/protocols/oauth2#expiration
- Google, OAuth consent / publishing status: https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification
- Google, GIS FedCM migration: https://developers.google.com/identity/gsi/web/guides/fedcm-migration
- WebKit Bugzilla 272325 (session cookies reset in Home Screen web app, iOS 17.x): https://bugs.webkit.org/show_bug.cgi?id=272325

Secondary (search summaries or unfetched):
- Auth0 community, disallowed_useragent on iOS home screen (2017): https://community.auth0.com/t/getting-google-disallowed-useragent-with-web-app-added-to-ios-homescreen/6705
- Firebase JS SDK issue 77 (home-screen Google sign-in): https://github.com/firebase/firebase-js-sdk/issues/77
- Progressier help, Google OAuth on iOS PWA: https://intercom.help/progressier/en/articles/9519381-google-oauth2-is-not-working-in-my-pwa-on-ios-why
- heise, iOS 26 changed web app behaviour: https://heise.de/-10749652
- MacRumors forum, iOS 26 add web app: https://forums.macrumors.com/threads/ios-26-add-web-app-or-bookmark-to-iphone-home-screen.2462753
- Cloudspress, Home Screen web app storage: https://www.cloudspress.com/?p=373269
- Corbado, FedCM (Dec 2025, claims FedCM mandatory Aug 2025): https://www.corbado.com/blog/fedcm-federated-credential-management-api.md
- Supabase CLI config push reference (page truncated, unconfirmed): https://supabase.com/docs/reference/cli/supabase-config-push
- Kiwix mirror of oidc PWA Q&A (2014-era): https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/53948916/oidc-and-pwa-add-to-home-screen
- Supabase GitHub issues on PKCE verifier (search only, not fetched): https://github.com/supabase/supabase-js/issues/1696
