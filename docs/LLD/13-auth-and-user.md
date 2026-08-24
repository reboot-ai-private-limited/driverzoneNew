# 13 — Auth & User (Identity)

`https://api.driverzone.in/v1` — same base as `08-api-contracts.md`.

- JSON only, `snake_case` keys, same wire conventions as `08-api-contracts.md`.
- All three roles — `customer`, `driver`, `admin` — authenticate with **phone + OTP**. See the
  decision log, 2026-08-24, for why admin no longer uses email + password + TOTP.
- `Authorization: Bearer <jwt>` on every authenticated request. The JWT's `aud` claim is the
  role; a customer token on a driver route is `403 FORBIDDEN`, a missing/malformed token is
  `401 UNAUTHENTICATED`.
- **This doc is API surface only** — endpoints, payloads, error/success codes. Frontend/UI flow
  (screens, client state machines, onboarding copy) is a later addition to this same doc.

## Errors

New codes this module introduces:

```jsonc
{
  "error": {
    "code": "OTP_ATTEMPTS_EXCEEDED",
    "message": "Too many incorrect attempts. Request a new code.",
    "details": { "retry_after_seconds": 0 },
    "request_id": "req_01J…"
  }
}
```

| Code | Status | Meaning |
|---|---|---|
| `OTP_INVALID_OR_EXPIRED` | 401 | Wrong code, expired challenge, or — for admin — a number that was never provisioned. Deliberately indistinguishable from the outside; see §Admin. |
| `OTP_ATTEMPTS_EXCEEDED` | 429 | 5 wrong guesses against one challenge burns it. `otp/send` again; there is no "one more try". |
| `OTP_COOLDOWN_ACTIVE` | 429 | A resend was requested inside the 60s cooldown. `details.retry_after_seconds` says how long. |
| `OTP_SEND_LIMIT_EXCEEDED` | 429 | 5 sends/hour/phone or 10 sends/hour/IP, whichever hits first. |
| `SESSION_REVOKED` | 401 | The refresh token's session family was revoked — almost always because an already-used refresh token was replayed. Sign in again. |
| `REFRESH_TOKEN_INVALID` | 401 | Malformed, expired, or a signature that doesn't verify. |

`UNAUTHENTICATED`, `FORBIDDEN` and `RATE_LIMITED` (already in `FAULT_CODES`, `08-api-contracts.md`)
cover the generic cases — a missing bearer token, a right-token-wrong-audience request, and
throttling that isn't OTP-specific (e.g. `POST /quotes` 30/min/user). They are reused here, not
duplicated.

---

## OTP

One mechanism, three mount points — `/customer/auth/otp/*`, `/driver/auth/otp/*`,
`/admin/auth/otp/*` are the same use case parameterized by role, not three implementations.

A 6-digit numeric code (`crypto.randomInt`, not `Math.random`), delivered by SMS, valid **5
minutes**. This is a different code from the 4-digit trip-start OTP in
`07-booking-lifecycle.md` — that one is read aloud to a driver in person; this one is a
SMS-delivered login credential. No reason to share a length.

### `POST /{role}/auth/otp/send`

```jsonc
{ "mobile_number": "+919876543210" }
```

**200**

```jsonc
{ "sent": true, "expires_in_seconds": 300, "retry_after_seconds": 60 }
```

**429**

```jsonc
{ "error": { "code": "OTP_COOLDOWN_ACTIVE", "message": "Please wait before requesting another code.",
    "details": { "retry_after_seconds": 41 }, "request_id": "req_01J…" } }
```

Rate-limited to 5 sends/hour/phone (the existing spec, `09-architecture.md`) and 10 sends/hour/IP
(new — blunts enumeration from a single source hammering many numbers). The response shape is
**identical** whether or not `mobile_number` is already registered — nothing here reveals
account existence, matching the same anti-enumeration posture as `otp/verify` below.

### `POST /{role}/auth/otp/verify`

```jsonc
{ "mobile_number": "+919876543210", "otp": "482913" }
```

**200 — customer / driver**

```jsonc
{
  "is_new_user": false,
  "access_token": "eyJ…",
  "refresh_token": "eyJ…",
  "user": { "id": "…", "full_name": "…", "mobile_number": "+919876543210" }
}
```

`is_new_user: true` on the first-ever verify for that number — the account is created right
here, with only `mobile_number` set. The client walks onboarding (name, DOB, …) afterward via
`PATCH /{role}/profile`. There is no separate registration endpoint for customer or driver.

**200 — admin**

```jsonc
{ "access_token": "eyJ…", "user": { "id": "…", "full_name": "…" } }
```

No `refresh_token` in the body (it's set as a cookie — see §Token lifecycle) and no
`is_new_user` — admin accounts are never created by this endpoint. See §Admin.

**401**

```jsonc
{ "error": { "code": "OTP_INVALID_OR_EXPIRED", "message": "That code is incorrect or has expired.",
    "request_id": "req_01J…" } }
```

Five wrong attempts burns the challenge (`OTP_ATTEMPTS_EXCEEDED`) — the client's next move is
`otp/send` again, not another guess.

---

## Token lifecycle

- **Access token** — JWT, `HS256`, 15-minute TTL, claims `{ sub, role, aud, iat, exp }`.
  Verified statelessly, no DB round-trip. `aud` equals `role`, which is the audience check: a
  token issued for one role is rejected outright on another role's routes.
- **Refresh token** — also a JWT (self-describing expiry), signed with a **separate** secret
  from the access token, carrying `sid` (session id). Backed by a `sessions` record
  (`03-database-schema.md`) for rotation and revocation.
- **Rotation** — every `refresh` call issues a new refresh token and marks the presented one
  used. **Reusing an already-used refresh token revokes its entire session family** — the
  signature of a stolen token racing the legitimate client, not a routine retry. A ~5s grace
  window tolerates a genuine double-submit from a flaky mobile connection without flagging it
  as theft.
- **TTLs** — access: 15 minutes, all roles. Refresh: **30 days** for customer/driver (mobile
  apps expect to stay logged in), **12 hours** for admin (shorter web session, higher-privilege
  role — the one safeguard kept after dropping TOTP; see decision log, 2026-08-24).
- **Delivery** — admin's refresh token is an httpOnly, Secure, `SameSite=Strict` cookie scoped
  to `/api/admin/auth`; its access token is in the body. Customer and driver get **both**
  tokens in the body — mobile apps can't rely on an httpOnly cookie, and the client stores the
  refresh token in Keychain / EncryptedSharedPreferences.
- **Clients must refresh proactively** — at roughly 80% of the access token's 15-minute
  lifetime, not reactively on a `401`. This matters most for the driver app: it runs a
  foreground service while on duty (`09-architecture.md`), and a token lapsing mid-shift on a
  weak signal is a working driver logged out, not just a retry.

### `POST /{role}/auth/refresh`

Customer/driver body: `{ "refresh_token": "eyJ…" }`. Admin: **no body** — the cookie is read
server-side.

**200**

```jsonc
{ "access_token": "eyJ…", "refresh_token": "eyJ…" }
```

Admin's response omits `refresh_token` — it's rotated into the cookie instead, never into JSON.

**401 — reused or revoked**

```jsonc
{ "error": { "code": "SESSION_REVOKED", "message": "Please sign in again.", "request_id": "req_01J…" } }
```

### `POST /{role}/auth/logout`

Customer/driver body: `{ "refresh_token": "eyJ…" }`. Admin: no body — clears the cookie. Revokes
the session. Always `200 { "logged_out": true }`, even if the token was already invalid —
logout is idempotent by design, since a client retrying a logout after a flaky response must
never see an error for something that already happened.

---

## Customer

| Method | Path | Notes |
|---|---|---|
| `POST` | `/customer/auth/otp/send` | See §OTP |
| `POST` | `/customer/auth/otp/verify` | See §OTP |
| `POST` | `/customer/auth/refresh` | See §Token lifecycle |
| `POST` | `/customer/auth/logout` | |
| `GET` | `/customer/profile` | Personal info, contact, saved addresses, vehicles |
| `PATCH` | `/customer/profile` | `full_name`, `dob`, `gender`, `languages_known`, `alternate_number`, `emergency_contact` |
| `POST` | `/customer/addresses` | Add a saved address |
| `PATCH` | `/customer/addresses/:id` | |
| `DELETE` | `/customer/addresses/:id` | |
| `POST` | `/customer/vehicles` | Add a vehicle |
| `PATCH` | `/customer/vehicles/:id` | |
| `DELETE` | `/customer/vehicles/:id` | |

**Profile completeness is progressive, by design.** No endpoint in this module ever requires a
customer field beyond `mobile_number` — everything else fills in through normal use, including
at booking time (see §Module contract). If a downstream module needs a field to exist before it
will act — `bookings` needing `full_name` to show a driver who they've been matched with, for
instance — that's the requiring module's constraint to enforce at the point it needs it, not a
signup requirement imposed here.

### `PATCH /customer/profile`

```jsonc
{
  "full_name": "Anita Sharma",
  "dob": "1994-03-12",
  "gender": "FEMALE",
  "languages_known": ["Bengali", "Hindi", "English"],
  "alternate_number": "+919812345678",
  "emergency_contact": { "name": "Rahul Sharma", "number": "+919812340000" }
}
```

**200**

```jsonc
{
  "id": "…", "full_name": "Anita Sharma", "mobile_number": "+919876543210",
  "dob": "1994-03-12", "gender": "FEMALE",
  "languages_known": ["Bengali", "Hindi", "English"]
}
```

### `POST /customer/addresses`

```jsonc
{
  "label": "HOME", "address": "12 Sevoke Road, Siliguri",
  "lat": 26.7271, "lng": 88.3953,
  "is_default": true, "is_preferred_pickup": true
}
```

**201**

```jsonc
{ "id": "…", "label": "HOME", "address": "12 Sevoke Road, Siliguri",
  "is_default": true, "is_preferred_pickup": true }
```

`is_default` and `is_preferred_pickup` are independent flags. `is_default` is what the address
book shows first; `is_preferred_pickup` is what prefills the quote flow's pickup point. A
customer can default to their office address but still prefer pickup from home.

### `POST /customer/vehicles`

```jsonc
{ "category": "SEDAN", "plate_number": "WB74AB1234", "fuel_type": "PETROL", "is_default": true }
```

**201**

```jsonc
{ "id": "…", "category": "SEDAN", "plate_number": "WB74AB1234",
  "fuel_type": "PETROL", "is_default": true }
```

This is the customer's **own car** — the driver drives the customer's vehicle, not one the
driver supplies (`12-open-questions.md` Q5). `category` is a free-text `CarCategory.code`
rather than a hard reference: a customer describes their car before any admin has to agree it
matches a category, and pricing keys off the booking's own `car_category_id`, never off this
field directly.

---

## Driver

| Method | Path | Notes |
|---|---|---|
| `POST` | `/driver/auth/otp/send` | See §OTP |
| `POST` | `/driver/auth/otp/verify` | See §OTP — same shape as customer, `is_new_user` included |
| `POST` | `/driver/auth/refresh` | See §Token lifecycle |
| `POST` | `/driver/auth/logout` | |
| `GET` | `/driver/profile` | Personal info, contact, address, terrain capability, vehicle preferences |
| `PATCH` | `/driver/profile` | |
| `GET` | `/driver/documents` | License, ID proof, RC, insurance — status per document |
| `POST` | `/driver/documents` | Requests a presigned upload URL, records the document `PENDING` |
| `POST` | `/driver/onboarding/submit` | Signals "review me" — see §Driver onboarding & verification |

### `PATCH /driver/profile`

```jsonc
{
  "full_name": "Bimal Rai", "dob": "1988-07-04", "gender": "MALE", "experience_years": 6,
  "address": "Matigara, Siliguri",
  "vehicle_type_preference": "MANUAL",
  "vehicle_category_preference": ["SEDAN", "SUV"],
  "can_drive_hill": true
}
```

**200**

```jsonc
{
  "id": "…", "full_name": "Bimal Rai", "mobile_number": "+919800011122",
  "can_drive_hill": true, "can_drive_hill_verified": false,
  "vehicle_type_preference": "MANUAL", "vehicle_category_preference": ["SEDAN", "SUV"]
}
```

`vehicle_category_preference` is what this driver is **competent to drive**, not what they own —
it feeds matching against the *customer's* vehicle (`12-open-questions.md` Q5).

`can_drive_hill` is self-declared, settable any time through this endpoint — not just at
onboarding — and gates nothing by itself. `can_drive_hill_verified` is set only by an admin
(`POST /admin/drivers/:id/hill-capability` below) and is the **only** field the dispatch
eligibility query reads (`06-dispatch-and-assignment.md` §Eligibility) — hill driving is a
safety matter, not a self-certification (decision log, 2026-08-24).

Setting `can_drive_hill: false` here — the driver withdrawing their claim — resets
`can_drive_hill_verified` to `false` in the same write. A driver who un-declares stops being
hill-eligible immediately rather than staying eligible on a stale approval until an admin
happens to notice.

### `POST /driver/documents`

```jsonc
{ "doc_type": "LICENCE" }
```

**200**

```jsonc
{ "document_id": "…", "upload_url": "https://…", "expires_in_seconds": 300 }
```

Two-step upload: this returns a presigned URL — 5-minute expiry, matching `09-architecture.md`'s
private-bucket policy — and the client `PUT`s the file directly to storage, never through this
API. The row starts `PENDING`; only an admin verification action moves it to
`VERIFIED`/`REJECTED` (`08-api-contracts.md` §Admin, `CRUD /admin/drivers`).

### Driver onboarding & verification

Unlike customer, a driver's profile is **not** progressive — see the decision log, 2026-08-24,
for why the two roles deliberately diverge. `onboardingStatus` on the driver record
(`03-database-schema.md`) moves through:

```
INCOMPLETE ──submit──► SUBMITTED ──approve──► APPROVED
                            │
                            └──reject──► REJECTED ──(edit + resubmit)──► SUBMITTED
```

`POST /driver/duty { "on_duty": true }` (`08-api-contracts.md`) 409s unless the driver has
reached `APPROVED` — the same `isVerified` flag the dispatch-eligibility query already reads.

#### `POST /driver/onboarding/submit`

No body. Validates that `full_name`, `dob`, `gender` and `address` are all set, and that a
`LICENCE` and an `AADHAAR` row both exist in `driverDocuments` (presence, not verification
status — an admin verifies content next). This exact required-field list is a judgment call,
flagged rather than silently assumed; adjust if the real onboarding form differs.

**200**

```jsonc
{ "onboarding_status": "SUBMITTED" }
```

**400 — incomplete**

```jsonc
{ "error": { "code": "VALIDATION_FAILED", "message": "Your profile isn't complete yet.",
    "data": { "missing": ["dob", "documents.AADHAAR"] }, "request_id": "req_01J…" } }
```

`missing` is specific enough for the app to deep-link straight to the unfinished field or
document, rather than dumping the driver back at a generic "complete your profile" screen.

---

## Admin

| Method | Path | Notes |
|---|---|---|
| `POST` | `/admin/auth/otp/send` | See §OTP — fails identically for an unprovisioned number as for a wrong code |
| `POST` | `/admin/auth/otp/verify` | See §OTP — never creates an account |
| `POST` | `/admin/auth/refresh` | Cookie-based, no body |
| `POST` | `/admin/auth/logout` | Clears the cookie |
| `GET` | `/admin/profile` | |
| `PATCH` | `/admin/profile` | `full_name` only — `mobile_number` is not self-service editable |
| `POST` | `/admin/drivers/:id/approve` | See §Driver verification below |
| `POST` | `/admin/drivers/:id/reject` | `{ reason }` |
| `PATCH` | `/admin/drivers/:id/documents/:doc_id` | `{ status, reason? }` — per-document verify/reject |
| `POST` | `/admin/drivers/:id/hill-capability` | `{ verified, reason? }` — see §Driver verification below |

**No admin registration endpoint exists anywhere in this API.** An `AdminUser` document is
inserted by direct ops action, outside the HTTP surface entirely — matching "admin actions all
audited" (`09-architecture.md`), since the one action that *creates* admin access is
deliberately not something exposed to be automated or scripted against from outside.

`otp/send` looks up `mobile_number` against `AdminUser` first. If it isn't there, the response
is the *same shape* as an invalid code — see §Errors, `OTP_INVALID_OR_EXPIRED` — so a prober
outside the system cannot distinguish "not an admin number" from "wrong code" from "expired
challenge". A provisioned-but-never-logged-in admin can request and verify an OTP completely
normally; what's disabled is the auth flow ever *creating* the document.

### Driver verification

This is where `08-api-contracts.md`'s `CRUD /admin/drivers | + document verification` line
gets its actual shape. `08-api-contracts.md` owns the general driver-fleet CRUD; the three
endpoints below are specifically the identity-verification action, which is why they live in
this doc rather than that one.

#### `POST /admin/drivers/:id/approve`

No body. Sets `onboardingStatus: APPROVED`, `isVerified: true`, `verifiedBy` (the calling
admin), `verifiedAt`. This is the one action that flips both fields together — see
`03-database-schema.md` for why they're kept in sync by one write rather than left as two
independently-driftable flags.

**200**

```jsonc
{ "onboarding_status": "APPROVED", "is_verified": true }
```

#### `POST /admin/drivers/:id/reject`

```jsonc
{ "reason": "License photo is unreadable — please re-upload." }
```

**200**

```jsonc
{ "onboarding_status": "REJECTED" }
```

Sets `isVerified: false` and stores `reason` so the driver app can surface exactly what to fix.
A rejected driver can edit their profile/documents and call `POST /driver/onboarding/submit`
again — rejection is not terminal.

#### `PATCH /admin/drivers/:id/documents/:doc_id`

```jsonc
{ "status": "REJECTED", "reason": "Expired at time of submission." }
```

**200**

```jsonc
{ "document_id": "…", "status": "REJECTED" }
```

Per-document, independent of the overall `onboarding/approve` action — a driver can have three
verified documents and one rejected one, and the app should say which.

#### `POST /admin/drivers/:id/hill-capability`

```jsonc
{ "verified": true }
```

```jsonc
{ "verified": false, "reason": "No hill-route experience on record; declined for now." }
```

**200**

```jsonc
{ "can_drive_hill_verified": true, "hill_capability_verified_by": "…", "hill_capability_verified_at": "…" }
```

Independent of `onboarding/approve` — a driver can be `APPROVED` and on duty for plains trips
long before (or without ever) requesting hill capability, and can request it at any point after
onboarding, not only during it. Rejects with `409` if the driver hasn't self-declared
`can_drive_hill: true` — there is nothing to verify against. `reason` is required when
`verified: false` and is surfaced to the driver the same way a document rejection is; not stored
when `verified: true`.

---

## Module contract

`identity`'s public surface (`identity.public.ts`) splits by consumer, per
`docs/engineering/03-module-anatomy.md` — the read-side profile contract used by this module's
own controllers is not the same interface `bookings` gets:

```ts
// identity.public.ts — new export, for the bookings module (tier 6) to consume.
// identity sits at tier 1, so this import is tier-legal with no dependency-cruiser exception.
export interface CustomerBookingProfileContract {
  /** Called when POST /bookings carries save_vehicle: true. */
  upsertVehicleFromBooking(customerId: string, vehicle: VehicleInput): Promise<string>;
  /** Called when POST /bookings carries save_pickup_address. */
  upsertAddressFromBooking(customerId: string, address: AddressInput): Promise<string>;
}
```

This is a contract-shape decision recorded now, ahead of `bookings` actually being built, so
nobody has to invent an ad hoc way to reach into `identity` for this later. See
`08-api-contracts.md`'s `POST /bookings` for the wire fields that trigger it
(`save_pickup_address`, `save_vehicle`) and the decision log, 2026-08-24, for why this exists at
all — it's the mechanism behind customer's progressive profile completion (§Customer above).

---

## Assumptions carried into this design

- **"Same address"** in the original brief is implemented as `is_default` on a saved address —
  distinct from `is_preferred_pickup`. Flagged explicitly rather than guessed silently; revisit
  if the intended meaning was something else (e.g. "same as the last trip's pickup").
- **Phone number recycling** — Indian telcos reassign a number after roughly 90 days idle — is
  an accepted, industry-standard risk across all three roles. No mitigation beyond what's
  already here (OTP + rate limits, and the provisioning gate for admin specifically).
