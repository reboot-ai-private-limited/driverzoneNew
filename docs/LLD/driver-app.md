# Driver App

The driver app has one job the rest of the product depends on: **when a customer books, every
eligible on-duty driver's phone rings — loudly, full-screen, with a countdown — and it keeps
ringing until someone accepts or the offer lapses.** Everything else in this app (onboarding,
duty toggle, trip screens, earnings) is table stakes. The ringing offer is the feature that
decides whether DriverZone has supply.

This is **Phase 6** of [`roadmap.md`](roadmap.md). Today `apps/driver` is a scaffold. This
document is the design to build against; each `## S-n` section is meant to be reviewed and
signed off on its own.

## Scope

| | |
|---|---|
| Platform | **Android only.** No iOS driver app — `prd.md` §6, and the driver population is effectively all Android. |
| Package | `in.driverzone.driver` |
| Distribution | EAS → `driverzone-driver.aab` → Play Store ([`build-and-deploy.md`](../engineering/build-and-deploy.md)). Not part of `turbo run build`. |
| In scope v1 | Phone+OTP auth, non-progressive onboarding + document upload, duty toggle with an Android foreground service, the ringing trip-offer system, the trip lifecycle (en route → arrived → OTP → in-trip → complete), earnings ledger, OEM battery-optimisation onboarding. |
| Out of scope v1 | In-app chat, in-app turn-by-turn navigation (hand off to Google Maps), driver-side fare negotiation, tips, multi-stop trips, in-app payouts. |

### Where the rules actually live

This doc is the driver app's design. It does not restate the systems it sits on top of:

| For | Read |
|---|---|
| Phone+OTP, token lifecycle, rotation | [`auth.md`](auth.md) |
| Driver endpoints, payloads, socket events | [`api-contracts.md`](api-contracts.md) §Driver, §Realtime |
| Driver profile, documents, onboarding, admin verification | [`user.md`](user.md) §Driver |
| Offer waves, eligibility, the accept race, notification delivery | [`dispatch-and-assignment.md`](dispatch-and-assignment.md) |
| Booking state machine, the start OTP, cancellation ladder | [`booking-lifecycle.md`](booking-lifecycle.md) |
| Monorepo/Metro, the foreground-service risk, OEM battery managers | [`mobile-in-monorepo.md`](../engineering/mobile-in-monorepo.md) |
| The API client envelope, the loading system, "render `message` not `code`" | [`frontend-architecture.md`](../engineering/frontend-architecture.md) |

---

## S-1. The honest limitation, stated first

Android has three "off" states, and the difference between them is the whole story of this app:

| App state | How it got there | Does it ring? |
|---|---|---|
| **Foreground / recents** | in use, or recently used | Yes — Socket.IO, sub-second |
| **Backgrounded / swiped from recents, foreground service alive** | driver swiped the app away, or the screen is just off | **Yes** — FCM high-priority data message wakes it; the foreground service keeps the socket alive |
| **Force-stopped** | driver hit "Force stop" in Settings, an OEM "clear-all + lock" cleared it, or the OS put it in the stopped state | **No.** No FCM is delivered, no code runs, nothing wakes it — until the app is opened once by hand. |

**No app can bypass the force-stopped state. Uber and Ola cannot either.** It is an OS
guarantee, not a limitation we can engineer around.

So the design has two halves:

1. **Stay in the middle row for as long as possible** — a foreground service, a battery-
   optimisation onboarding flow, `START_STICKY`, a boot receiver.
2. **Detect the bottom row server-side and tell the driver** — a presence sweeper that flips a
   silent driver off duty and sends an SMS, so a dead app is a visible "you're offline"
   rather than a driver who thinks they're working and silently gets no offers (S-16.4).

Everything below serves one of those two halves.

---

## S-2. Tech stack

Same Expo/RN pins as `apps/customer`. The additions are all in service of the ringing offer.

| Concern | Choice | Why this and not the obvious alternative |
|---|---|---|
| Framework / routing / server state | Expo SDK 57, RN 0.86, React 19, `expo-router`, `@tanstack/react-query` | identical to `apps/customer` — the two apps should be learnable as one |
| Design tokens | `@driverzone/mobile-ui` | `colors`, `fontSize`, `radius`, `space`; no web deps in the Metro bundle |
| Shared types | `@driverzone/contracts` | offer/device/socket types are added here — S-15 |
| Realtime | `socket.io-client` | `/driver` namespace, `join driver:{id}` (`api-contracts.md` §Realtime) |
| Push transport | `@react-native-firebase/app` + `@react-native-firebase/messaging` | gives a real native `FirebaseMessagingService`, so `setBackgroundMessageHandler` runs **headless** when JS is otherwise dead. `expo-notifications` receives FCM but cannot run a background handler that renders a call-style UI. |
| Rich alerts | `@notifee/react-native` | full-screen intent, **looping** custom sound, `AndroidImportance.HIGH` channels, `category: 'call'`, a foreground-service API. `expo-notifications` does **none** of these — it plays the channel sound once and shows a heads-up, nothing more. |
| Foreground service + background location | `expo-location` (background mode) + Notifee's FS API | one persistent notification that keeps the process alive **and** feeds location pings |
| Secure storage | `expo-secure-store` | refresh token in the Keystore — same as customer `tokenStore.ts` |
| Local flags | `@react-native-async-storage/async-storage` | the "was on duty" flag the boot receiver reads |
| Keep screen on | `expo-keep-awake` | while an offer rings in the foreground |
| Sound loop (foreground) | Notifee, not a second audio lib | avoid running `expo-av` **and** Notifee audio — pick one; Notifee already owns the background case |
| Build props | `expo-build-properties` | bundle `offer_ring.mp3` into `res/raw`, bump `minSdkVersion` where RNFirebase/Notifee require it |

### Consequence: no more Expo Go

`@react-native-firebase` and `@notifee/react-native` are native modules. The driver app runs on
a **custom EAS Dev Client**, not Expo Go:

```
eas build --profile development --platform android    # once, install the APK on the device
pnpm --filter @driverzone/driver start                # then the normal JS dev loop
```

This is expected for this app and does not affect `apps/customer`.

---

## S-3. Directory layout

Mirror `apps/customer` so the two apps read the same way. Two rules, both from
`frontend-architecture.md`: **`app/` is routing only**, and **`src/lib/api/endpoints/` mirrors
`apps/api/src/modules/` one-for-one**.

```
apps/driver/
  app.json                   static, reviewable base config
  app.config.ts              dynamic: google-services file ref, config plugins, permissions (S-4)
  google-services.json       gitignored — from the Firebase console
  index.ts                   registers the FCM background handler BEFORE registerRootComponent
  metro.config.js            already correct — do not touch
  assets/offer_ring.mp3      the bundled looping alarm tone (S-9.4)
  app/
    _layout.tsx              SessionProvider + QueryClientProvider + notification-channel bootstrap
    index.tsx                boot screen; routes on session status (S-5)
    (auth)/        _layout.tsx  phone.tsx  otp.tsx
    (onboarding)/  _layout.tsx  profile.tsx  documents.tsx  review-status.tsx
    (tabs)/        _layout.tsx  home.tsx  earnings.tsx  account.tsx
    onboarding/battery-setup.tsx      full-screen, outside the tab group
    offer/[offerId].tsx               the ring screen — full-screen, no tab bar
    trip/[bookingId].tsx              en route / arrived / OTP / in-trip / complete
  src/
    lib/api/{client,ApiError}.ts      copied from customer, unchanged
    lib/api/endpoints/{auth,driver,devices,earnings}.ts
    lib/auth/{session,tokenStore,SessionProvider}.tsx   copied from customer, aud = driver
    lib/query/{client,keys}.ts
    lib/config.ts                     API_BASE_URL, SOCKET_URL
    lib/realtime/socket.ts            connect / disconnect / re-auth on token change
    notifications/
      channel.ts                      creates offer-ring-v1 + duty-status channels
      offerHandler.ts                 ONE renderer for socket + FCM, with dedupe + cancel
      backgroundMessage.ts            the setBackgroundMessageHandler body
      registerDevice.ts               POST/DELETE /driver/devices, onTokenRefresh
      oemIntents.ts                   per-brand Settings deep links
    duty/
      DutyService.ts                  start/stop the foreground service; the on-duty sequence
      locationPings.ts                batched POST /driver/location
      watchdog.ts                     periodic socket/service health check
    features/
      onboarding/{requiredFields,documentTypes}.ts
      offer/{offerModel,countdown}.ts
      trip/{tripState,startOtp}.ts
      earnings/{ledger,format}.ts
    components/                        DutyToggle, CountdownRing, OfferCard, DocRow, EarningRow, ...
    theme/{theme,fonts}.ts            copied from customer
```

---

## S-4. Config & the Firebase file

### `app.config.ts` (new — modelled on `apps/customer/app.config.ts`)

- `android.googleServicesFile = './google-services.json'`. **Warn, don't throw, when it's
  absent** — `expo start`, `typecheck`, and CI all evaluate this file and none of them need
  the key; only a native build does. (Same pattern as the customer app's Maps key.)
- `plugins`: `@react-native-firebase/app`, `@notifee/react-native`, `expo-location` (with the
  background-permission usage strings), `expo-build-properties` (bundle `offer_ring.mp3`, set
  `minSdkVersion`).
- `android.permissions`: the full matrix in S-13.

### `google-services.json`

Add to `.gitignore`. Document acquisition in `apps/driver/.env.example`: Firebase project
`driverzone-<env>`, Android app `in.driverzone.driver`, download `google-services.json` into
`apps/driver/`. No APNs key — Android only.

### `lib/config.ts`

`API_BASE_URL` (default `http://localhost:4000/api`) and `SOCKET_URL` (default
`http://localhost:4000`), read from `EXPO_PUBLIC_*`. Inlined at build time — a build arg, not
runtime env.

---

## S-5. Navigation & the routing rule

`app/index.tsx` is state-driven, exactly like `apps/customer/app/index.tsx`:

```
session.status = booting                          → boot screen (silent refresh via session.restore)
session.status = anonymous                        → (auth)/phone
authenticated,  onboardingStatus != APPROVED      → (onboarding)/*
authenticated,  onboardingStatus == APPROVED      → (tabs)/home
  ── an incoming offer, at any of the above       → offer/[offerId], presented over everything
  ── an active trip                               → trip/[bookingId]
```

- Tabs: **Home** (duty toggle + status), **Earnings**, **Account**.
- `offer/[offerId]`, `trip/[bookingId]`, `onboarding/battery-setup` are full-screen and sit
  **outside** the tab group — a ringing offer must not show a tab bar.
- Deep-link target `driverzone-driver://offer/<id>` — this is what the notification's
  full-screen action launches.

---

## S-6. Auth — phone + OTP

Implements [`auth.md`](auth.md). The customer flow with `aud = driver` and the `/driver/auth/*`
mount points.

- `(auth)/phone.tsx` → `POST /driver/auth/otp/send { mobile_number }`. Reuse the customer's
  E.164 helper (`apps/customer/src/features/auth/phoneNumber.ts` — lift it into
  `@driverzone/mobile-ui` or copy).
- `(auth)/otp.tsx` → `POST /driver/auth/otp/verify { mobile_number, otp }` → `beginSession()`.
  Error codes: `OTP_INVALID_OR_EXPIRED` (401, inline), `OTP_ATTEMPTS_EXCEEDED` (429 → force a
  resend), `OTP_COOLDOWN_ACTIVE` / `OTP_SEND_LIMIT_EXCEEDED` (429 → countdown from
  `retry_after_seconds`, no retry button).
- `is_new_user: true` on the first verify → straight to `(onboarding)/profile`.

### Session — copy `apps/customer/src/lib/auth/session.ts` verbatim

Module-level access token (never persisted), refresh token in `expo-secure-store`, **proactive
single-flight renewal at 80% of the 15-minute TTL**, `restore()` on boot. Driver refresh TTL is
**30 days** (`auth.md`).

One driver-specific rule: **if renewal fails while on duty**, stop the foreground service, stop
location pings, leave the socket, and route to `(auth)/phone`. A logged-out driver must never
still look on-duty to dispatch — that produces offers sent into the void.

---

## S-7. Onboarding & verification

Implements [`user.md`](user.md) §"Driver onboarding & verification". Unlike the customer's
progressive profile, a driver's is **not progressive** — a fixed set is required before
`POST /driver/onboarding/submit` is accepted.

### Screens

- **`(onboarding)/profile.tsx`** → `PATCH /driver/profile`: `full_name`, `dob`, address,
  `vehicle_category_preference` (what the driver is competent to drive, not what they own),
  `can_drive_hill` (self-declared). The admin sets `can_drive_hill_verified` separately, and
  **that** is the flag hill dispatch reads.
- **`(onboarding)/documents.tsx`** — per document:
  1. `POST /driver/documents { type }` → returns a presigned `upload_url` (300 s) and records
     the row `PENDING`.
  2. `PUT` the image straight to storage (`expo-image-picker`, already a customer dep).
  3. Render per-document status: `PENDING` / `VERIFIED` / `REJECTED` + `rejectionReason`.

  **Required before submit: `LICENCE` and `AADHAAR`.** `RC` and `INSURANCE` are accepted but
  not blocking (this list is a judgement call flagged in `user.md` — adjust if the real form
  differs).
- **Submit** → `POST /driver/onboarding/submit`. On `422 { data: { missing: [...] } }`, map
  each missing key (`dob`, `documents.AADHAAR`, …) to its field and scroll to it — do **not**
  drop the driver at a generic "complete your profile" screen (`user.md` line 206).
- **`(onboarding)/review-status.tsx`** — after `SUBMITTED`, show "under review". On `APPROVED`
  → tabs. On `REJECTED` → show `reason`, allow edit + `POST /driver/onboarding/submit` again.

### The duty gate

`POST /driver/duty { on_duty: true }` returns **409** unless `onboardingStatus === APPROVED`
(the same `isVerified` flag the dispatch eligibility query reads). The Home toggle renders the
409 `message` verbatim.

---

## S-8. Home, the duty toggle, and the foreground service

### Home screen

The **Go on duty / Go off duty** toggle; current status; today's trip count and earnings
(`GET /driver/earnings`); a warning banner when notification permission is denied or battery
optimisation is unhandled (S-12).

### Going on duty — the sequence, in order

1. Ensure runtime permissions: `POST_NOTIFICATIONS` (Android 13+), fine + background location,
   and *prompt* for `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (prompt, not a hard gate — S-12).
2. `POST /driver/duty { on_duty: true }`. On 409, show `message` and stop here.
3. Start the **foreground service** (Notifee, type `location`), `START_STICKY`, with the
   `duty-status` (LOW) notification: "DriverZone — you're online".
4. Open the Socket.IO connection, authenticate with the access token, `join driver:{id}`.
5. Start `locationPings` (S-10).
6. `registerDevice()` — push the current FCM token (S-11).
7. Persist the "was on duty" flag.

### Going off duty — the reverse

`POST /driver/duty { on_duty: false }` → stop pings → leave the socket → stop the foreground
service → clear the "was on duty" flag.

### Boot receiver

`RECEIVE_BOOT_COMPLETED` → if the "was on duty" flag is set and a valid refresh token exists,
re-run steps 3–6 headlessly and re-post the persistent notification. A phone that reboots
mid-shift comes back on duty.

### Why a foreground service at all

`dispatch-and-assignment.md` §"Notification delivery" and `mobile-in-monorepo.md` are explicit:
FCM alone, to a backgrounded app on Xiaomi / Oppo / Vivo / Realme, is delayed or dropped by
minutes. The service keeps the process alive and the socket connected so offers arrive
sub-second while on duty. **Prototype this in week one before committing to Expo managed** — if
Notifee's foreground-service API cannot produce the exact behaviour, a small custom config
plugin is the fallback. That is a build-strategy change, not a rewrite.

---

## S-9. The ringing trip-offer system

The centre of the app. Read S-1 first.

### 9.1 Delivery — two channels, always both

| Path | Wins when | Latency |
|---|---|---|
| **Socket.IO** `offer.new` on `/driver` | app foreground, or backgrounded with the foreground service alive | sub-second |
| **FCM** high-priority **`data`** message | app backgrounded or swiped from recents | seconds; OEM-dependent |

Both fire for every offer. The server records `deliveredVia` = `SOCKET` / `FCM` / `BOTH` /
`NONE` on `dispatchOffers` (`database-schema.md` — the field already exists). An offer that
`LAPSED` with `deliveredVia = NONE` is an **infrastructure failure**: it must not count against
the driver's acceptance rate, and a rising `NONE` rate is the early warning that push delivery
is degrading.

### 9.2 Message shapes (server → app)

FCM is **`data`-only — no `notification` block.** A `notification` block makes Android draw the
message itself, on the default channel, with no looping sound and no full-screen intent. High
priority; `ttl` ≤ the offer TTL (a message delivered after the offer is dead is noise).

```jsonc
// offer.new  — socket event payload and FCM data payload are the same shape
{
  "type": "offer.new",
  "offerId": "…", "bookingId": "…", "reference": "DZ-8F3K2M",
  "expiresAt": "2026-08-31T09:14:45Z",
  "earningPaise": 70875, "earningDisplay": "₹708.75",
  "pickupSummary": "Sevoke Road, Siliguri",
  "dropSummary": "Bagdogra Airport",
  "serviceLabel": "Outstation · one-way"
}

// offer.cancelled  — closes a ringing screen the instant another driver wins
{ "type": "offer.cancelled", "offerId": "…", "reason": "ALREADY_ASSIGNED" }
```

(FCM `data` values are strings on the wire; `offerHandler` parses `earningPaise` and dates.)

### 9.3 Notification channels — `notifications/channel.ts`, created once at startup

| Channel id | Importance | Sound | Other |
|---|---|---|---|
| `offer-ring-v1` | `HIGH` | `offer_ring`, audio usage **ALARM** — so it rings through silent and vibrate modes | `bypassDnd: true` (needs `ACCESS_NOTIFICATION_POLICY`), a vibration pattern, lights |
| `duty-status` | `LOW` | none | the persistent "you're online" notification |

A channel's sound and importance are **immutable after it is first created** on the device.
That is why the id carries `-v1` — changing the tone or importance later means creating
`offer-ring-v2` and migrating, not editing `offer-ring-v1`.

### 9.4 The sound asset

`assets/offer_ring.mp3` — a loud ~3–4 s alarm-style tone. A royalty-free placeholder ships now
and is swapped later; it is one file to replace. Bundled into
`android/app/src/main/res/raw/offer_ring.mp3` via `expo-build-properties` / Notifee's asset
convention. Notifee loops it (`loopSound: true`) until Accept, Decline, expiry, or
`offer.cancelled`.

### 9.5 Rendering — one renderer, three inputs (`notifications/offerHandler.ts`)

| Situation | Path |
|---|---|
| App foreground | socket `offer.new` → `router.push('/offer/<id>')`, start the Notifee sound loop + vibration + `expo-keep-awake` |
| App backgrounded, service alive, screen off | socket `offer.new` → `notifee.displayNotification` with a `fullScreenAction` → the OS wakes the screen and shows it over the lock screen |
| App swiped / JS dead | FCM → `backgroundMessage.ts` → `notifee.displayNotification`: |

```jsonc
{
  "android": {
    "channelId": "offer-ring-v1",
    "category": "call",
    "importance": "HIGH",
    "fullScreenAction": { "id": "default", "launchActivity": "default" },
    "pressAction":      { "id": "default", "launchActivity": "default" },
    "loopSound": true,
    "ongoing": true,
    "autoCancel": false,
    "timeoutAfter": <ttlMs>,
    "lightUpScreen": true
  }
}
```

- **Dedupe.** Every path keys on `offerId`. The first to render wins; the rest are no-ops — a
  socket + FCM double-delivery must not double-ring.
- **Cancel.** `offer.cancelled` (from either channel) → stop the sound, `cancelNotification`,
  and if the ring screen is open, show "Taken by another driver" for ~1.5 s, then dismiss.
- The launched Activity sets `setShowWhenLocked(true)` and `setTurnScreenOn(true)` (via the
  full-screen intent, plus a one-line manifest tweak in a tiny config plugin if needed).

### 9.6 `offer/[offerId].tsx` — the ring screen

Full-bleed, no tab bar. A `CountdownRing` driven by `expiresAt`; `earningDisplay` large;
pickup → drop; `serviceLabel`. **Accept** and **Decline**.

- On mount: fire-and-forget `POST /driver/offers/:id/seen` (sets `dispatchOffers.seenAt`).
- **Accept** → `POST /driver/offers/:id/accept`:
  - `200 { claimed: true, booking }` → stop the sound, `router.replace('/trip/<bookingId>')`.
  - `200 { claimed: false, reason: "ALREADY_ASSIGNED", message }` → show `message`, dismiss.
    **This is a normal outcome, HTTP 200, and never counts against acceptance rate**
    (`api-contracts.md` §`POST /driver/offers/:id/accept`).
- **Decline** → `POST /driver/offers/:id/decline { reason? }` → dismiss. Counts toward the
  acceptance rate; a lapse does too.
- **Lapse** (countdown hits zero): the sound stops on its own (`timeoutAfter`), the screen
  dismisses, and there is **no client call** — the server marks `LAPSED` on its own wave
  timeout.
- Every exit path: stop the sound, cancel the notification, release keep-awake, clear the
  dedupe key.
- **Recovery.** If the app is killed mid-offer, on the next foreground call
  `GET /driver/offers`; if a live offer comes back, re-present this screen with the
  time that's left.

### 9.7 What happens when the app is force-stopped

Nothing, on the device — see S-1. The server handles it: the presence sweeper (S-16.4) sees the
driver's location go stale, flips them off duty, and sends one SMS. The driver learns they were
offline instead of silently missing every offer.

---

## S-10. Location pings

Implements `api-contracts.md` §`POST /driver/location`.

- Collect fixes from `expo-location` background updates while on duty.
- **Batch 5–10 fixes per request, every 10–15 s.** Never one HTTP request per GPS fix — it
  drains batteries and, at scale, costs a driver base.
- Buffer to AsyncStorage when offline; flush **in order** on reconnect. `recorded_at` is
  client-supplied for exactly this reason.
- Stop entirely when off duty.

---

## S-11. Device-token registry (client side)

- On login, and on `messaging().onTokenRefresh` → `POST /driver/devices { fcm_token,
  platform: "android", app_version }`.
- On sign-out → `messaging().deleteToken()` then `DELETE /driver/devices`.
- The server prunes any token FCM reports as `not-registered` (S-16.1).

---

## S-12. OEM battery-optimisation onboarding

`mobile-in-monorepo.md` calls this "the highest-leverage screen in the driver app," and it is:
it is the difference between a driver app that receives offers and one that doesn't.

`onboarding/battery-setup.tsx` — shown once after the first approval, and re-surfaced by a Home
banner whenever the app detects it missed an offer while not battery-whitelisted.

- Request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`.
- Per-brand deep links into the right Settings page, with a screenshot for each
  (`notifications/oemIntents.ts`), keyed off `Device.manufacturer`:
  - **MIUI / Xiaomi / Redmi** — Autostart, and battery saver → "No restrictions"
  - **Oppo / Realme** — Startup manager, and "Allow background activity"
  - **Vivo** — "High background power"
  - **Samsung** — "Never sleeping apps", and unrestricted battery usage
- A **self-test** button: ask the server for a fake offer 30 s out (S-16.3) so the driver can
  lock the phone and confirm it rings.
- No library covers every OEM reliably — the intent list is hand-maintained and will need
  updates as skins change.

---

## S-13. Android permissions

| Permission | For | Requested |
|---|---|---|
| `POST_NOTIFICATIONS` | Android 13+ notifications | at first go-on-duty |
| `USE_FULL_SCREEN_INTENT` | the call-style offer over the lock screen | manifest; special-access on Android 14+ — see below |
| `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` | the duty service | manifest |
| `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION` | pings and live tracking | at go-on-duty (background = a Settings redirect on Android 11+) |
| `ACCESS_NOTIFICATION_POLICY` | `bypassDnd` on `offer-ring-v1` | manifest + optional user grant |
| `WAKE_LOCK` | hold the CPU while ringing | manifest |
| `RECEIVE_BOOT_COMPLETED` | restart the duty service after a reboot | manifest |
| `VIBRATE` | offer vibration | manifest |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | the battery-whitelist prompt | S-12 |

### `USE_FULL_SCREEN_INTENT` and Play policy

Android 14 made this a special-access permission. Google Play grants it by default only to apps
whose core function is calling or alarms, and can revoke it for others. Two things, both in
scope for the build:

1. **File the Play Console full-screen-intent declaration** describing the ringing-offer use
   case. Dispatch/rides apps are normally accepted in the same bucket as delivery apps.
2. **Degrade gracefully.** If the permission is unavailable, fall back to a `HIGH`-importance
   heads-up notification with the same looping alarm sound. Still loud; it just doesn't wake
   the screen and take over the lock screen — the driver taps it to open the offer. This
   fallback path must be tested, not only the happy path.

---

## S-14. API endpoints consumed

Everything is already in `api-contracts.md` / `user.md` except the four marked **NEW**, which
this document introduces (specced in S-16).

| Method | Path | Section |
|---|---|---|
| POST | `/driver/auth/otp/send`, `/verify`, `/refresh`, `/logout` | S-6 |
| GET / PATCH | `/driver/profile` | S-7 |
| GET / POST | `/driver/documents` | S-7 |
| POST | `/driver/onboarding/submit` | S-7 |
| POST | `/driver/duty` | S-8 |
| POST | `/driver/location` | S-10 |
| GET | `/driver/offers` | S-9.6 |
| POST | `/driver/offers/:id/accept`, `/decline` | S-9.6 |
| POST | `/driver/offers/:id/seen` | **NEW** — delivery/seen tracking |
| POST | `/driver/bookings/:id/arrived`, `/start`, `/complete` | S-17 |
| GET | `/driver/earnings`, `/driver/schedule` | S-18 |
| POST / DELETE | `/driver/devices` | **NEW** — S-11 |
| POST | `/dev/fake-offer`, `/dev/fake-offer/cancel` | **NEW, dev-only** — S-16.3 |

Socket `/driver` namespace: **recv** `offer.new`, `offer.cancelled`, `booking.updated`;
**emit** `location.ping` (optional — the HTTP batch in S-10 is the primary path).

---

## S-15. `@driverzone/contracts` additions

Shared by the app and the API, barrel-exported from `packages/contracts/src/index.ts`:

- `OfferPushPayload`, `OfferCancelledPayload` — the shapes in S-9.2.
- `RegisterDeviceRequest` / response — S-11.
- `DriverOfferAcceptResponse` — the `{ claimed: true, booking } | { claimed: false, reason,
  message }` union.
- The `/driver` socket event map.

---

## S-16. Server prerequisites (`apps/api`)

The API is at Phase 1 (zones only). The driver app can be built and verified end-to-end
**without** Phases 4–5 by adding the following. When the real dispatch worker (Phase 5) lands,
its per-offer send/cancel calls route through the same `notifications` module — no client
change.

### 16.1 `notifications` module — `apps/api/src/modules/notifications/`

Per `module-anatomy.md`. Public surface:

- `sendOffer(driverId, offer)` → emit the socket event to `driver:{id}` **and** send an FCM
  `data`-only, high-priority message (`ttl` ≤ offer TTL) to every registered token, via
  `firebase-admin`. Returns `{ deliveredVia }` for the caller to persist on the
  `dispatchOffers` row.
- `cancelOffer(driverId, offerId, reason)` → the same two channels with the `offer.cancelled`
  shape.
- On an FCM `messaging/registration-token-not-registered` error, delete that token row.

New dependency: `firebase-admin`. Credentials via **`FCM_SERVICE_ACCOUNT_PATH`** — a filesystem
path to the service-account JSON (NOT inline JSON, and NOT `FCM_SERVICE_ACCOUNT_JSON`, which was
this doc's original name and does not exist in the code). Read by
`apps/api/src/modules/notifications/notifications.container.ts`; unset ⇒ `MockPushSender` and no
offer ever reaches a device. `docker-compose.prod.yml` mounts the file and sets the path for the
`api` and `worker` services; see `apps/api/.env.prod.example`.

### 16.2 `driverDevices` collection + endpoints

Schema `{ driverId, fcmToken (unique), platform, appVersion, lastSeenAt }`, index on
`driverId`. `POST /driver/devices` (upsert on `fcmToken`), `DELETE /driver/devices`
(by token, from the body).

### 16.3 `POST /dev/fake-offer` — dev-only trigger

Guarded by `NODE_ENV !== 'production'` — **throws** in production, the same posture as
`StubDocumentStorage` in `user.md`. Body `{ driver_id, ttl_seconds? }` → create a throwaway
`dispatchOffers` row → call `notifications.sendOffer`. Plus `POST /dev/fake-offer/cancel`. This
is the trigger for the S-21 device matrix and the S-12 self-test.

### 16.4 Presence sweeper

A BullMQ repeatable job, every 60 s: for every on-duty driver whose `lastLocationAt` is older
than `dispatch.presence_timeout` (default **2 min** — the same staleness threshold the
eligibility query in `dispatch-and-assignment.md` already applies), set `isOnDuty = false`,
write a `driverEvents` row, and send one FCM + one SMS: *"You've gone offline — reopen
DriverZone to keep receiving trips."* This is the server-side half of S-1.

### 16.5 Auth + onboarding endpoints

The `/driver/auth/*` OTP mount points and the driver profile / documents / onboarding endpoints
from `user.md`, if not already delivered under Phase 0.

### 16.6 `POST /driver/offers/:id/seen`

Sets `dispatchOffers.seenAt`. Trivial, but it is what makes "delivered but never seen"
measurable.

---

## S-17. Trip lifecycle

`trip/[bookingId].tsx` is a state machine over `booking.status` (`booking-lifecycle.md`),
advanced by `booking.updated` socket events.

| Status | Screen | Action → endpoint |
|---|---|---|
| `ASSIGNED` | trip card + "Start navigation" | opens Google Maps to the pickup |
| `DRIVER_EN_ROUTE` | en route to pickup, masked call to the customer | "I've arrived" → `POST /driver/bookings/:id/arrived` |
| `ARRIVED` | OTP entry | `POST /driver/bookings/:id/start { otp }` — the customer's 4-digit code, read aloud. 5 wrong attempts locks and routes to support. If the driver is > 500 m from the pickup, **warn but allow**, and the server records an `override` flag (`booking-lifecycle.md` §"Trip start OTP") |
| `STARTED` | in-trip: elapsed time, drop, masked call, "End trip" | `POST /driver/bookings/:id/complete { actual_distance_m, cash_collected_paise }` |
| `COMPLETED` | fare + commission split + cash-collected summary; rate the customer | back to Home |
| `CANCELLED_*` | reason shown, back to Home | a driver-initiated cancel carries a penalty and an acceptance-rate hit that **escalates by stage** (`booking-lifecycle.md` cancellation table) |

---

## S-18. Earnings

`earnings.tsx` → `GET /driver/earnings?from=&to=`.

- Per-trip breakdown (fare, commission split, cash collected), period totals, payout history.
- **Wallet balance**, with a warning as it approaches the negative-balance threshold that
  blocks duty. Cash-collected commission leakage is a named product risk (`prd.md` §8): the
  wallet is allowed to go negative and the driver is blocked from going on duty past a
  threshold.
- Upcoming assigned trips from `GET /driver/schedule` (a Home section or its own tab — open
  question, S-22). Pre-assigned scheduled trips get a reconfirm prompt at T−2 h
  (`dispatch-and-assignment.md`).

---

## S-19. Reliability & edge behaviour

- **Socket reconnect** — exponential backoff. On every reconnect, `GET /driver/offers`
  to catch an offer that arrived during the gap.
- **Watchdog** (`duty/watchdog.ts`) — while on duty, a periodic (~15 min) check that the socket
  is connected and the foreground notification is still posted; repair if not. It cannot run if
  the process was force-stopped — that case is S-16.4's job.
- **Clock skew** — the countdown uses server `expiresAt` minus an offset measured at the socket
  handshake, never the raw device clock.
- **Duplicate accept** — the server's atomic claim is the only source of truth; the client just
  renders `claimed: false` without drama.
- **Notification permission revoked mid-shift** — Home banner, and block go-on-duty until it's
  restored.

---

## S-20. Loading / error / empty states

Same discipline as `frontend-architecture.md` §"The loading system":

- Skeletons, not spinners. A background refetch is a 2px bar, not a loading state.
- **Render the server's `message` verbatim; never build copy from `code`.** The installed app
  is a store binary — a reason added server-side later would render as a blank string on every
  older client. `code` is for control flow only.
- `available: false`-style responses are ordinary data, not errors.
- Every data surface handles all four of loading → error → empty → ready.

---

## S-21. Build, release & verification

### Build profiles

```
eas build --profile development --platform android   # dev client — install once
eas build --profile preview     --platform android   # shareable APK for the device matrix
eas build --profile production  --platform android   # .aab → Play Store
```

### Automated tests (`testing.md`)

- **`notifications` module** — `firebase-admin` and the socket mocked: assert the FCM message
  is `data`-only, `priority: high`, with the right `ttl`; assert `deliveredVia` reconciliation
  across SOCKET / FCM / BOTH / NONE; assert a `not-registered` token row is deleted.
- **`driverDevices`** lifecycle (upsert on token, delete by token).
- **Presence sweeper** — a stale `lastLocationAt` flips `isOnDuty` and fires the SMS + FCM.
- **App unit tests** — countdown math, offer dedupe, `requiredFields` → `missing[]` mapping;
  lift the customer's session-renewal tests.
- **Detox e2e** — `offer/[offerId]` accept / decline / lapse, foreground only. Background
  ringing is a manual device matrix, not an e2e.

### Manual device matrix — the real proof

An EAS `preview` build on **Xiaomi/Redmi, Oppo or Realme, Vivo, and Samsung**. Fire
`POST /dev/fake-offer` and verify each row:

| App state | Expected |
|---|---|
| Foreground | ring screen immediately, loud looping sound |
| Backgrounded, screen on | heads-up + loud loop; tap opens the ring screen |
| Screen off + locked | screen wakes, full-screen offer over the lock screen, loud loop |
| Swiped from recents (service alive) | same as the locked case, delivered via FCM |
| After a device reboot (was on duty) | the duty service restarts; the offer still rings |
| Battery-optimised, **not** whitelisted | may be delayed or dropped — this is what S-12 fixes; confirm whitelisting fixes it |
| **Force-stopped** | no ring (expected); within ~2 min the server flips the driver off duty and an SMS arrives |

Also assert: the sound plays through **silent / vibrate** mode (alarm stream); it **stops** on
Accept and on `POST /dev/fake-offer/cancel`; `deliveredVia` and `seenAt` are written on the
`dispatchOffers` row.

---

## S-22. Risks & open questions

- **`USE_FULL_SCREEN_INTENT` revocation (Android 14 / 15).** Mitigated by the Play declaration
  and the heads-up fallback (S-13). Test the fallback path explicitly.
- **Expo managed vs a bespoke foreground-service plugin.** If Notifee's foreground-service API
  can't produce the exact notification behaviour, a small custom config plugin is needed.
  Decide in week one, while it's cheap (`mobile-in-monorepo.md`).
- **Firebase project setup** — `google-services.json` and a service-account key are hard
  prerequisites for any on-device testing.
- **Open — offer TTL.** The app countdown needs a value; dispatch's default is 45 s. Confirm
  the app reads it from `expiresAt` alone and shows no hard-coded number.
- **Open — cash collection UX** for prepaid vs cash bookings at `complete`.
- **Open — does `schedule` get its own tab**, or live as a Home section?

---

## Execution order

Each step is independently reviewable and testable.

1. This document + links from `docs/README.md` and `roadmap.md` Phase 6.
2. `@driverzone/contracts` additions (S-15).
3. Server prerequisites (S-16): `notifications` module, `driverDevices`, `/dev/fake-offer`,
   presence sweeper — with the unit tests in S-21.
4. Driver-app skeleton: dependencies, `app.config.ts`, the dev-client build; copy `lib/api`,
   `lib/auth`, `lib/query` from `apps/customer`; boot + routing (S-5).
5. Auth (S-6) → onboarding (S-7), on a real dev client.
6. **The offer system (S-9) + the foreground service (S-8)** — the week-one prototype, driven
   by `/dev/fake-offer`, run against the S-21 device matrix. This is the make-or-break step;
   everything else is ordinary app work.
7. Trip lifecycle (S-17), earnings (S-18), OEM onboarding (S-12).
8. Wire the real dispatch worker to `notifications` once Phase 5 exists.
