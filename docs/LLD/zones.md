# Zones

The `zones` module owns every polygon in the system and is the only code that may write one.
Everything the customer sees starts here: a point goes in, a set of zone memberships comes out,
and that answer decides whether we serve them, what it costs, and which product they are buying.

The algorithm itself lives in [`zone-resolution.md`](zone-resolution.md). This document is the
**module**: what it owns, what it promises other modules, how a polygon gets written, and every
way it can fail.

## What each zone type is for

Three types, three jobs, no overlap between them.

| Type | Job | Consulted for |
|---|---|---|
| **PICKUP** | The serviceability gate, and a fee. `from` must fall inside one — outside it we do not operate. `FREE` adds nothing; `PAID` adds a pickup charge. | **Both** incity and outstation |
| **CITY** | Defines what "incity" means. Scopes the incity package and answers the `to` check. | Incity only |
| **HILL** | Terrain for outstation pricing, decided by whether the **drop point** falls inside. | Outstation only |

The important thing about that table is what it **doesn't** say. A pickup zone has no parent, no
package links, and no relationship to the city zone. It answers one question — *may we pick up
here, and does it cost extra* — for both products, and nothing else depends on it.

Packages reference exactly one zone between them: the incity package's `cityZoneId`. Outstation
packages reference no zone at all; they are matched on terrain and distance band.

**A hill zone's edge is a price boundary.** Terrain is decided by the destination point landing
inside the polygon, not by measuring the route ([`packages.md`](packages.md) §Terrain), so where
the polygon is drawn *is* the pricing decision. Draw it over the approach corridor, not just the
summit towns: if a destination is reached through the hills, the road to it belongs inside.

### The Siliguri instance

| | Count | Notes |
|---|---|---|
| CITY | 1 | Siliguri |
| PICKUP | 2 | One `FREE`, one `PAID` |
| HILL | N | Darjeeling and neighbours; added as coverage grows |

**Singular by operation, plural by schema.** Nothing in the schema forbids a second city, and
nothing in the code assumes there is only one — `resolveAt` would return the right answer for
five cities without a change. What we have not built is the *admin surface* for more than one:
no city switcher, no zone tree, no per-city package scoping in the UI. That is where the time
goes, and that is what we cut.

The trigger for revisiting: **a second CITY zone gets drawn.** At that point the resolution code
already works; only the admin panel needs the switcher. See
[`decision-log.md`](../decision-log.md) for what this replaced.

## Why MongoDB geo, and what it cannot do

Containment lookups are MongoDB's job; geometric predicates are Turf's. The split is not a
compromise — each side does the thing the other genuinely cannot.

| Question | Answered by | Why not the other |
|---|---|---|
| Which polygons contain this point? | Mongo `$geoIntersects` + `2dsphere` | The only part that needs an index |
| Which hill zone is this drop point in? | Mongo `$geoIntersects` + 2dsphere | The same query that resolves city and pickup |
| Is this polygon legal? (Z-2, Z-3) | Turf, in `@driverzone/geo` | Mongo cannot express a cross-document geometric constraint |
| How many metres of the route are inside? | Turf `lineSplit` + `length` | Mongo has no `$geoIntersection` and no length aggregation |
| Which 0.42 km² is at fault? | Turf `difference` / `intersect` | Mongo cannot return derived geometry |

**Rejected — PostGIS.** It would mean two datastores and a dual write for a few hundred
polygons, and it costs the single-transaction booking→ledger write that already requires the
Mongo replica set. The one thing it buys is real triggers, and those are already replaced by the
choke-point-plus-nightly-job design below.

**Rejected — a geo microservice, or a hosted tilequery API.** A network hop and a per-call price
on the hottest path in the product, for data we should own outright. Quote requests run roughly
3× booking volume; this is the last place to add either latency or a line item.

### Four MongoDB behaviours to design around

**1. Ring winding order decides which side is "inside".** RFC 7946 wants exterior rings
counter-clockwise. Turf is indifferent to winding; the `2dsphere` index is not — a clockwise
exterior ring on a large polygon is interpreted as *the whole earth except that shape*.

This is the nastiest bug available here because **it does not throw**. The symptom is a hill zone
that suddenly contains every route in India, so every outstation trip prices as `HILL` and every
plains trip overpays. Map editors and imported GeoJSON both produce clockwise rings routinely.

*Mitigation:* normalize with `@turf/rewind` in the write path, before validation and before save,
with a test asserting a deliberately clockwise input is stored counter-clockwise.

**2. A single-ring polygon larger than a hemisphere is read as its own complement.** Same family
of problem, same silence. `Z-MAX-AREA` sits beside the existing `Z-MIN-AREA` and rejects anything
implausibly large for an operational zone long before it reaches that limit.

**3. No `$geoIntersection`, no length or area aggregation.** Mongo can tell you *that* a line
crosses a polygon, never *how much of it* does. That limitation is part of why terrain is now
decided by the destination point rather than measured along the route — see
[`packages.md`](packages.md) §Terrain. It still binds wherever a measured intersection is needed,
such as painting the offending area of a failed containment check.

**4. The `2dsphere` index rejects *some* malformed polygons on insert, with unhelpful errors.**
Its coverage is narrower than `ST_IsValid` was and its messages are not something an admin can
act on. `checkValidity` runs first and produces one that is. Do not rely on the index as a
validator.

Two things that are already right and need no further thought: `$geoIntersects` rather than
`$geoWithin`, so a point on a shared border returns one result instead of zero; and antimeridian
and polar edge cases, which do not arise at India's extent.

## The module

Tier 3 (`apps/api/.dependency-cruiser.cjs`). Consumes `settings`. Consumed by `quotes`,
`dispatch`, `admin`.

```
zones/
├── zones.public.ts
├── zones.container.ts
├── domain/
│   ├── zone.entity.ts            Zone, ZoneType, PickupChargeType, ResolvedZones
│   ├── zone.errors.ts            ZoneValidationFailedError, ZoneCodeTakenError, …
│   └── zone.repository.port.ts   findContaining, findSiblings, findByCode, save, supersede
│                                  (findIntersectingRoute — dormant, see the contract)
├── application/useCases/
│   ├── resolveZonesAtPoint.usecase.ts
│   ├── getCoverageAt.usecase.ts
│   ├── validateZoneGeometry.usecase.ts
│   ├── createZone.usecase.ts          ← the invariant choke point
│   ├── updateZoneGeometry.usecase.ts
│   ├── updateZoneMetadata.usecase.ts
│   ├── deactivateZone.usecase.ts
│   └── getZoneDependents.usecase.ts
├── infrastructure/
│   ├── zone.model.ts                  Mongoose schema + 2dsphere index
│   ├── zone.repository.impl.ts        $geoIntersects
│   ├── coverageRequest.model.ts
│   └── coverageRequest.repository.impl.ts
└── interface/
    ├── zones.controller.ts
    ├── zones.routes.ts
    └── zones.validation.ts
```

### The contract, split by consumer

```ts
/**
 * The hot path. `quotes` and `dispatch` get this and therefore physically cannot mutate a
 * polygon — the method is not on the object they were handed.
 */
export interface ZoneResolutionContract {
  /** City + pickup + hill for one point, in a single indexed query. */
  resolveAt(p: LatLng): Promise<ResolvedZones>;

  /**
   * DORMANT. Terrain now comes from `resolveAt(to).hill` — a destination-point lookup, not a
   * route measurement (packages.md §Terrain). Retained with `classifyTerrain` in
   * `@driverzone/geo` so route-based classification is a wiring change rather than a rewrite;
   * the trigger to revive is drivers reporting specific routes as underpaid. No caller today.
   */
  findHillZonesOnRoute(route: LineString): Promise<Polygon[]>;

  /**
   * Call ONLY when a pickup point genuinely resolved to no coverage — this is the expansion
   * roadmap, and a row logged on a validation error or a retry pollutes it.
   */
  recordCoverageRequest(input: CoverageRequestInput): Promise<void>;

  /** Same obligation: only when a real distance had no matching band. */
  recordUnservedDistance(input: UnservedDistanceInput): Promise<void>;
}

/** Admin only. Every method writes an auditLog row. */
export interface ZoneAdminContract {
  validate(input: ValidateZoneRequest): Promise<ValidateZoneResponse>;
  create(input: CreateZoneInput, actor: AdminId): Promise<Zone>;
  updateGeometry(id: ZoneId, geom: Polygon, expectedVersion: number, actor: AdminId): Promise<Zone>;
  updateMetadata(id: ZoneId, patch: ZoneMetadataPatch, actor: AdminId): Promise<Zone>;
  deactivate(id: ZoneId, actor: AdminId): Promise<Zone>;
  dependents(id: ZoneId): Promise<ZoneDependents>;
}
```

There is no `resolvePickupWithCity` and no `$lookup` aggregation. With no parent link there is
nothing to join: the single `$geoIntersects` behind `resolveAt` returns city, pickup and hill
together, which is everything the resolution algorithm needs.

The two `record*` methods are answer-shaped rather than data-shaped — `quotes` reports what
happened and `zones` decides what to store, so the demand signal has exactly one writer and one
definition. Their doc comments carry the obligation, because a coverage table that quietly
accumulates retries is worse than no coverage table.

## Resolution rules

The full algorithms are in [`zone-resolution.md`](zone-resolution.md). The shape, in one place:

```
Both services, first:   from ∈ a PICKUP zone?
                          no  → ZONE_NO_PICKUP_COVERAGE  (200) + coverageRequests row
                          yes → carry chargeType forward
                                PAID → pickup fee added to the fare
                                FREE → nothing added

Incity, then:           from ∈ the CITY zone?
                          no  → PICKUP_OUTSIDE_CITY  (200, suggests OUTSTATION)
                        to   ∈ the CITY zone?
                          no  → DROP_OUTSIDE_CITY    (200, suggests OUTSTATION)
                                subject to the variant's enforceDropInCity — open-questions.md Q1

Outstation, then:       the city zone is irrelevant.
                        route → terrain → distance band → package
```

Note what is **absent**: `ZONE_CONFIG_FAULT` no longer has a pickup/city branch. Under the old
model a pickup zone carried a `parentZoneId` that could disagree with the polygon it sat in, and
that disagreement was a 500 that paged someone. There is no parent now, so there is nothing to
disagree — a pickup point outside the city is simply a pickup point we will not sell an hourly
rental from, and the customer gets a helpful 200 offering outstation instead.

`PICKUP_OUTSIDE_CITY` is its own reason rather than a reuse of `NO_PACKAGE_AVAILABLE`, whose
admin-alert side effect ("a serviceable zone with nothing to sell") would be actively wrong here.

### The pickup fee

Read from the zone, defaulted from global settings, and applied identically to both products:

```
pickup_fee = zone.pickupChargeType === 'PAID'
               ? (zone.pickupChargePaise ?? settings['pickup.default_charge_paise'])
               : 0
```

`pickup.default_charge_paise` is the number ops actually tunes; the per-zone override exists for
the day a second paid zone needs a different figure and costs nothing until then. See
[`pricing-and-commission.md`](pricing-and-commission.md).

## The write path

`createZone.usecase.ts` **is** the guarantee. Under PostGIS the zone invariants were database
triggers, so an invalid polygon was impossible to save from any code path. MongoDB cannot express
a cross-document geometric constraint, so they moved into this use case — which is only a real
guarantee because `module-internals-are-private` in `.dependency-cruiser.cjs` stops anything else
reaching `zones/infrastructure/`. See
[`boundaries-and-enforcement.md`](../engineering/boundaries-and-enforcement.md).

**Do not add a second write path to `zones`. That is the whole guarantee.**

```
1. normalize    @turf/rewind → exterior ring counter-clockwise
                MUST happen first: every check below, and the 2dsphere index itself,
                reads winding to decide inside from outside
2. validate     validateZone({ geom, siblings }) from @driverzone/geo
                  Z-3         topology — closed rings, no self-intersection
                  Z-MIN-AREA  ≥ 1 hectare
                  Z-MAX-AREA  ≤ the operational ceiling
                  Z-2         no overlap with an ACTIVE zone of the same type (100 m² tolerance)
                  Z-COMPLEXITY  > 500 vertices → WARN, not a refusal
3. refuse       any violation of severity ERROR → ZONE_VALIDATION_FAILED (422),
                the violations array returned intact so the editor can paint it
4. save         insert, then write the auditLog row with the geometry
```

`validateZone` takes `parentGeom` as an optional input and runs `checkWithinParent` (Z-1) only
when one is supplied. We never supply one, so Z-1 is dormant rather than deleted — the code and
its tests stay, and a future design that wants nested zones can switch it back on without
rewriting anything.

The same `validateZone` runs unchanged in the browser, which is the point: the admin map editor
validates live as a polygon is drawn and can never disagree with the API's verdict, because it is
literally the same function. See [`admin-panel.md`](admin-panel.md) §Live validation.

### Versioning — Z-5

Editing geometry never mutates a row in place.

```
1. show impact first        GET /admin/zones/:id/dependents
2. on save, in one transaction
     insert new zone   version = old.version + 1
     update old zone   isActive = false, supersededBy = new._id
     insert auditLog   before/after geometry
```

There are **no package links to re-point** — packages do not reference pickup zones, and the
incity package's `cityZoneId` is only touched when a city zone is versioned. That deletes a
whole failure mode from the edit path: under the old model a partial re-point left packages
pointing at a superseded zone and the failure surfaced as an empty package list at quote time.

In-flight bookings keep their original zone reference. They resolved against the old geometry and
their fare snapshot records it (see [`open-questions.md`](open-questions.md) Q11).

`updateGeometry` takes `expectedVersion` and refuses `ZONE_ALREADY_SUPERSEDED` on a mismatch, so
two admins editing the same polygon from two tabs produce one save and one clear error rather
than a silent last-write-wins.

### Indexes

```ts
zoneSchema.index({ geometry: '2dsphere' });                  // THE index. Everything depends on it.
zoneSchema.index({ type: 1, isActive: 1 });
zoneSchema.index({ supersededBy: 1 });                       // version history
zoneSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
```

The partial unique index on `code` matters: superseded versions accumulate and must not block a
new version reusing the code.

**The container asserts the `2dsphere` index exists at startup and refuses to boot without it.**
Without that assertion a dropped index during a migration turns every quote request into a
collection scan — correct answers, catastrophic latency, and no error anywhere to tell you.

## HTTP surface

**There are no authenticated customer routes for resolution.** A customer never asks "what zone
am I in"; they ask for a quote, and `quotes` calls `ZoneResolutionContract` in process. The two
public routes below exist only for the home-screen coverage pre-check.

| Method | Path | Success | Notes |
|---|---|---|---|
| `GET` | `/coverage/check?lat=&lng=` | 200 | Serviceable yes/no plus charge type. A miss is `available: false`, never a 404 |
| `POST` | `/coverage/waitlist` | 201 | "Notify me when you cover this" — writes a `coverageRequests` row |
| `POST` | `/admin/zones/validate` | **200 always** | Dry run. A violation is a valid answer, not a 422 |
| `GET` | `/admin/zones` | 200 | Filters: `type`, `is_active` |
| `POST` | `/admin/zones` | 201 | |
| `GET` | `/admin/zones/:id` | 200 | |
| `PATCH` | `/admin/zones/:id` | 200 | Metadata only — name, code, priority, pickup charge |
| `PATCH` | `/admin/zones/:id/geometry` | 200 | Creates a version. Returns the new one |
| `DELETE` | `/admin/zones/:id` | 200 | Soft deactivate. Returns the updated zone |
| `GET` | `/admin/zones/:id/versions` | 200 | Version history, newest first |
| `GET` | `/admin/zones/:id/dependents` | 200 | Blast radius, before deactivating |
| `GET` | `/admin/coverage/heatmap` | 200 | `$geoNear` cluster over `coverageRequests` |

Geometry gets its own route rather than an overloaded `PATCH`, because the two operations have
different semantics (one versions, one does not), different failure modes, and different audit
payloads. Collapsing them means every caller of the metadata path inherits the concurrency
contract of the geometry path for no reason.

Every response uses `HttpSuccessBody` from `@driverzone/contracts` — `success`, `statusCode`,
`request`, `message`, `data`. The `message` is user-visible in the admin panel, so it is written
for a person: *"Zone saved as version 3."*, not *"OK"*.

## Codes

The rule that governs the whole surface, because it is the one people get wrong:

> **"We can't serve this" is not an error.** It returns `200` with `available: false` and a typed
> reason. `4xx`/`5xx` is reserved for genuine faults, which is what keeps the error dashboard
> meaningful instead of drowning in expected outcomes.

### Unavailable reasons — 200, `available: false`

| Reason | Customer message | Side effect |
|---|---|---|
| `ZONE_NO_PICKUP_COVERAGE` | "We don't have drivers at your pickup location yet." | `coverageRequests` row; offer the waitlist |
| `PICKUP_OUTSIDE_CITY` | "Hourly rentals aren't available from this pickup point. Try an outstation trip." | Returns `suggested_service: OUTSTATION` |
| `DROP_OUTSIDE_CITY` | "That drop-off is outside Siliguri. This looks like an outstation trip." | Returns `suggested_service` plus both points |

`PICKUP_OUTSIDE_CITY` is new. The rest live in `packages/contracts/src/errors.ts` already.

### Faults — 4xx/5xx

| Code | HTTP | When |
|---|---|---|
| `ZONE_VALIDATION_FAILED` | 422 | Save refused on ERROR violations. `data` carries `violations[]` with `offending_geometry` |
| `ZONE_CODE_TAKEN` | 409 | An active zone already holds that code |
| `ZONE_ALREADY_SUPERSEDED` | 409 | Editing a version that is no longer current |
| `INVALID_COORDINATE` | 422 | `assertPlausibleCoordinate` rejected the point — nearly always a lat/lng swap |
| `ZONE_CONFIG_FAULT` | 500 | Now narrow: a resolution that is internally inconsistent in a way the write path should have prevented. **High-priority alert. The cause is never exposed to the customer.** |
| `AMBIGUOUS_ZONE_MATCH` | 500 | Two active same-type zones matched — invariant Z-2 breached |

## Edge cases

Every row is a test. The ones marked ⚠ fail silently if unhandled, which is what makes them worth
writing down.

### Write path

| Case | Outcome | Enforced by |
|---|---|---|
| ⚠ Clockwise exterior ring | Normalized, saved, no complaint to the admin | `@turf/rewind`, step 1 |
| ⚠ Polygon larger than the operational ceiling | Refused | `Z-MAX-AREA` |
| Self-intersecting "bowtie" | ERROR — and every later check is skipped, because predicates on a bowtie are *undefined*, not merely wrong | `checkValidity` (Z-3) |
| Unclosed ring, or fewer than three distinct corners | ERROR | `checkValidity` (Z-3) |
| Under 1 hectare | ERROR | `checkMinimumArea` |
| Over 500 vertices | **WARN — the save is allowed** | `Z-COMPLEXITY` |
| Two pickup zones overlapping by under 100 m² | Allowed. Hand-drawn neighbours share borders imprecisely | `checkOverlap` tolerance |
| Two pickup zones sharing an exact edge | Allowed | `checkOverlap` |
| Reusing the `code` of a superseded version | Allowed | Partial unique index on `isActive` |
| Reusing the `code` of an active zone | 409 | `ZONE_CODE_TAKEN` |
| Editing a superseded version | 409 | `expectedVersion` |
| Two admins editing the same zone concurrently | One save, one clear 409 — never last-write-wins | `expectedVersion` |
| Deactivating the last active PICKUP zone | Allowed, but `dependents` says **"all service stops"** in those words | `getZoneDependents` |
| Deactivating the CITY zone | Allowed; `dependents` reports incity packages going dark while outstation keeps working | `getZoneDependents` |
| Reactivating an old version | Re-runs every check — the world moved while it was inactive | `createZone` path |

### Read path

| Case | Outcome |
|---|---|
| `from` outside every pickup zone | `ZONE_NO_PICKUP_COVERAGE` + a `coverageRequests` row |
| `from` in a pickup zone, outside the city | `PICKUP_OUTSIDE_CITY`; outstation still offered |
| ⚠ `from` exactly on the FREE/PAID border | Both match. `priority DESC` + `$limit: 1` decides, and **the tiebreak must favour FREE** — silently overcharging on an ambiguity is far worse than undercharging. If it ever *actually* disambiguates, Z-2 is breached: alert |
| ⚠ lat/lng swapped | `INVALID_COORDINATE`, naming the swap — not a silent resolve into the Arabian Sea |
| ⚠ Unpopulated `0, 0` | `INVALID_COORDINATE`, same guard |
| Point exactly on a polygon vertex | Resolves. `$geoIntersects`, not `$geoWithin` |
| Zone deactivated mid-session | The existing quote is honoured; new quotes fail (Q11) |
| Drop point inside a hill zone | `HILL`, whatever the route crossed |
| Drop point outside every hill zone | `PLAIN`, even if the route climbed for 30 km. The known cost of destination-point classification — mitigated by drawing the polygon over the approach corridor |
| Drop point exactly on a hill-zone border | Resolves, and resolves the same way twice — `$geoIntersects`, and Z-2 forbids two active hill zones overlapping |
| Drop point in a hill zone that overlaps the city zone | Both candidates exist; precedence picks incity (`packages.md`). Legal — Z-2 is same-type only |

### Operational

| Case | Outcome |
|---|---|
| ⚠ `2dsphere` index missing | The API refuses to boot. Without the assertion this degrades to a collection scan per quote, silently |
| Nightly integrity job finds drift | Alert. **Never auto-fix** — a polygon that drifted is a polygon somebody needs to look at |

## Coverage intelligence

Two collections that cost almost nothing and are worth a great deal. Every failed lookup is a
demand signal; cluster them and you have a ranked list of where to draw the next pickup zone —
and when you draw it, you can notify everyone who asked.

```ts
coverageRequestSchema.index({ point: '2dsphere' });
```

That index is what makes the expansion heatmap a `$geoNear` aggregation rather than a full scan.
Schemas are in [`database-schema.md`](database-schema.md).

## The nightly integrity job

Re-runs `validateZone` over every active zone and alerts on anything that now violates a rule.

This is the second half of the guarantee. The choke point stops a bad polygon being written
*today*; the nightly job catches the case where the choke point was bypassed, a rule changed, or
a neighbouring zone moved and turned a legal pair into an overlapping one. It is the difference
between "we believe the invariants hold" and "we checked at 03:00".

It alerts and never repairs. A zone that drifted is a decision for a person.

## Testing

Zone logic is the highest-risk code in the system and the easiest to test — it is a pure function
of geometry. Fixtures live in `packages/geo/test/fixtures.ts` and model a real place, because
reasoning about "is this polygon inside that one" is far easier when the shapes correspond to
somewhere you can picture.

```
SILIGURI_CITY        CITY,   lng 88.35–88.50, lat 26.65–26.78
CENTRAL_PICKUP       PICKUP, FREE, well inside the city
PAID_PICKUP          PICKUP, PAID, shares CENTRAL's edge exactly   ← new, for the fee path
EASTERN_PICKUP       PICKUP, shares CENTRAL's east edge exactly
STRADDLING_PICKUP    PICKUP, crosses the north city boundary       ← now legal; drives PICKUP_OUTSIDE_CITY
DARJEELING_HILLS     HILL
```

`STRADDLING_PICKUP` changes meaning under this model. It used to be a Z-1 violation fixture; it
is now a legal zone whose northern half produces `PICKUP_OUTSIDE_CITY` for incity and a perfectly
normal quote for outstation. Both halves need a test.

Every case in the edge-case tables above is a test. The ⚠ rows are the ones to write first.

## Deliberately deferred

| Deferred | Trigger to build it |
|---|---|
| A second city | A second CITY zone is drawn. Resolution already works; only the admin switcher is missing |
| Per-zone package catalogues | Ops wants the paid zone to sell something the free zone does not. Re-adding an optional `pickupZoneIds` array to a Mongoose schema needs no migration |
| Per-hill-zone pricing (Darjeeling ≠ Kalimpong) | Ops wants them to differ. `resolveAt` already returns *which* hill zone, so this is a package key change, not new plumbing (`packages.md`) |
| Nested zones (Z-1 back on) | A zone genuinely needs to be contained by another. `checkWithinParent` and its tests are still there, unused |

## Dependencies Phase 1 will need

| Package | Why | When |
|---|---|---|
| `@turf/rewind` | **Required.** Winding normalization in the write path | Phase 1 |
| `h3-js` | Route cache keys for outstation | Phase 1 |
| `@turf/simplify` | Admin "simplify this polygon" for the `Z-COMPLEXITY` warning | Phase 3, optional |
| `@turf/bbox` | Map fitting in the editor | Phase 3, optional |
