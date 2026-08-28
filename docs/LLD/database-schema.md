# Database Schema (MongoDB 7 + Mongoose 8)

> **Requires a replica set**, even single-node. Multi-document transactions need one, and the
> booking→ledger write uses one. Both compose files handle the init; without it Mongo starts
> and refuses every write with `not primary`.

## Conventions

- **Money** is an integer number of paise. `₹1,499.50` is `149950`. Safe well past 2^53.
  **One exception: `globalSettings` stores money in WHOLE RUPEES.** Those values are ops-facing
  round figures typed into an admin form, and a paise field there is bad UX. The exception is
  contained by an opaque `Rupees` type
  (`apps/api/src/modules/settings/domain/money.ts`) — settings money comes out of
  `SettingsReadContract` as a `Rupees`, which cannot be added to a `*Paise` number without going
  through `rupeesToPaise()`, so the 100× undercharge this would otherwise invite is a compile
  error rather than a plausible-looking receipt.
- **Percentages** are basis points: `2500` = 25%.
- **Geometry** is GeoJSON, so coordinates are `[lng, lat]` — the reverse of how humans write
  them. Conversion happens only in `@driverzone/geo`; see
  [`engineering/05`](../engineering/coding-standards.md#coordinates).
- **Enums** are string unions validated by Zod at the boundary and constrained by `enum:` in the
  schema.
- Every collection carries `createdAt`/`updatedAt` via `{ timestamps: true }`.

## Where the invariants live

Under PostGIS, the zone invariants were database triggers — a bad polygon was impossible to
save from any code path. **MongoDB cannot express a cross-document geometric constraint**, so
they moved to application code.

| Invariant | Was | Is now |
|---|---|---|
| Z-2 no same-type overlap | `ST_Overlaps` trigger | `@driverzone/geo` `checkOverlap`, in `createZone.usecase.ts` |
| Z-3 valid geometry | `ST_IsValid` CHECK | `checkValidity` (Turf `kinks` + ring closure) |
| Z-MIN-AREA | `ST_Area` CHECK | `checkMinimumArea` |
| Z-MAX-AREA | `ST_Area` CHECK | `checkMaximumArea` — **to add in Phase 1**; see `zones.md` on hemisphere polygons |
| Fare snapshot immutable | `BEFORE UPDATE` trigger | Mongoose `immutable: true` |
| `booking_events` append-only | `REVOKE UPDATE, DELETE` | MongoDB role with `insert`+`find` only |

This is a **weaker guarantee** than a trigger, and it is held up by two things:

1. The `zones` module is the only code that can write a zone, enforced by
   `module-internals-are-private` in `.dependency-cruiser.cjs`. See
   [`engineering/04`](../engineering/boundaries-and-enforcement.md).
2. A **nightly integrity job** re-checks every zone and alerts on drift.

Do not add a second write path to `zones`. That is the whole guarantee.

---

## `zones`

```ts
const zoneSchema = new Schema({
  type:  { type: String, enum: ['CITY', 'PICKUP', 'HILL'], required: true },
  name:  { type: String, required: true },
  code:  { type: String, required: true },          // 'SLG', 'SLG-CENTRAL'

  // Retained, always null. Invariant Z-1 was retired 2026-08-25 — pickup zones are a
  // serviceability gate, not a sub-area of a city (zones.md). Kept because
  // `checkWithinParent` still exists in @driverzone/geo and a future nested-zone design
  // would switch it back on rather than re-add a field.
  parentZoneId: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },

  geometry: {
    type: { type: String, enum: ['Polygon'], required: true },
    coordinates: { type: [[[Number]]], required: true },   // [ring][point][lng,lat]
  },

  priority: { type: Number, default: 0 },           // tiebreak; higher wins

  // PICKUP only
  pickupChargeType:  { type: String, enum: ['FREE', 'PAID'] },
  pickupChargePaise: { type: Number, default: null }, // null → global default

  version:      { type: Number, default: 1 },
  supersededBy: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },
  isActive:     { type: Boolean, default: true },
  createdBy:    { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
}, { timestamps: true });

// THE index the whole product depends on. Without it, zone resolution is a collection scan on
// every quote request.
zoneSchema.index({ geometry: '2dsphere' });
zoneSchema.index({ type: 1, isActive: 1 });
zoneSchema.index({ supersededBy: 1 });                 // version history
zoneSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
```

The partial unique index on `code` matters: superseded versions accumulate and must not block a
new version reusing the code.

### What MongoDB does validate

A `2dsphere` index rejects some malformed polygons on insert — unclosed rings, and certain
self-intersections. **Do not rely on it.** Its coverage is narrower than `ST_IsValid` and the
error messages are unhelpful. `checkValidity` runs first and produces a message an admin can
act on.

### Schema-level guards

```ts
zoneSchema.pre('validate', function (next) {
  if (this.type === 'PICKUP' && !this.pickupChargeType) {
    return next(new Error('A PICKUP zone requires a charge type'));
  }
  if (this.parentZoneId) {
    return next(new Error('Zones have no parent — invariant Z-1 was retired'));
  }
  next();
});
```

These are the checks a single document can make. The geometric ones need siblings, so they live
in the use case.

### Ring orientation is normalised before save

`@turf/rewind` runs in the write path, before validation, so every stored exterior ring is
counter-clockwise. This is not tidiness: the `2dsphere` index reads winding to decide which side
of a ring is "inside", and a clockwise exterior ring on a large polygon is interpreted as the
whole earth *minus* that shape — silently, with no error. See `zones.md` §Why MongoDB geo.

---

## `carCategories`

**Not implemented, and not a pricing dimension.** No package references a category any more
(retired 2026-08-28, [`../decision-log.md`](../decision-log.md)); what a category still decides
is *who can drive* — dispatch matches a driver's competencies against the booking's category.
The list currently lives as a closed constant, `CAR_CATEGORIES` in
`packages/contracts/src/identity.ts`, because five rows that change once a year are not a
collection anyone wants to administer. The schema below is what it becomes when that stops being
true.

```ts
const carCategorySchema = new Schema({
  code:      { type: String, required: true, unique: true },  // 'SEDAN'
  name:      { type: String, required: true },
  sortOrder: { type: Number, default: 0 },
  iconUrl:   String,
  isActive:  { type: Boolean, default: true },
});
```

---

## `incityPackages`

Variants are embedded rather than referenced. They are always read with their package, never
queried independently, and the whole document is well under a kilobyte. Embedding makes a quote
one read instead of two.

**There is no `incityPriceSchema`.** A variant used to hold a price row per car category; that
was retired 2026-08-28 ([`../decision-log.md`](../decision-log.md)) and the fare moved onto the
variant itself.

```ts
const incityVariantSchema = new Schema({
  label:           { type: String, required: true },    // '3 Hours'
  includedMinutes: { type: Number, required: true, min: 1 },
  includedKm:      { type: Number, required: true, min: 0 },

  baseFarePaise:        { type: Number, required: true, min: 0 },
  extraMinuteRatePaise: { type: Number, default: 0, min: 0 },
  extraKmRatePaise:     { type: Number, default: 0, min: 0 },

  // Basis points: 7500 is 75%. The COMPANY's share is `10000 - this` and is not stored —
  // two independently stored shares are two numbers that can fail to add up.
  driverCommissionBps: { type: Number, required: true, min: 0, max: 10000 },

  // No nightChargePaise: the early-morning and late-night surcharges are GLOBAL, set once in
  // globalSettings rather than per package (decision-log.md, 2026-08-28).

  // See open-questions.md Q1. Defaults from duration: a 10-hour rental's destination is
  // advisory, a 3-hour one's is not.
  enforceDropInCity: { type: Boolean, default: true },

  sortOrder: { type: Number, default: 0 },
  isActive:  { type: Boolean, default: true },
}, { _id: true });

const incityPackageSchema = new Schema({
  // The only zone reference any package carries. Pickup zones are not referenced by
  // packages at all — they gate serviceability and carry a fee, nothing more (zones.md).
  cityZoneId:    { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
  name:          { type: String, required: true },
  description:   String,
  variants:      [incityVariantSchema],
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

// The package-matching query in docs/LLD/zone-resolution.md.
incityPackageSchema.index({ cityZoneId: 1, isActive: 1 });
```

**Invariant P-1 was retired 2026-08-25**, along with the package ↔ pickup-zone link it enforced.
There is no cross-collection check left on this schema: matching an incity package is a lookup on
`cityZoneId` alone.

---

## `outstationPackages`

**The band IS the price.** There was an `outstationPriceSchema` here keyed by
`(carCategory, direction)` — ten rows per band — retired 2026-08-28
([`../decision-log.md`](../decision-log.md)). Two fares and a commission split remain, and the
fare is **flat across the band**: 72 km and 98 km both pay the `70–100` fare. That closes
`open-questions.md` Q3, whose warning still applies — flat pricing needs many narrow bands.

```ts
const outstationPackageSchema = new Schema({
  name:    { type: String, required: true },       // 'PKG-1'
  terrain: { type: String, enum: ['PLAIN', 'HILL'], required: true },
  minKm:   { type: Number, required: true, min: 0 },
  maxKm:   { type: Number, required: true },       // band is [minKm, maxKm)

  oneWayFarePaise: { type: Number, required: true, min: 0 },
  // `null` means this band does not sell a same-day return. `default: null`, never `default: 0`
  // — a missing fare and a free trip must not look the same.
  roundTripFarePaise: { type: Number, default: null, min: 0 },

  driverCommissionBps: { type: Number, required: true, min: 0, max: 10000 },

  isActive: { type: Boolean, default: true },
}, { timestamps: true });

outstationPackageSchema.index({ terrain: 1, minKm: 1, maxKm: 1, isActive: 1 });
```

An outstation package references no zone at all. Terrain comes from the route, the band from the
distance, and whether we serve the pickup point was already settled by the pickup-zone gate.

Bands are **half-open** `[minKm, maxKm)`, so adjacent bands (0–70, 70–100, 100–150) tile with no
gap and no overlap at the boundary.

**Invariant P-2** — for a given terrain, bands must not overlap. Two matches means an ambiguous
price. The check widened when the pickup-zone qualifier went: it is now global per terrain, which
is both cheaper to run and stricter than what it replaced.

```ts
const conflict = await OutstationPackage.findOne({
  _id: { $ne: candidateId },
  isActive: true,
  terrain,
  minKm: { $lt: maxKm },
  maxKm: { $gt: minKm },        // half-open overlap test
});
```

---

## `coverageRequests` / `unservedDistanceRequests`

Two collections that cost almost nothing and are worth a great deal. Every lookup that failed for
want of coverage is a demand signal, and clustering them gives ops a ranked list of exactly where
to draw the next zone or band — and who to notify when they do.

```ts
const coverageRequestSchema = new Schema({
  point:   { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
  address: String,
  customerId:  { type: Schema.Types.ObjectId, ref: 'Customer' },
  serviceType: { type: String, enum: ['INCITY', 'OUTSTATION'], required: true },
  notifyWhenAvailable: { type: Boolean, default: false },
}, { timestamps: { createdAt: true, updatedAt: false } });

coverageRequestSchema.index({ point: '2dsphere' });

const unservedDistanceRequestSchema = new Schema({
  pickupZoneId: { type: Schema.Types.ObjectId, ref: 'Zone' },
  distanceKm:   { type: Number, required: true },
  terrain:      { type: String, enum: ['PLAIN', 'HILL'], required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
```

The `2dsphere` index on `coverageRequests.point` is what makes the expansion heatmap a `$geoNear`
aggregation rather than a full scan.

Both are written **only** through `ZoneResolutionContract` (`zones.md`), and only when a lookup
genuinely resolved to nothing. A row logged on a validation error or a client retry pollutes the
signal, which is why the contract carries that obligation in its doc comment rather than leaving
it to each caller.

---

## `customers`

```ts
const customerSchema = new Schema({
  phone: { type: String, required: true, unique: true },   // primary identity, the OTP target

  // Set to null by otp/verify on a first-ever login; filled in by the client's onboarding
  // screens afterward. There is no separate registration endpoint — see user.md.
  fullName: String,
  dob:      Date,
  gender:   { type: String, enum: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] },
  languagesKnown: [String],

  alternatePhone:   String,
  emergencyContact: { name: String, phone: String },

  savedAddresses: [{
    label:             { type: String, enum: ['HOME', 'OFFICE', 'OTHER'], required: true },
    address:           { type: String, required: true },
    point:             { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
    isDefault:         { type: Boolean, default: false },   // shown first in the address book
    isPreferredPickup: { type: Boolean, default: false },   // prefills the quote flow's pickup
  }],

  // The CUSTOMER's own car — the driver drives it, they don't supply one (open-questions.md
  // Q5). `category` is a free string, not a CarCategory ref: a customer describes their car
  // before any admin has to agree it matches one, and pricing keys off the booking's own
  // carCategoryId, never off this field.
  vehicles: [{
    category:    { type: String, required: true },
    plateNumber: { type: String, required: true },
    fuelType:    { type: String, enum: ['PETROL', 'DIESEL', 'EV', 'CNG'] },
    isDefault:   { type: Boolean, default: false },
  }],

  isBlocked: { type: Boolean, default: false },
}, { timestamps: true });

customerSchema.index({ phone: 1 }, { unique: true });
```

---

## `adminUsers`

```ts
const adminUserSchema = new Schema({
  phone:    { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

adminUserSchema.index({ phone: 1 }, { unique: true });
```

No password, no TOTP secret — admin authenticates with phone + OTP like every other role
(decision log, 2026-08-24). **Deliberately no self-service creation path.** A document here is
inserted by direct ops action, outside the HTTP surface; `otp/send`/`otp/verify` for an
unprovisioned number fail the same way an invalid code would, rather than creating one — see
`auth.md` §Admin provisioning.

---

## `sessions`

```ts
const sessionSchema = new Schema({
  // Polymorphic by design: resolved via `role` against the matching collection in application
  // code, not a Mongoose ref — a session's owner is one of three different collections.
  userId: { type: Schema.Types.ObjectId, required: true },
  role:   { type: String, enum: ['CUSTOMER', 'DRIVER', 'ADMIN'], required: true },

  tokenHash:  { type: String, required: true },   // sha256 of the current refresh JWT
  familyId:   { type: String, required: true },   // shared across a full rotation chain
  usedAt:     Date,                                // set the instant this token is redeemed
  replacedBy: { type: Schema.Types.ObjectId, ref: 'Session', default: null },
  revokedAt:  Date,

  createdIp:        String,
  createdUserAgent: String,
}, { timestamps: true });

sessionSchema.index({ userId: 1, role: 1 });
sessionSchema.index({ familyId: 1 });
// A session outlives its own refresh token's max TTL (30d customer/driver, 12h admin) by a
// day, so a client retrying slightly past expiry gets a clean "log in again" rather than a
// dangling row with nothing left to look up.
sessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 31 });
```

**Rotation + reuse detection**, the reason this collection exists at all: refreshing marks the
presented token's row `usedAt` and inserts a new row in the same `familyId`. A refresh call
presenting a token whose row already has `usedAt` set is a replay — the signature of a stolen
token racing the legitimate client — and revokes every row in that `familyId`, not just the one
being replayed (decision log, 2026-08-24).

OTP challenges are **not** in this collection, or in Mongo at all — they're ephemeral, Redis
TTL-native, and never need a rotation history. See `auth.md` §OTP.

---

## `quotes`

```ts
const quoteSchema = new Schema({
  customerId:  { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  serviceType: { type: String, enum: ['INCITY', 'OUTSTATION'], required: true },

  pickupPoint:    { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
  dropPoint:      { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
  pickupAddress:  { type: String, required: true },
  dropAddress:    String,

  // Resolution result, frozen — so history survives a later zone edit.
  pickupZoneId:  { type: Schema.Types.ObjectId, ref: 'Zone' },
  cityZoneId:    { type: Schema.Types.ObjectId, ref: 'Zone' },
  terrain:       { type: String, enum: ['PLAIN', 'HILL'] },
  roadDistanceM: Number,
  routePolyline: String,

  packageId:     { type: Schema.Types.ObjectId, required: true },
  variantId:     Schema.Types.ObjectId,
  carCategoryId: { type: Schema.Types.ObjectId, ref: 'CarCategory', required: true },
  direction:     { type: String, enum: ['ONE_WAY', 'ROUND_TRIP'] },

  fareBreakdown: { type: Schema.Types.Mixed, required: true },
  totalPaise:    { type: Number, required: true },

  expiresAt:  { type: Date, required: true },
  consumedBy: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
}, { timestamps: true });

quoteSchema.index({ customerId: 1, createdAt: -1 });
// TTL cleanup. expireAfterSeconds: 0 means "delete when expiresAt passes" — but only for
// unconsumed quotes, since a consumed one is referenced by a booking.
quoteSchema.index({ expiresAt: 1 }, {
  expireAfterSeconds: 0,
  partialFilterExpression: { consumedBy: null },
});
```

`consumedBy` doubles as the idempotency guard: a double-tapped Confirm returns the existing
booking instead of creating a second one.

---

## `bookings`

```ts
const bookingSchema = new Schema({
  reference:  { type: String, required: true, unique: true },   // 'DZ-8F3K2M'
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  driverId:   { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
  quoteId:    { type: Schema.Types.ObjectId, ref: 'Quote', required: true },

  status: {
    type: String,
    required: true,
    default: 'CONFIRMED',
    enum: ['DRAFT','QUOTED','CONFIRMED','SEARCHING','ASSIGNED','DRIVER_EN_ROUTE',
           'ARRIVED','STARTED','COMPLETED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_DRIVER',
           'CANCELLED_BY_ADMIN','NO_DRIVER_FOUND','EXPIRED'],
  },

  serviceType:   { type: String, enum: ['INCITY', 'OUTSTATION'], required: true },
  pickupPoint:   { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
  dropPoint:     { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
  pickupAddress: { type: String, required: true },
  dropAddress:   String,

  // Copied from the quote, not referenced — a zone edit must not rewrite history.
  pickupZoneId: { type: Schema.Types.ObjectId, ref: 'Zone' },
  cityZoneId:   { type: Schema.Types.ObjectId, ref: 'Zone' },
  terrain:      { type: String, enum: ['PLAIN', 'HILL'] },

  carCategoryId:    { type: Schema.Types.ObjectId, ref: 'CarCategory', required: true },
  customerCarPlate: String,

  scheduledAt: { type: Date, required: true },
  isScheduled: { type: Boolean, default: false },
  dispatchAt:  { type: Date, required: true },

  // IMMUTABLE. Fare corrections are adjustment documents, never edits to this.
  fareSnapshot:     { type: Schema.Types.Mixed, required: true, immutable: true },
  quotedTotalPaise: { type: Number, required: true, immutable: true },
  finalTotalPaise:  Number,                       // set at completion, incl. overage

  startOtp:    { type: String, required: true, select: false },
  assignedAt:  Date,
  arrivedAt:   Date,
  startedAt:   Date,
  completedAt: Date,
  cancelledAt: Date,
  cancellationReason: String,

  actualMinutes:   Number,
  actualDistanceM: Number,
}, { timestamps: true });

bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ driverId: 1, scheduledAt: -1 });
bookingSchema.index({ reference: 1 }, { unique: true });
bookingSchema.index({ pickupPoint: '2dsphere' });

// The dispatcher's sweeper query. Partial, because only CONFIRMED bookings are ever swept.
bookingSchema.index({ dispatchAt: 1 }, { partialFilterExpression: { status: 'CONFIRMED' } });

// The ops "in flight" view.
bookingSchema.index({ status: 1, scheduledAt: 1 });
```

Two details:

**`immutable: true` on `fareSnapshot`** is Mongoose's replacement for the PostGIS `BEFORE
UPDATE` trigger. It silently ignores writes on an existing document rather than throwing, so
pair it with a code review rule: fare corrections are `fareAdjustments` documents.

**`select: false` on `startOtp`** keeps the OTP out of every incidental booking read. It has to
be requested explicitly, which means it cannot leak into an API response by accident.

---

## `bookingEvents` — append-only

```ts
const bookingEventSchema = new Schema({
  bookingId:  { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  fromStatus: String,
  toStatus:   { type: String, required: true },
  actorType:  { type: String, enum: ['CUSTOMER','DRIVER','ADMIN','SYSTEM'], required: true },
  actorId:    Schema.Types.ObjectId,
  reason:     String,
  metadata:   { type: Schema.Types.Mixed, default: {} },
}, { timestamps: { createdAt: true, updatedAt: false } });

bookingEventSchema.index({ bookingId: 1, createdAt: 1 });
```

The append-only property is enforced at the **database role**, not in application code:

```js
db.createRole({
  role: 'appUser',
  privileges: [
    { resource: { db: 'driverzone', collection: 'bookingEvents' },
      actions: ['find', 'insert'] },        // no update, no remove
  ],
  roles: [{ role: 'readWrite', db: 'driverzone' }],
});
```

This is the direct equivalent of `REVOKE UPDATE, DELETE`. When a customer disputes a fare six
weeks on, this collection is the only thing that settles it — so the application must not be
able to rewrite it, however convenient that might seem at the time.

---

## `dispatchOffers`

```ts
const dispatchOfferSchema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  driverId:  { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  wave:      { type: Number, required: true },
  status:    { type: String, required: true, default: 'SENT',
               enum: ['SENT','ACCEPTED','DECLINED','LAPSED','SUPERSEDED'] },

  distanceM: Number,          // driver → pickup at offer time
  score:     Number,          // the ranker's output, kept for tuning

  expiresAt:   { type: Date, required: true },
  respondedAt: Date,

  // An offer that lapsed but was never delivered is an INFRASTRUCTURE failure, not a driver
  // failure. It must not count against acceptance rate, and a rising NONE rate is the early
  // warning that push delivery is degrading.
  deliveredVia: { type: String, enum: ['SOCKET','FCM','BOTH','NONE'], default: 'NONE' },
  deliveredAt:  Date,
  seenAt:       Date,
}, { timestamps: true });

dispatchOfferSchema.index({ bookingId: 1, wave: 1 });
dispatchOfferSchema.index({ driverId: 1, status: 1 });
dispatchOfferSchema.index({ bookingId: 1, driverId: 1, wave: 1 }, { unique: true });
```

**Never delete these.** Every offer, including lapsed ones, is what makes driver acceptance-rate
scoring possible.

---

## `drivers`

```ts
const driverSchema = new Schema({
  phone: { type: String, required: true, unique: true },
  name:  { type: String, required: true },
  homeZoneId: { type: Schema.Types.ObjectId, ref: 'Zone' },

  carCategoryIds: [{ type: Schema.Types.ObjectId, ref: 'CarCategory' }],

  isVerified: { type: Boolean, default: false },
  isOnDuty:   { type: Boolean, default: false },
  isBlocked:  { type: Boolean, default: false },
  blockedReason: String,

  // A CACHE, flushed from Redis every ~30s. High-frequency GPS pings never write here —
  // 2,000 drivers pinging every 10s is ~200 writes/s and would starve booking queries.
  lastLocation:   { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
  lastLocationAt: Date,

  rating:         Number,
  acceptanceRate: Number,                        // rolling 30-day, recomputed nightly
  walletBalancePaise: { type: Number, default: 0 },   // negative = owes the company
  canDriveHill:   { type: Boolean, default: false },
  // Self-declared at onboarding. Gates nothing on its own — hill driving is a safety matter,
  // so actual hill dispatch checks this, not canDriveHill (open-questions.md Q6).
  canDriveHillVerified: { type: Boolean, default: false },

  // Identity/profile fields, added alongside the auth module (user.md).
  dob:    Date,
  gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] },
  experienceYears: Number,
  alternatePhone:   String,
  emergencyContact: { name: String, phone: String },
  address:          String,

  // What this driver is COMPETENT to drive, not what they own — the driver drives the
  // customer's car, never their own (open-questions.md Q5). Matched against
  // customers.vehicles[].category at dispatch time, not enforced here.
  vehicleTypePreference:     { type: String, enum: ['AUTO', 'MANUAL', 'EV'] },
  vehicleCategoryPreference: [String],   // CarCategory.code[]

  // Onboarding state machine — see user.md §Driver. `isVerified` above stays the
  // ONE field dispatch/duty actually gate on (it's already in the index below); this is the
  // richer status the app shows and the admin approve/reject action drives. One action
  // (approve) sets both isVerified and onboardingStatus together, so they never drift apart —
  // this is not a second, independent source of truth.
  onboardingStatus: { type: String, default: 'INCOMPLETE',
                       enum: ['INCOMPLETE', 'SUBMITTED', 'APPROVED', 'REJECTED'] },
  onboardingRejectionReason: String,
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
  verifiedAt: Date,
}, { timestamps: true });

driverSchema.index({ lastLocation: '2dsphere' });
driverSchema.index({ isOnDuty: 1, isVerified: 1, isBlocked: 1, carCategoryIds: 1 });
```

Note `carCategoryIds` is embedded rather than a join collection — a driver has a handful, and
the dispatch eligibility query needs it in the same document to stay a single index scan.

**Why `isVerified` survives instead of being replaced by `onboardingStatus`**: the dispatch
eligibility index above already reads `isVerified` directly, and it is a cheap boolean to
filter on. `onboardingStatus` carries the extra states (`SUBMITTED`, `REJECTED` with a reason)
that the driver app needs to render but that dispatch has no reason to know about — a rejected
driver and an incomplete one are the same "cannot go on duty" fact to the matching query, and
different facts to a driver reading why they're blocked.

**License number and expiry live in `driverDocuments` below, not here** — `docType: 'LICENCE'`
already carries `number` and (with the addition below) `issuedOn`/`expiresOn`. A second copy on
`driverSchema` would be two sources of truth for the same fact; the auth module reads the
license row from `driverDocuments` rather than duplicating it.

## `driverDocuments`

```ts
const driverDocumentSchema = new Schema({
  driverId:   { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  // 'LICENCE','AADHAAR','POLICE_VERIFICATION','VEHICLE_RC','INSURANCE'
  docType:    { type: String, required: true },
  status:     { type: String, default: 'PENDING', enum: ['PENDING', 'VERIFIED', 'REJECTED'] },
  // Why a rejected document says why: a driver told only "rejected" has nothing to act on and
  // re-uploads the same unreadable photo. Set by PATCH /admin/drivers/:id/documents/:doc_id.
  rejectionReason: String,
  fileUrl:    { type: String, required: true },
  number:     String,
  subType:    String,   // e.g. licence category LMV/LMV-TR when docType='LICENCE'
  issuedOn:   Date,
  expiresOn:  Date,
  verifiedAt: Date,
  verifiedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
}, { timestamps: true });

driverDocumentSchema.index({ driverId: 1, docType: 1 }, { unique: true });
driverDocumentSchema.index({ expiresOn: 1 });     // the expiry-warning job
```

---

## `driverEarnings` — the ledger

Build this in phase 1. Reconstructing months of financial history from booking documents is
genuinely miserable work.

```ts
const driverEarningSchema = new Schema({
  driverId:   { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  bookingId:  { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
  entryType:  { type: String, required: true,
                enum: ['TRIP_EARNING','COMMISSION_DEBIT','CASH_COLLECTED',
                       'PAYOUT','ADJUSTMENT','PENALTY','BONUS'] },
  amountPaise: { type: Number, required: true },   // signed: credit +, debit −
  description: { type: String, required: true },
  payoutId:    { type: Schema.Types.ObjectId, ref: 'Payout', default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

driverEarningSchema.index({ driverId: 1, createdAt: -1 });
driverEarningSchema.index({ driverId: 1, payoutId: 1 });

// THE idempotency guard. A retried "complete trip" handler cannot credit a driver twice.
driverEarningSchema.index(
  { bookingId: 1, entryType: 1 },
  { unique: true,
    partialFilterExpression: {
      bookingId: { $exists: true, $ne: null },
      entryType: { $in: ['TRIP_EARNING', 'COMMISSION_DEBIT'] },
    } },
);
```

`drivers.walletBalancePaise` is a **cache** of `sum(amountPaise)`. Recompute nightly and alert
on drift; never let it be the source of truth.

## `payouts`

```ts
const payoutSchema = new Schema({
  driverId:    { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  amountPaise: { type: Number, required: true },
  periodStart: { type: Date, required: true },
  periodEnd:   { type: Date, required: true },
  status: { type: String, default: 'PENDING', enum: ['PENDING','PROCESSING','PAID','FAILED'] },
  utr:         String,
  processedAt: Date,
}, { timestamps: true });
```

Creating a payout and stamping `payoutId` on its entries must happen **in one transaction** —
this is one of the two places the replica set requirement is not negotiable.

---

## `tripTraces`

```ts
const tripTraceSchema = new Schema({
  bookingId:  { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  path:       { type: { type: String, enum: ['LineString'] }, coordinates: [[Number]] },
  pointCount: { type: Number, required: true },
  recordedAt: { type: Date, required: true },
});

tripTraceSchema.index({ bookingId: 1, recordedAt: 1 });
// By far the largest collection, and its value decays fast. 12-month TTL.
tripTraceSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 365 });
```

Written in batches every 30s during `STARTED`, never per GPS ping.

---

## `globalSettings`

```ts
const globalSettingSchema = new Schema({
  key:       { type: String, required: true, unique: true },
  value:     { type: Schema.Types.Mixed, required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
}, { timestamps: true });
```

**A row exists only for an OVERRIDDEN key.** Defaults, validation rules, labels, units and
read-audiences all live in `apps/api/src/modules/settings/domain/setting.registry.ts` — in code,
under review — so this collection is empty on a fresh install and the API still answers with a
complete configuration. There is no seed script and there never needs to be a migration: seeding
would turn every default into a row that a later change to that default silently fails to reach.

`description` is deliberately not stored. It is documentation; it belongs with the code that
gives the key its meaning, and a copy in the database goes stale the first time the behaviour
changes.

Money here is **whole rupees**, not paise — see §Conventions.

### The keys

| key | unit | default | read by |
|---|---|---|---|
| `pickup.default_charge` | rupees | `100` | admin, customer |
| `pricing.early_morning_window` | HH:mm window | `04:00`–`06:00` | admin, customer |
| `pricing.early_morning_charge` | rupees | `100` | admin, customer |
| `pricing.late_night_window` | HH:mm window | `22:00`–`04:00` | admin, customer |
| `pricing.late_night_charge` | rupees | `150` | admin, customer |
| `pricing.insurance_charge` | rupees | `30` | admin, customer |
| `waiting.free_minutes` | minutes | `15` | admin, customer, driver |
| `waiting.charge_per_minute` | rupees | `2` | admin, customer |
| `waiting.max_charge` | rupees | `300` | admin, customer |
| `waiting.no_show_after_minutes` | minutes | `30` | admin, customer, driver |
| `driver.late_grace_minutes` | minutes | `10` | admin, driver |
| `driver.late_fine` | rupees | `50` | admin, driver |
| `dispatch.offer_ttl_seconds` | seconds | `45` | admin, driver |
| `cancellation.free_window_seconds` | seconds | `300` | admin, customer |
| `cancellation.scheduled_free_until_minutes_before` | minutes | `60` | admin, customer |
| `cancellation.customer_fee_en_route` | rupees | `50` | admin, customer |
| `cancellation.customer_fee_arrived` | rupees | `100` | admin, customer |
| `cancellation.driver_penalty_en_route` | rupees | `50` | admin, driver |
| `cancellation.driver_penalty_arrived` | rupees | `100` | admin, driver |

Each key declares which audiences may read it, which is what makes "never charge a fee the
customer hasn't seen" ([booking-lifecycle](booking-lifecycle.md)) mechanical rather than a
convention: `GET /api/customer/settings` and `GET /api/driver/settings` are filtered from that
field, not from a hand-maintained allowlist.

Still to come, and NOT yet defined — their consumers do not exist: `dispatch.wave_size`,
`dispatch.max_waves`, `dispatch.wave_radius_m`, `dispatch.scheduled_lead_minutes`,
`booking.quote_ttl_seconds`, `booking.overage_grace_minutes`, `booking.billing_block_minutes`,
`incity.max_distance_multiple`, `driver.max_negative_balance_paise`. A key is added when the code
that reads it is written, not before.

### Cross-key rules

Some constraints are about a PAIR of keys and cannot be seen from inside either one, so they are
checked against the configuration a write would PRODUCE — the patch merged over what is stored —
rather than against the patch. A write that fails any of them is refused whole (422,
`SETTING_INVARIANT_VIOLATED`), and so is a reset that would produce the same state:

- the early-morning and late-night windows must not overlap (either may wrap midnight);
- `waiting.no_show_after_minutes` > `waiting.free_minutes`, or waiting is never chargeable;
- neither cancellation ladder may step down — the arrived fee/penalty is never below the
  en-route one.

Read through a cached accessor with a 60s TTL, not on every request. The cache is per-process and
is cleared immediately by a write in that process, so an admin who saves and reloads sees the
change; the worker converges within the TTL. That lag is safe because a booking's fare is frozen
at confirmation (B-1), so a settings change mid-flight cannot alter a price a customer has
already been shown.

---

## `auditLog`

```ts
const auditLogSchema = new Schema({
  adminId:    { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
  entityType: { type: String, required: true },
  entityId:   { type: Schema.Types.ObjectId, required: true },
  // 'CREATE','UPDATE','DELETE','ACTIVATE','APPROVE','REJECT'
  // APPROVE/REJECT are not folded into UPDATE: "who approved this driver, and when" is the
  // question this collection exists to answer, and it must not require reading `after` to tell
  // an approval from an edit to a phone number.
  action:     { type: String, required: true },
  before:     Schema.Types.Mixed,
  after:      Schema.Types.Mixed,
  ip:         String,
}, { timestamps: { createdAt: true, updatedAt: false } });

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ adminId: 1, createdAt: -1 });
```

Zone geometry and every price field are audited. Combined with `fareSnapshot`, this answers
"the app quoted me ₹1,200 last Tuesday".

---

## Backups

- Managed automated backups with point-in-time recovery.
- **Nightly logical dump of `zones` and every package/price collection.** These are small,
  hand-authored and irreplaceable — a bad polygon edit at 2am should be a two-minute restore,
  not an archaeology project.
- Zone versioning (`supersededBy`) already gives in-app rollback; the dump is the backstop.
