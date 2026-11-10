# Cellier: can a native iOS app run free (no Apple Developer Program)?

Research date: 2026-11-10. Scope: native Swift/SwiftUI or React Native/Expo, no paid Apple Developer Program ($99/yr). Items marked UNVERIFIED could not be confirmed from a primary source.

## Verdict

**Not feasible for the full requirement set on a free account.**

- Install and test on your own iPhone (13 to 15 Pro): **feasible**, via Xcode "Personal Team", with a 7-day re-sign cycle.
- Remote push (APNs): **blocked**. Push needs a paid membership (Expo's own docs require a development build plus an iOS push key for push; Expo Go no longer does push from SDK 53).
- Distribution to 2-5 other household iPhones: **blocked in practice**. Free accounts can register only 3 devices per 7 days, and there is no TestFlight or App Store distribution.
- Builds that keep working: **7 days**, then every app must be re-signed and reinstalled on each device.
- Google sign-in, camera barcode scanning, background tasks: not blocked by the account type in principle, but the capability matrix for the free tier is UNVERIFIED (see below).

**Deciding constraints, in order:**
1. Remote push needs a paid membership (Apple's free tier is limited to "building and testing"; Expo requires APNs credentials).
2. The 3-device cap per 7 days breaks household distribution beyond 2 other phones (counting yours).
3. No TestFlight for free accounts, so there is no OTA distribution path.
4. 7-day expiry means recurring maintenance for every device.

The $99/yr membership removes all four. Alternatives (EU alternative distribution, AltStore/SideStore) do not avoid the fee, and AltStore/SideStore do not support push.

## 1. Free Apple account ("Personal Team") limits

Source: Apple, "Enable a personal team in Xcode" section of the Choosing a Membership page, https://developer.apple.com/support/compare-memberships (fetched 2026-11-10; the page has a 2026 copyright footer and no capability-level detail in the extracted text).

- Free accounts: "You can register up to 10 App IDs, which expire after 7 days."
- "You can register up to 3 devices, which expire after 7 days."
- "You can install up to 3 apps per device. Provisioning profiles that enable apps to be installed on a device will expire 7 days from issuance. You'll need to rebuild and reinstall your app to your device after expiration."
- Membership is required to "build and test more advanced capabilities and services" and to "distribute apps."
- Apple's membership table lists TestFlight, App Store Connect, Certificates/Identifiers/Profiles, and Xcode Cloud under the paid tiers only (the extracted text lost the check marks, so this row reading is taken from the surrounding prose: UNVERIFIED at cell level).

Apple's "Account types" reference describes the free tier as: "No cost is associated with this agreement and developers can't distribute apps."
Source: https://developer.apple.com/help/account/reference/supported-capabilities-ios/ (2026 copyright footer; no date on the page).

### Capability matrix (free tier)

Apple's per-capability table (https://developer.apple.com/help/account/reference/supported-capabilities-ios/ and the older `/support/reference/supported-capabilities-ios/`, the latter returns 404 now) has the answers, but the cells were not extractable.

| Capability | Free Personal Team | Source status |
|---|---|---|
| Push Notifications (APNs) | Not available (the sources all say this needs a paid membership) | UNVERIFIED cell-level; strong secondary evidence (see §3) |
| Sign in with Apple | Likely not | UNVERIFIED |
| App Groups | Likely not, or unreliable | UNVERIFIED |
| Background Modes | Unclear; general background execution (BGTaskScheduler) does not need a capability entitlement, but the "Background Modes" capability entry is UNVERIFIED | UNVERIFIED |
| iCloud, Associated Domains | Not available | UNVERIFIED (community reports) |
| Google sign-in (URL schemes) | No entitlement needed, so no account gate | Standard practice; not from a source fetched here |
| Camera / AVFoundation barcode scanning | No entitlement needed (only Info.plist usage string) | Standard practice; not from a source fetched here |

Secondary evidence (community guides, not Apple): free-account sideloading guides say Push notifications, VPN and HealthKit are unavailable, and App Groups/iCloud require a paid team. Sources: https://sideloading.gitbook.io/sideloading-master-guide/providers/code-signing-services-free (undated), https://github.com/Spidy123222/SideStore/blob/develop/README.md (undated).

## 2. TestFlight and distribution

- Apple's membership page places App Store Connect (which hosts TestFlight) in the paid tier: "Membership unlocks ... App Store Connect — a suite of tools that allows you to submit and manage your apps for beta testing and distribution." Source: https://developer.apple.com/support/compare-memberships.
- Apple's capability reference: "Apple Developer (free tier) ... No cost is associated with this agreement and developers can't distribute apps." Source: https://developer.apple.com/help/account/reference/supported-capabilities-ios/.
- Conclusion: TestFlight requires a paid membership. Free-account distribution is limited to your own Xcode-installed builds on devices registered to your team (max 3 devices per 7 days).

## 3. Expo Go and development builds

- Expo docs (page modification date 2026-11-02): "In SDK 53 and later, Expo Go does not support push notifications functionality." To test push, use a development build. Source: https://docs.expo.dev/push-notifications/faq/.
- SDK 52 and earlier: Expo Go used Expo's credentials, so push worked in development. This no longer applies from SDK 53. Same source.
- iOS push: "On iOS, this is handled by your push key." Revoking the key breaks delivery. Add keys with `eas credentials`. Same source.
- Local notifications still work in Expo Go (third-party sources only; UNVERIFIED against Expo docs).
- Custom native code: Expo Go cannot run custom native modules. A development build (EAS Build or local Xcode) is required, which means a signed build that is subject to the 7-day expiry above when using a free team. Expo's push key requires a paid developer account to create. UNVERIFIED whether a free Apple ID can create the push key (Apple's APNs key creation is part of Certificates, Identifiers & Profiles, listed as paid).

## 4. EU alternative distribution and sideloading (2026)

- Apple, updated 2026-08-18, effective 2026-10-01: the per-install Core Technology Fee is replaced by a 5% Core Technology Commission (CTC) on digital transactions in apps distributed outside the App Store. Source: https://developer.apple.com/support/dma-and-apps-in-the-eu/ and https://www.apple.com/newsroom/2026/08/apple-announces-changes-for-apps-in-the-european-union/ (via a secondary summary; the newsroom page was read through WebFetch).
- Access to alternative distribution: "To agree to these terms in your Apple Developer account, you'll need to be the Account Holder of your membership. After agreeing to the terms, your developer account will: Have access to alternative distribution tools in App Store Connect." Notarization is required: "To get your app notarized, select the alternative distribution option in App Store Connect."
- No membership fee waiver is stated for alternative distribution. The CTC waiver applies only to small marketplace revenue (under €10M global and €1M lifetime EU). Source: https://developer.apple.com/support/dma-and-apps-in-the-eu/.
- Conclusion: EU alternative distribution requires the paid membership and notarization. It does not remove the $99 fee.
- Free sideloading options (AltStore, SideStore, Sideloadly): free Apple ID, apps expire after 7 days. AltStore needs AltServer on the same Wi-Fi every 7 days; SideStore refreshes on-device after setup. Push notifications are not supported by these tools (community sources, UNVERIFIED against Apple). Limits reported by community sources: only a few active sideloaded apps at once, about 10 app IDs per rolling 7 days. Sources: https://sideloading.gitbook.io/sideloading-master-guide/providers/code-signing-services-free, https://github.com/Spidy123222/SideStore/blob/develop/README.md (both undated, UNVERIFIED).

## 5. Gaps and what I could not verify

- The per-capability availability matrix for the free tier. Apple's page exists, but the extracted text lost the check marks. A browser check of https://developer.apple.com/help/account/reference/supported-capabilities-ios/ (Push Notifications, Sign in with Apple, App Groups, Background Modes, iCloud, Associated Domains, columns "Apple Developer" vs "ADP") would settle it.
- Whether the free team can create an APNs key for Expo (UNVERIFIED; likely no).
- Whether Background Modes (background fetch / processing) is available on a free Personal Team (UNVERIFIED).
- The 3-device and 10-App-ID numbers are from Apple's page as fetched 2026-11-10; they may change without notice.
- Out of scope: PWA alternative (Web Push on installed home-screen web apps). Not researched here; the file name suggests a comparison, but the question asked only about native-for-free.

## Sources

- Apple, Choosing a Membership (free vs paid, personal team limits): https://developer.apple.com/support/compare-memberships (fetched 2026-11-10)
- Apple, Supported capabilities (iOS), account types reference: https://developer.apple.com/help/account/reference/supported-capabilities-ios/ (fetched 2026-11-10, no capability cell data)
- Apple, EU DMA and apps (Core Technology Commission, updated 2026-08-18, effective 2026-10-01): https://developer.apple.com/support/dma-and-apps-in-the-eu/ (fetched 2026-11-10)
- Apple Newsroom, EU App Store changes (2026-08): https://www.apple.com/newsroom/2026/08/apple-announces-changes-for-apps-in-the-european-union/ (fetched 2026-11-10 via secondary summary)
- Expo, Push notifications FAQ (modified 2026-11-02): https://docs.expo.dev/push-notifications/faq/ (fetched 2026-11-10)
- Community, free-tier code signing limits (undated, UNVERIFIED): https://sideloading.gitbook.io/sideloading-master-guide/providers/code-signing-services-free
- Community, SideStore README (undated, UNVERIFIED): https://github.com/Spidy123222/SideStore/blob/develop/README.md
