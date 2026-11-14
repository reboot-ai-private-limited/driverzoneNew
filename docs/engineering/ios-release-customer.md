# Customer app — iOS release (Xcode on a Mac)

How to build the DriverZone **customer** app for TestFlight / the App Store from a Mac, and what
to give Apple's reviewer. The Android build is unchanged (see `build-and-deploy.md`).

| | |
|---|---|
| Bundle ID | `in.driverzone.customer` (must match App Store Connect, the Firebase iOS app and the Maps iOS key restriction) |
| Devices | iPhone only (`supportsTablet: false`) |
| Apple team | Reboot AI Private Limited |
| Native folder | `apps/customer/ios/` is **generated** (gitignored) — never edit it by hand, re-run prebuild |

## 1. One-time Mac setup

- Xcode (latest stable) + command line tools, CocoaPods (`sudo gem install cocoapods` or `brew install cocoapods`)
- Node 22 and pnpm (`corepack enable`)
- In Xcode → Settings → Accounts, sign in with an Apple ID on the Reboot AI team.
- In the Apple Developer portal, the App ID `in.driverzone.customer` must have **Push Notifications** enabled, and an APNs key must be uploaded to the Firebase project (Project settings → Cloud Messaging → Apple app configuration).

## 2. `apps/customer/.env` for a store build

`.env` is gitignored, so it has to be created on the Mac. Copy `.env.example` and set:

```
EXPO_PUBLIC_API_BASE_URL=https://<live api host>/api   # HTTPS, never localhost / a LAN IP
GOOGLE_MAPS_IOS_API_KEY=<iOS key, restricted to bundle in.driverzone.customer, Maps SDK for iOS only>
GOOGLE_MAPS_ANDROID_API_KEY=<optional on the Mac>
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<Places API (New) key>
IOS_APS_ENVIRONMENT=production
```

`app.config.ts` **refuses to build** when `IOS_APS_ENVIRONMENT=production` and the API URL is not
`https://` (or points at localhost / a LAN address). That is deliberate: the URL is baked into the
bundle, so a wrong value ships an app where every request fails.

`GoogleService-Info.plist` (committed, `BUNDLE_ID = in.driverzone.customer`) is picked up automatically.

## 3. Build

```bash
git clone <repo> && cd driverzoneNew
pnpm install
cd apps/customer
npx expo prebuild -p ios --clean      # generates ios/ from app.json + plugins
cd ios && pod install && cd ..
open ios/DriverZone.xcworkspace        # the .xcworkspace, NOT the .xcodeproj
```

In Xcode:

1. Target **DriverZone** → *Signing & Capabilities*: Team = Reboot AI Private Limited, automatic signing. Push Notifications and Background Modes → Remote notifications should already be present (from config).
2. *General*: check version (`app.json → expo.version`) and build number (`expo.ios.buildNumber`). Bump `buildNumber` in `app.json` for every upload, then re-run prebuild.
3. Scheme **DriverZone**, destination **Any iOS Device (arm64)**, Product → **Archive**.
4. Organizer → **Distribute App** → App Store Connect → Upload.
5. Before submitting, install the TestFlight build on a **real iPhone** and run through §6.

What to verify in the generated project (do this once per SDK upgrade):

- `ios/DriverZone/Info.plist` has `NSLocationWhenInUseUsageDescription` as the only string the app really uses — no `NSLocationAlways…`, camera, microphone or Face ID. It ALSO carries `NSPhotoLibraryUsageDescription` and `NSMotionUsageDescription` worded as "we do not use this": React Native, expo-file-system and Firebase reference the Photos API and expo-location/Reanimated reference Motion, and Apple's upload check (ITMS-90683) rejects the binary without a purpose string for any API it contains, used or not. `UIBackgroundModes` is just `remote-notification`.
- `ios/DriverZone/PrivacyInfo.xcprivacy` exists (written from `app.json → ios.privacyManifests`).
- Target *Supported Destinations* lists iPhone only (`TARGETED_DEVICE_FAMILY = 1`).
- `GMSApiKey` in Info.plist is the iOS key.

## 4. Server settings for App Review

On the production API (`apps/api/.env.prod`), then restart:

```
REVIEW_LOGIN_PHONE=+919999999999,+919999999998
REVIEW_LOGIN_OTP=123456
```

- Only these numbers, only for the **customer** app, accept the fixed code. No WhatsApp/SMS is sent to them. Driver and admin logins never accept it.
- The same fixed code confirms **in-app account deletion** for these numbers, so the reviewer can test deletion. After deleting, the number can sign in again as a brand-new account. Two numbers mean one is still available after the other is deleted.
- **To turn it off after approval:** remove both variables and restart the API (or block the accounts in the admin panel).
- The value is never logged.

## 5. App Review information (App Store Connect → App Review)

**Sign-in required:** yes.

```
Test account 1:  9999999999   (country code +91 is pre-filled)
Test account 2:  9999999998
Verification code (both): 123456 — no message is sent for these test numbers.
```

**Notes for the reviewer** (paste):

> Driver Zone is NOT a taxi or cab service. Customers hire a verified professional driver to
> drive the customer's OWN car. We currently operate in Siliguri, West Bengal, India.
>
> Sign in with either test number above and code 123456. On first sign-in, enter any name.
>
> Outside India: you do not need GPS. Tap the pickup field and search "Siliguri Junction", and
> for the drop search "Bagdogra Airport" (search is limited to India). The fare estimate is then
> shown. Confirming a booking creates a real request to our dispatch team; driver availability
> is real and is not simulated, so a driver may not be assigned — please cancel any test booking
> from the trip screen. Nothing is charged when you book; the trip is paid by cash or UPI.
>
> Account deletion: Profile → Delete account → Send code → enter 123456. If a booking is still
> active the screen asks you to cancel it first. Use test account 2 afterwards if needed.
>
> Optional WhatsApp offers consent: checkbox on the sign-in screen (unticked by default), and
> Profile → Notifications → Offers on WhatsApp.

**Website URLs**

- Privacy Policy: https://www.driverzoneonline.com/privacy
- Terms & Conditions: https://www.driverzoneonline.com/terms
- Support: https://www.driverzoneonline.com/contact
- Account deletion (web): https://www.driverzoneonline.com/delete-account

**App Privacy (nutrition label)** — match `app.json → ios.privacyManifests`: Name, Phone Number,
Precise Location, User ID; all *linked to the user*, *App Functionality*, *not used for tracking*.

## 6. Pre-submission checks on a real iPhone

- Sign in with both review numbers; profile setup requires a name, gender/date of birth optional.
- Terms / Privacy links on the sign-in screen open the website.
- WhatsApp checkbox optional; toggling under Profile → Notifications persists after relaunch.
- Pickup/drop by search with location permission **denied**; fare estimate appears.
- Delete account end-to-end with a review number → app returns to sign-in.
- Notch / Dynamic Island / home indicator on a small (SE/mini) and a large (Pro Max) device: headers, bottom tab bar, bottom sheets, fare sheet.
- Push notification arrives on a TestFlight build (needs `IOS_APS_ENVIRONMENT=production`).
