# 02 — Domain Model

## Glossary

| Term | Meaning |
|------|---------|
| **Zone** | A named polygon. One of three types: CITY, PICKUP, HILL. |
| **City zone** | Operational boundary of a city. Defines "incity". |
| **Pickup zone** | A serviceable sub-area *inside* a city zone. `FREE` or `PAID`. |
| **Hill zone** | Terrain classifier for outstation routing. Not tied to a city. |
| **Package** | A sellable service definition attached to zones. Incity or outstation. |
| **Variant** | A duration option on an incity package (3H, 10H). |
| **Car category** | Hatchback / Sedan / SUV / Luxury / EV. Prices are per category. |
| **Quote** | A server-computed, time-limited price for a specific pickup/drop/variant/car. |
| **Booking** | A confirmed trip. Carries a frozen copy of its fare. |
| **Offer** | A single dispatch invitation sent to one driver for one booking. |
| **Wave** | A round of offers sent simultaneously to a ranked batch of drivers. |
| **Fare snapshot** | Immutable JSON of the full fare breakdown, written at confirmation. |

## Entity map

```
                        ┌──────────────┐
                        │    zones     │
                        │  CITY        │◄────┐ parent_zone_id
                        │  PICKUP      │─────┘ (PICKUP → CITY)
                        │  HILL        │
                        └──────┬───────┘
                               │
             ┌─────────────────┴──────────────────┐
             │                                    │
   ┌─────────▼──────────┐              ┌──────────▼───────────┐
   │ incity_packages    │              │ outstation_packages  │
   │  city_zone_id      │              │  terrain             │
   │  + pickup zones (M:N)             │  min_km / max_km     │
   └─────────┬──────────┘              │  + pickup zones (M:N)│
             │                         └──────────┬───────────┘
   ┌─────────▼──────────┐                         │
   │ incity_variants    │              ┌──────────▼──────────────┐
   │  included_minutes  │              │ outstation_prices       │
   │  included_km       │              │  (pkg × car × direction)│
   └─────────┬──────────┘              └──────────┬──────────────┘
             │                                    │
   ┌─────────▼──────────┐                         │
   │ incity_prices      │                         │
   │  (variant × car)   │                         │
   └─────────┬──────────┘                         │
             │                                    │
             └──────────────┬─────────────────────┘
                            │
                     ┌──────▼──────┐
                     │   quotes    │  TTL 10 min, holds computed fare
                     └──────┬──────┘
                            │
                     ┌──────▼──────────┐      ┌──────────────────┐
                     │    bookings     │─────►│ booking_events   │ append-only
                     │  fare_snapshot  │      └──────────────────┘
                     │  status         │
                     └──┬───────────┬──┘      ┌──────────────────┐
                        │           └────────►│ dispatch_offers  │
                        │                     └──────────────────┘
              ┌─────────▼─────────┐
              │ driver_earnings   │  ledger → payout batches
              └───────────────────┘
```

## Invariants

These must hold at all times. Each is enforced at **write time**, not read time — a
violation should be impossible to create, not merely detected later.

> **Where enforcement lives.** These were originally PostGIS triggers, so a violation was
> literally impossible to save. MongoDB cannot express a cross-document geometric constraint,
> so Z-1, Z-2 and Z-3 now live in `@driverzone/geo` and run in the `zones` module's write path.
>
> That is a weaker guarantee, held up by two things: the `zones` module is the *only* code that
> can write a zone — enforced by `module-internals-are-private` in `.dependency-cruiser.cjs`,
> see [`engineering/04`](../engineering/04-boundaries-and-enforcement.md) — and a nightly integrity
> job re-checks every zone and alerts on drift.
>
> The upside is that the same code runs in the browser, so the admin map editor validates live
> as a polygon is drawn and can never disagree with the API's verdict.

### Zone invariants

- **Z-1** Every `PICKUP` zone has a `parent_zone_id` pointing at a `CITY` zone, and
  the pickup polygon is geometrically within the city polygon.
  *Enforced by:* `checkWithinParent` (Turf `booleanWithin`) in `createZone`/`updateZoneGeometry`.
  *Why it matters:* this is what makes the FR-B4 runtime fault unreachable.
  *Violation carries the spilling area as geometry*, so the editor paints exactly which corner
  is wrong — "0.42 km² outside Siliguri" is a ten-second fix, "invalid zone" is a guessing game.

- **Z-2** No two **active** zones of the same `type` overlap.
  *Enforced by:* `checkOverlap` (Turf `booleanOverlap` + `intersect`, with a 100 m² tolerance).
  *Why:* an overlapping pair makes zone resolution non-deterministic — the customer's price
  depends on which document Mongo happened to return first.
  *The tolerance is deliberate:* adjacent polygons drawn by hand share a border imprecisely, and
  a strict test would reject legitimate neighbours.

- **Z-3** Every zone geometry is topologically valid — closed rings, no self-intersection.
  *Enforced by:* `checkValidity` (Turf `kinks` + ring-closure check).
  *Why:* geometric predicates give undefined — not wrong, *undefined* — results on
  self-intersecting polygons, so a bowtie zone resolves inconsistently rather than failing
  outright. Map-drawing UIs produce them routinely, by dragging one vertex across an edge.
  *A 2dsphere index rejects some malformed polygons on insert; do not rely on it.* Its coverage
  is narrower and its errors are unhelpful.

- **Z-4** A `CITY` zone has no parent. A `HILL` zone has no parent.

- **Z-5** Editing a zone's geometry never mutates the row in place — it writes a new
  version and supersedes the old one.

### Package invariants

- **P-1** Every pickup zone linked to an incity package must have that package's
  `city_zone_id` as its parent. (You can't sell a Siliguri package from a Kolkata pickup.)

- **P-2** For a given (pickup zone, terrain, car category, direction), outstation distance
  bands must not overlap. Two matching packages = ambiguous price.

- **P-3** An active package has at least one active pickup zone and at least one active
  price row. A package that can never be sold must not be marked active.

- **P-4** `min_km < max_km`. Bands are `[min_km, max_km)` — half-open, so adjacent bands
  (0–70, 70–100, 100–150) tile cleanly with no gap and no overlap at the boundary.

### Booking invariants

- **B-1** A booking's `fareSnapshot` is written once and never updated. Fare corrections are
  separate `fareAdjustments` documents, not edits.
  *Enforced by:* Mongoose `immutable: true`. Note this silently ignores the write rather than
  throwing, so it is a guard rather than an alarm.

- **B-2** `driver_id` transitions from `NULL` to non-`NULL` exactly once per assignment,
  via a conditional update. Reassignment sets it back to `NULL` in the same transaction
  that records the reason.

- **B-3** Every status change appends a `bookingEvents` document. No status change bypasses the
  transition function.
  *Enforced by:* a MongoDB role granting only `insert` and `find` on that collection — the
  direct equivalent of `REVOKE UPDATE, DELETE`.

- **B-4** A booking in a terminal status (`COMPLETED`, `CANCELLED_*`, `EXPIRED`,
  `NO_DRIVER_FOUND`) accepts no further transitions except explicit admin reopen, which
  is itself an audited event.

### Money invariants

- **M-1** All amounts are integers in paise.

- **M-2** For every booking, the sum of its `driverEarnings.amountPaise` equals the driver's
  share in the fare snapshot plus any adjustments. Reconciled nightly against the
  `walletBalancePaise` cache, which alerts on drift.

- **M-3** Commission is computed from the snapshot, never from the live package.

## Why pickup zones are children of city zones

A reasonable alternative is to leave pickup zones free-floating and derive the city by
spatial lookup at booking time. We deliberately don't:

1. It makes invariant **Z-1** enforceable at save time, which deletes the entire FR-B4
   failure class from production.
2. It makes "show me all pickup zones in Siliguri" an index lookup on `parentZoneId` rather
   than a geometric query.
3. It gives the admin UI a natural tree: city → pickup zones → packages.

The cost is that a pickup zone straddling two cities is unrepresentable. That is a
feature — such a zone has no coherent incity pricing anyway.
