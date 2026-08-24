# User

`https://api.driverzone.in/v1` — same base as [`api-contracts.md`](api-contracts.md).

Profiles, saved addresses and vehicles, driver onboarding, and admin verification of drivers.
Everything here is behind a bearer token — how a caller gets one is [`auth.md`](auth.md).

- JSON only, `snake_case` keys, same wire conventions as [`api-contracts.md`](api-contracts.md).
- Every endpoint requires `Authorization: Bearer <jwt>` whose `aud` matches the role in the
  path. A customer token on a driver route is `403 FORBIDDEN`.
- Customer and driver endpoints act on the **authenticated subject only** — no customer id
  appears in any path, so a caller has no way to name anyone but themselves. The admin
  endpoints are the exception, and take the driver they act on in the path.
- **This doc is API surface only.** Frontend/UI flow is a later addition.

---
## Customer

| Method | Path | Notes |
|---|---|---|
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
driver supplies (`open-questions.md` Q5). `category` is a free-text `CarCategory.code`
rather than a hard reference: a customer describes their car before any admin has to agree it
matches a category, and pricing keys off the booking's own `car_category_id`, never off this
field directly.

---

## Driver

| Method | Path | Notes |
|---|---|---|
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
  "vehicle_category_preference": ["SEDAN", "SUV"]
}
```

**200**

```jsonc
{
  "id": "…", "full_name": "Bimal Rai", "mobile_number": "+919800011122",
  "can_drive_hill": false, "can_drive_hill_verified": false,
  "vehicle_type_preference": "MANUAL", "vehicle_category_preference": ["SEDAN", "SUV"]
}
```

`vehicle_category_preference` is what this driver is **competent to drive**, not what they own —
it feeds matching against the *customer's* vehicle (`open-questions.md` Q5).
`can_drive_hill` is self-declared at signup and gates nothing by itself;
`can_drive_hill_verified` is set only by an admin and is what actual hill dispatch checks — hill
driving is a safety matter, not a self-certification (`open-questions.md` Q6).

### `POST /driver/documents`

```jsonc
{ "doc_type": "LICENCE" }
```

**200**

```jsonc
{ "document_id": "…", "upload_url": "https://…", "expires_in_seconds": 300 }
```

Two-step upload: this returns a presigned URL — 5-minute expiry, matching `architecture.md`'s
private-bucket policy — and the client `PUT`s the file directly to storage, never through this
API. The row starts `PENDING`; only an admin verification action moves it to
`VERIFIED`/`REJECTED` (`api-contracts.md` §Admin, `CRUD /admin/drivers`).

The row is created **before** the file exists, holding the storage key the client is about to
upload to. That ordering is what makes the flow recoverable: an upload that fails or an app
killed mid-transfer leaves a `PENDING` document the driver can retry, rather than no record that
they ever tried. The cost, accepted: a row can reference an object that was never uploaded, and
an admin reviewing an empty document rejects it — which is the correct outcome and needs no
extra machinery.

> **No object storage exists yet.** `architecture.md` specifies an S3-compatible private
> bucket; nothing in the repo or the compose stack provides one. `StubDocumentStorage` stands in
> for local development — it mints a plausible key and a URL that accepts nothing, so the whole
> onboarding flow is exercisable end to end — and **refuses to run in production**, so a deploy
> cannot silently accept uploads into nowhere. Swapping in the real adapter is one line in
> `identity.container.ts`.

### Driver onboarding & verification

Unlike customer, a driver's profile is **not** progressive — see the decision log, 2026-08-24,
for why the two roles deliberately diverge. `onboardingStatus` on the driver record
(`database-schema.md`) moves through:

```
INCOMPLETE ──submit──► SUBMITTED ──approve──► APPROVED
                            │
                            └──reject──► REJECTED ──(edit + resubmit)──► SUBMITTED
```

`POST /driver/duty { "on_duty": true }` (`api-contracts.md`) 409s unless the driver has
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
| `GET` | `/admin/profile` | |
| `PATCH` | `/admin/profile` | `full_name` only — `mobile_number` is not self-service editable |
| `POST` | `/admin/drivers/:id/approve` | See §Driver verification below |
| `POST` | `/admin/drivers/:id/reject` | `{ reason }` |
| `PATCH` | `/admin/drivers/:id/documents/:doc_id` | `{ status, reason? }` — per-document verify/reject |

Admin accounts are never created through this API — see
[`auth.md` §Admin provisioning](auth.md#admin-provisioning). There is deliberately no
finer-grained permission model yet: v1 has a single flat admin role. `admin-panel.md` sketches
an `OPS_ADMIN` scope, which is its own decision rather than something invented here.

### Driver verification

This is where `api-contracts.md`'s `CRUD /admin/drivers | + document verification` line
gets its actual shape. `api-contracts.md` owns the general driver-fleet CRUD; the three
endpoints below are specifically the identity-verification action, which is why they live in
this doc rather than that one.

#### `POST /admin/drivers/:id/approve`

No body. Sets `onboardingStatus: APPROVED`, `isVerified: true`, `verifiedBy` (the calling
admin), `verifiedAt`. This is the one action that flips both fields together — see
`database-schema.md` for why they're kept in sync by one write rather than left as two
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

`reason` is **required when rejecting** and is stored on the document as `rejectionReason`. A
driver told only "rejected" has nothing to act on and re-uploads the same unreadable photo.

**200**

```jsonc
{ "document_id": "…", "status": "REJECTED" }
```

Per-document, independent of the overall `onboarding/approve` action — a driver can have three
verified documents and one rejected one, and the app should say which.

---

## Module contract

`identity`'s public surface (`identity.public.ts`) splits by consumer, per
`docs/engineering/module-anatomy.md` — the read-side profile contract used by this module's
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
`api-contracts.md`'s `POST /bookings` for the wire fields that trigger it
(`save_pickup_address`, `save_vehicle`) and the decision log, 2026-08-24, for why this exists at
all — it's the mechanism behind customer's progressive profile completion (§Customer above).

---

## Assumptions carried into this design

- **"Same address"** in the original brief is implemented as `is_default` on a saved address —
  distinct from `is_preferred_pickup`. Flagged explicitly rather than guessed silently; revisit
  if the intended meaning was something else (e.g. "same as the last trip's pickup").
