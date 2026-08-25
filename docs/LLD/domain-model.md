# Domain Model

## Glossary

| Term | Meaning |
|------|---------|
| **Zone** | A named polygon. One of three types: CITY, PICKUP, HILL. |
| **City zone** | Operational boundary of a city. Defines "incity" — the `to` check, and the incity package's scope. Never consulted for pickup. |
| **Pickup zone** | The serviceability gate, and a fee. `from` must fall inside one, for incity *and* outstation alike. `FREE` adds nothing; `PAID` adds a pickup charge. Top-level: no parent, no package links. |
| **Hill zone** | Terrain classifier for outstation routing. Not tied to a city. |
| **Package** | A sellable service definition. Incity (scoped to a city zone) or outstation (scoped to terrain and a distance band). Neither references a pickup zone. |
| **Variant** | A duration option on an incity package (3H, 10H). |
| **Car category** | Hatchback / Sedan / SUV / Luxury / EV. Prices are per category. |
| **Quote** | A server-computed, time-limited price for a specific pickup/drop/variant/car. |
| **Booking** | A confirmed trip. Carries a frozen copy of its fare. |
| **Offer** | A single dispatch invitation sent to one driver for one booking. |
| **Wave** | A round of offers sent simultaneously to a ranked batch of drivers. |
| **Fare snapshot** | Immutable JSON of the full fare breakdown, written at confirmation. |
| **Customer** | A phone-verified rider account. Owns saved addresses and vehicles — the *customer's* car, since the driver drives it, not their own (see `open-questions.md` Q5). |
| **Driver** | A phone-verified, admin-onboarded professional-driver account. Carries vehicle *preferences* (what they're competent to drive), never ownership. |
| **AdminUser** | An internal ops account. Provisioned by another admin — never self-registered, never created by the auth flow itself. |
| **Session** | One refresh-token lineage for a logged-in user. Rotates on every refresh; a reused token revokes the whole family. See `auth.md`. |

## Identity actors

`customers`, `drivers` and `adminUsers` (`user.md`) sit outside the pricing/booking pipeline drawn below, but every collection in it points back to one of them:

```
customers ──► quotes ──► bookings ◄── drivers ──► dispatchOffers
                             ▲
                             │ createdBy / verifiedBy / adminId
                       adminUsers   (zones, packages, prices, drivers.documents, auditLog)
```

`adminUsers` has no box of its own in the pipeline below because it never *flows* into a booking — it only ever authors or verifies the things that do (a zone, a package, a driver's documents). Every write an admin makes is itself an `auditLog` row (`database-schema.md`).

## Entity map

```
                        ┌──────────────┐
                        │    zones     │
                        │  CITY        │──┐
                        │  PICKUP      │  │  three flat types.
                        │  HILL        │  │  no parents, no links between them.
                        └──────────────┘  │
                               │          │
             ┌─────────────────┘          └──── PICKUP: gate + fee, referenced by
             │                                  no package. HILL: terrain only.
   ┌─────────▼──────────┐              ┌──────────────────────┐
   │ incity_packages    │              │ outstation_packages  │
   │  city_zone_id ─────┘              │  terrain             │
   │                    │              │  min_km / max_km     │
   └─────────┬──────────┘              └──────────┬───────────┘
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
> so Z-2 and Z-3 now live in `@driverzone/geo` and run in the `zones` module's write path.
>
> That is a weaker guarantee, held up by two things: the `zones` module is the *only* code that
> can write a zone — enforced by `module-internals-are-private` in `.dependency-cruiser.cjs`,
> see [`engineering/04`](../engineering/boundaries-and-enforcement.md) — and a nightly integrity
> job re-checks every zone and alerts on drift.
>
> The upside is that the same code runs in the browser, so the admin map editor validates live
> as a polygon is drawn and can never disagree with the API's verdict.

### Zone invariants

- **Z-1** *Retired 2026-08-25.* Pickup zones no longer have a parent — they are a
  serviceability gate, not a sub-area of a city (`zones.md`, [`decision-log.md`](../decision-log.md)).
  The label is kept so Z-2…Z-5 hold their numbers and existing references stay valid.
  `checkWithinParent` and its tests remain in `@driverzone/geo`, dormant: `validateZone` runs it
  only when a `parentGeom` is supplied, and nothing supplies one.

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

- **Z-4** No zone of any type has a parent. All three types are flat and independent.

- **Z-5** Editing a zone's geometry never mutates the row in place — it writes a new
  version and supersedes the old one.

### Package invariants

- **P-1** *Retired 2026-08-25*, with the package ↔ pickup-zone link it enforced. Packages do
  not reference pickup zones at all (`zones.md`). Label kept so P-2…P-4 hold their numbers.

- **P-2** For a given (terrain, car category, direction), outstation distance bands must not
  overlap. Two matching packages = ambiguous price. *Scope widened* when the pickup-zone
  qualifier went: this is now a global check per terrain, which is both simpler to run and
  stricter than what it replaced.

- **P-3** An active package has at least one active price row. A package that can never be sold
  must not be marked active.

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

## Why pickup zones are free-floating

A pickup zone answers one question — *may we pick up here, and does it cost extra* — and it
answers it identically for incity and outstation. Nothing about that question involves a city.

The earlier design made every pickup zone a child of a city zone, geometrically contained by it
and enforced at save time (invariant Z-1). Three arguments carried it, and the model above
dissolves all three:

1. **It made a runtime config fault unreachable.** But the fault only existed *because* of the
   parent link: a `parentZoneId` that disagreed with the polygon it sat in. With no parent there
   is nothing to disagree, so the branch is gone rather than merely unreachable — a 500 that
   paged someone became a 200 that offers the customer outstation instead.
2. **It made "all pickup zones in Siliguri" an index lookup.** Worth nothing against two zones,
   and `resolveAt` already returns city and pickup together from a single `$geoIntersects`.
3. **It gave the admin UI a tree: city → pickup zones → packages.** That tree no longer exists.
   Packages do not reference pickup zones.

What the change buys, beyond the deleted fault: a pickup zone may now sit outside the city
entirely. Bagdogra airport and NJP station are the two highest-value outstation pickups in
Siliguri, and whether they fall inside a municipal boundary drawn by an ops person should not
determine whether we can serve them.

What it costs: a pickup zone drawn somewhere absurd is no longer caught at save time. Z-2 still
prevents the dangerous case (two overlapping pickup zones making resolution non-deterministic);
a pickup zone in the wrong district is merely useless, and the nightly integrity job plus the
`dependents` view make it visible.

## Cardinality: generic schema, singleton operations

Siliguri runs one city zone, two pickup zones and a handful of hill zones, and is expected to
for one to two years. Nothing in the schema or the resolution code assumes that — `resolveAt`
would answer correctly for five cities unchanged.

What we have *not* built is the operational surface for more than one: no city switcher, no zone
tree, no per-city package scoping in the admin panel. That is where the build time actually
goes, and it is the part that can be added later without touching stored data.

The distinction matters when someone proposes a shortcut. Hard-coding "the city zone" as a
constant would save about a day and cost a data migration plus a rewrite of zone resolution.
Skipping the admin city switcher costs nothing and is reversible in an afternoon. Cut the
second, never the first.

**Trigger to revisit:** a second `CITY` zone gets drawn.
