# 03 — Database Schema (MongoDB 7 + Mongoose 8)

> **Requires a replica set**, even single-node. Multi-document transactions need one, and the
> booking→ledger write uses one. `docker-compose.yml` handles the init; without it Mongo starts
> and refuses every write with `not primary`.

## Conventions

- **Money** is an integer number of paise. `₹1,499.50` is `149950`. Safe well past 2^53.
- **Percentages** are basis points: `2500` = 25%.
- **Geometry** is GeoJSON, so coordinates are `[lng, lat]` — the reverse of how humans write
  them. Conversion happens only in `@driverzone/geo`; see
  [`engineering/05`](engineering/05-coding-standards.md#coordinates).
- **Enums** are string unions validated by Zod at the boundary and constrained by `enum:` in the
  schema.
- Every collection carries `createdAt`/`updatedAt` via `{ timestamps: true }`.

## Where the invariants live

Under PostGIS, the zone invariants were database triggers — a bad polygon was impossible to
save from any code path. **MongoDB cannot express a cross-document geometric constraint**, so
they moved to application code.

| Invariant | Was | Is now |
|---|---|---|
| Z-1 pickup ⊆ city | `ST_Within` trigger | `@driverzone/geo` `checkWithinParent`, in `createZone.usecase.ts` |
| Z-2 no same-type overlap | `ST_Overlaps` trigger | `checkOverlap` |
| Z-3 valid geometry | `ST_IsValid` CHECK | `checkValidity` (Turf `kinks` + ring closure) |
| Z-MIN-AREA | `ST_Area` CHECK | `checkMinimumArea` |
| Fare snapshot immutable | `BEFORE UPDATE` trigger | Mongoose `immutable: true` |
| `booking_events` append-only | `REVOKE UPDATE, DELETE` | MongoDB role with `insert`+`find` only |

This is a **weaker guarantee** than a trigger, and it is held up by two things:

1. The `zones` module is the only code that can write a zone, enforced by
   `module-internals-are-private` in `.dependency-cruiser.cjs`. See
   [`engineering/04`](engineering/04-boundaries-and-enforcement.md).
2. A **nightly integrity job** re-checks every zone and alerts on drift.

Do not add a second write path to `zones`. That is the whole guarantee.

---

## `zones`

```ts
const zoneSchema = new Schema({
  type:  { type: String, enum: ['CITY', 'PICKUP', 'HILL'], required: true },
  name:  { type: String, required: true },
  code:  { type: String, required: true },          // 'SLG', 'SLG-CENTRAL'

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
zoneSchema.index({ parentZoneId: 1, isActive: 1 });
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
  if (this.type === 'PICKUP') {
    if (!this.parentZoneId) return next(new Error('A PICKUP zone requires a parent CITY zone'));
    if (!this.pickupChargeType) return next(new Error('A PICKUP zone requires a charge type'));
  } else if (this.parentZoneId) {
    return next(new Error(`A ${this.type} zone must not have a parent`));
  }
  next();
});
```

These are the checks a single document can make. The geometric ones need siblings and a parent,
so they live in the use case.

---

## `carCategories`

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

The variant/price split is embedded rather than referenced. Variants are always read with their
package, never queried independently, and the whole document is a few kilobytes — well within
the 16MB limit. Embedding makes a quote one read instead of three.

```ts
const incityPriceSchema = new Schema({
  carCategoryId:         { type: Schema.Types.ObjectId, ref: 'CarCategory', required: true },
  baseFarePaise:         { type: Number, required: true, min: 0 },
  extraMinuteRatePaise:  { type: Number, default: 0, min: 0 },
  extraKmRatePaise:      { type: Number, default: 0, min: 0 },
  nightChargePaise:      { type: Number, default: 0, min: 0 },

  driverCommissionType:   { type: String, enum: ['PERCENT', 'FLAT'], required: true },
  driverCommissionValue:  { type: Number, required: true },   // basis points if PERCENT
  companyCommissionType:  { type: String, enum: ['PERCENT', 'FLAT'], required: true },
  companyCommissionValue: { type: Number, required: true },

  isActive: { type: Boolean, default: true },
}, { _id: true });

const incityVariantSchema = new Schema({
  label:           { type: String, required: true },    // '3 Hours'
  includedMinutes: { type: Number, required: true, min: 1 },
  includedKm:      { type: Number, required: true, min: 0 },

  // See docs/12-open-questions.md Q1. Defaults from duration: a 10-hour rental's destination is
  // advisory, a 3-hour one's is not.
  enforceDropInCity: { type: Boolean, default: true },

  prices:    [incityPriceSchema],
  sortOrder: { type: Number, default: 0 },
  isActive:  { type: Boolean, default: true },
}, { _id: true });

const incityPackageSchema = new Schema({
  cityZoneId:    { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
  pickupZoneIds: [{ type: Schema.Types.ObjectId, ref: 'Zone' }],
  name:          { type: String, required: true },
  description:   String,
  variants:      [incityVariantSchema],
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

// The package-matching query in docs/04.
incityPackageSchema.index({ cityZoneId: 1, pickupZoneIds: 1, isActive: 1 });
```

**Invariant P-1** — every `pickupZoneIds` entry must have `cityZoneId` as its parent. Enforced
in `catalog`'s use case, because it needs to read the zones. You cannot sell a Siliguri package
from a Kolkata pickup.

---

## `outstationPackages`

```ts
const outstationPriceSchema = new Schema({
  carCategoryId:        { type: Schema.Types.ObjectId, ref: 'CarCategory', required: true },
  direction:            { type: String, enum: ['ONE_WAY', 'ROUND_TRIP'], required: true },
  baseFarePaise:        { type: Number, required: true, min: 0 },
  extraKmRatePaise:     { type: Number, default: 0, min: 0 },
  driverAllowancePaise: { type: Number, default: 0, min: 0 },   // night halt / food

  driverCommissionType:   { type: String, enum: ['PERCENT', 'FLAT'], required: true },
  driverCommissionValue:  { type: Number, required: true },
  companyCommissionType:  { type: String, enum: ['PERCENT', 'FLAT'], required: true },
  companyCommissionValue: { type: Number, required: true },

  isActive: { type: Boolean, default: true },
}, { _id: true });

const outstationPackageSchema = new Schema({
  name:          { type: String, required: true },       // 'PKG-1'
  terrain:       { type: String, enum: ['PLAIN', 'HILL'], required: true },
  minKm:         { type: Number, required: true, min: 0 },
  maxKm:         { type: Number, required: true },       // band is [minKm, maxKm)
  pickupZoneIds: [{ type: Schema.Types.ObjectId, ref: 'Zone' }],
  prices:        [outstationPriceSchema],
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

outstationPackageSchema.index({ terrain: 1, minKm: 1, maxKm: 1, isActive: 1 });
outstationPackageSchema.index({ pickupZoneIds: 1, isActive: 1 });
```

Bands are **half-open** `[minKm, maxKm)`, so adjacent bands (0–70, 70–100, 100–150) tile with no
gap and no overlap at the boundary.

**Invariant P-2** — for a given (pickup zone, terrain), bands must not overlap. Two matches means
an ambiguous price. Enforced in the use case:

```ts
const conflict = await OutstationPackage.findOne({
  _id: { $ne: candidateId },
  isActive: true,
  terrain,
  pickupZoneIds: { $in: pickupZoneIds },
  minKm: { $lt: maxKm },
  maxKm: { $gt: minKm },        // half-open overlap test
});
```

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
}, { timestamps: true });

driverSchema.index({ lastLocation: '2dsphere' });
driverSchema.index({ isOnDuty: 1, isVerified: 1, isBlocked: 1, carCategoryIds: 1 });
```

Note `carCategoryIds` is embedded rather than a join collection — a driver has a handful, and
the dispatch eligibility query needs it in the same document to stay a single index scan.

## `driverDocuments`

```ts
const driverDocumentSchema = new Schema({
  driverId:   { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
  docType:    { type: String, required: true },   // 'LICENCE','AADHAAR','POLICE_VERIFICATION'
  fileUrl:    { type: String, required: true },
  number:     String,
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
  key:         { type: String, required: true, unique: true },
  value:       { type: Schema.Types.Mixed, required: true },
  description: { type: String, required: true },
  updatedBy:   { type: Schema.Types.ObjectId, ref: 'AdminUser' },
}, { timestamps: true });
```

Seed values:

```js
[
  ['pickup.default_charge_paise',        10000,  'Pickup fee for PAID zones with no override'],
  ['dispatch.offer_ttl_seconds',         45,     'Seconds a driver has to respond'],
  ['dispatch.wave_size',                 5,      'Drivers offered per wave'],
  ['dispatch.max_waves',                 4,      'Waves before NO_DRIVER_FOUND'],
  ['dispatch.wave_radius_m',             [3000, 7000, 15000, 30000], 'Search radius per wave'],
  ['dispatch.scheduled_lead_minutes',    90,     'Start dispatching this long before pickup'],
  ['booking.quote_ttl_seconds',          600,    'Quote validity window'],
  ['booking.overage_grace_minutes',      15,     'Free grace before extra-time billing'],
  ['booking.billing_block_minutes',      30,     'Overage billed in blocks of this size'],
  ['booking.night_window',               { start: '22:00', end: '06:00' }, 'Night charge window'],
  ['outstation.hill_route_threshold_m',  5000,   'Route metres in a hill zone to price as hill'],
  ['cancellation.free_window_seconds',   300,    'Free cancellation after confirmation'],
  ['driver.max_negative_balance_paise',  500000, 'Block duty past ₹5,000 owed'],
]
```

Read through a cached accessor with a 60s TTL, not on every request.

---

## `auditLog`

```ts
const auditLogSchema = new Schema({
  adminId:    { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
  entityType: { type: String, required: true },
  entityId:   { type: Schema.Types.ObjectId, required: true },
  action:     { type: String, required: true },   // 'CREATE','UPDATE','DELETE','ACTIVATE'
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
