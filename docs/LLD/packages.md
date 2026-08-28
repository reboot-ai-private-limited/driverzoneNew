# Packages

A package is the thing we actually sell. Zones decide *whether* we serve a trip and what the
pickup costs ([`zones.md`](zones.md)); packages decide *what product it is* and *what it costs*.

There are two, and the customer never chooses between them — the server does, from the two map
points. This document is that decision, the data behind it, and every way it can go wrong.

## The two products

| | InCity | Outstation |
|---|---|---|
| Sold against | The **city zone** (`cityZoneId`) | **Terrain** and a **distance band** |
| Priced by | The **variant** — one fare each | The **direction** — one-way or return |
| Customer chooses | The variant — 3 hours, 10 hours | The direction — one-way or return |
| References a pickup zone | **No** | **No** |
| Price varies by car category | **No** | **No** |

Neither product references a pickup zone. That relationship was retired along with invariant P-1
— a pickup zone is a serviceability gate and a fee, and it has already done its whole job before
package matching begins.

**Neither product prices by car category either.** Both used to: an incity variant carried a
price row per category, and an outstation band carried one per `(category, direction)` — ten
rows per band. Retired 2026-08-28 ([`../decision-log.md`](../decision-log.md)). An SUV and a
hatchback now pay the same fare for the same trip. The category is still recorded on the booking
and still decides *who can drive* ([`dispatch-and-assignment.md`](dispatch-and-assignment.md));
it simply no longer decides what anything costs.

### Outstation is priced per direction

A band carries two fares — `oneWayFarePaise` and `roundTripFarePaise` — and one
`driverCommissionBps`. That is the whole of its pricing.

**The fare is flat across the band.** 72 km and 98 km both pay the `70–100` fare; there is no
per-km rate on top. This closes `open-questions.md` Q3, which asked exactly that and warned what
the answer costs: **flat pricing needs many narrow bands**, where base-plus-per-km works with a
few wide ones. That is why splitting a band is a first-class action in the admin panel and why
the band list makes an uncovered stretch impossible to miss.

**`roundTripFarePaise` is nullable**, and `null` means *this band does not sell a same-day
return* — never that the return is free. A long hill band the driver cannot get back from in a
day is a real case, and it is the successor to the old "leave that price row out" affordance. A
`ROUND_TRIP` request against such a band is `NO_PACKAGE_AVAILABLE`, not
`NO_PACKAGE_FOR_DISTANCE`: the distance *is* covered, and sending ops to add a band would send
them to create one that already exists.

**A round trip is not a computed multiple of a one-way.** Ops sets both independently, because
the driver's day is different in kind and not merely in length: they wait at the destination and
they may not get a return fare. Deriving one from the other would bake a ratio into code that
belongs in a form field.

**The company's commission is derived, never stored:** `10000 − driverCommissionBps`. Storing
both sides let a form save 75% and 20% and quietly leave 5% of every trip in nobody's column.
The pair that could disagree no longer exists.

> 🔴 **`open-questions.md` Q4 is still open**, and two-way pricing cannot be fully specified
> until it closes: maximum included wait at the destination, per-day driver allowance,
> night-halt charge, and whether a multi-day trip is the same product at all. The recommendation
> on file is to cap v1 at same-day return and defer multi-day entirely — it has different driver
> economics and is a different product. Until that is decided, `ROUND_TRIP` means same-day.

### InCity is priced per variant

A variant is a duration option carrying `includedMinutes`, `includedKm`, its own
`baseFarePaise`, and its own `driverCommissionBps`. The customer picks the variant, so a quote
returns **all** active variants of the winning package, not one.

Overage beyond the included time or distance is billed at the variant's own
`extraMinuteRatePaise` / `extraKmRatePaise` (`open-questions.md` Q2). Unlike outstation, incity
keeps its overage rates — "included km" would mean nothing if exceeding it were free.

Schemas for both live in [`database-schema.md`](database-schema.md).

## Terrain is a property of the destination, not the route

Admin draws hill zones on the map. If the drop point falls inside one, the lookup key is
`terrain = HILL`. If it does not, `terrain = PLAIN`. **The route is never measured.**

```ts
const { city, hill } = await zones.resolveAt(to);   // already one $geoIntersects
const terrain = hill ? 'HILL' : 'PLAIN';
```

That is the whole classifier. It is a field read off a query that is already running.

### Why this replaced route-intersection classification

The previous design measured how many metres of the OSRM route fell inside a hill polygon and
compared that to a threshold. It was more faithful in principle and considerably worse in
practice:

- **The threshold was a guess.** `outstation.hill_route_threshold_m = 5000` was documented as
  such, with "tune it when drivers complain" as the plan. A pricing dimension whose boundary
  nobody can justify is a dispute waiting to happen.
- **It was unexplainable.** A driver contesting a fare had to be talked through a route-length
  sum. Now the answer is a map pin: your destination is inside the Darjeeling hill zone.
- **It carried a tail of edge cases** — `lineSplit` throwing on degenerate geometry, a route
  lying wholly inside a polygon with no boundary to split on, a route grazing two zones. All of
  that is gone, not worked around.
- **Ops had no direct control.** The polygon and the threshold interacted in ways that were hard
  to predict from the map. Now the polygon *is* the control.

### What it costs, and the mitigation

A plains destination reached only by crossing a hill stretch now prices as `PLAIN`, and the
driver is underpaid for the hardest part of the job. That is a real regression against the old
model and it should not be glossed.

**The mitigation is operational, and it is the thing to get right when drawing zones: cover the
approach corridor, not just the summit towns.** If a destination is reached *through* the hills,
the road to it belongs inside the hill polygon. A hill zone's edge is now a price boundary, and
it should be drawn like one.

The trigger to revisit: drivers reporting specific routes as underpaid. `classifyTerrain` and
`hillMetresOnRoute` are retained in `@driverzone/geo`, unused but tested, so reviving
route-based classification is a wiring change rather than a rewrite — the same treatment
`checkWithinParent` got when Z-1 was retired.

### OSRM does not go away

Only *terrain* left the route. The distance band still needs **road** distance: straight-line
haversine under-reports by 30–50% in hill terrain, which is worst exactly when the destination
is in the hills, and with 25–30 km bands that error puts trips in the wrong band constantly.

One simplification does follow. The route *geometry* was only ever fetched so terrain
classification could measure it, so OSRM is now called with `overview=false` and the H3 route
cache stores `{ distance_m, duration_s }` with no polyline. See
[`zone-resolution.md`](zone-resolution.md) §Road distance.

## Resolution — the server picks the product

The customer supplies two points and, for outstation, a direction. They do not pick a tab, and
they do not pick a price tier — the car category no longer reaches this module at all.

```
1. from ∈ a PICKUP zone?
     no  → ZONE_NO_PICKUP_COVERAGE (200) + a coverageRequests row
     yes → carry chargeType. PAID adds the pickup fee, FREE adds nothing.

2. resolveAt(to) → { city, hill }              one indexed query

3. build the candidate set
     INCITY             if to ∈ the CITY zone and from ∈ the CITY zone
     OUTSTATION HILL    if to ∈ a HILL zone
     OUTSTATION PLAIN   otherwise

     distanceKm ← ceil(OSRM road metres / 1000)
     band       ← the [minKm, maxKm) containing distanceKm, for that terrain

4. precedence — the first rung that separates two candidates decides
     a. INCITY beats OUTSTATION
     b. HILL beats PLAIN
     c. lower computed total for THIS request
     d. more recently created; then id

5. return exactly ONE package
     incity     → the package + every active variant
     outstation → the package + its fare for `direction`
```

### On rung (a) — and the guard it needs

This rung is reachable and it has teeth. A 60 km drop that happens to land inside the city
polygon matches both an incity package (city zone) and an outstation band (distance). Preferring
incity blindly sells an hourly rental for a trip that is plainly an outstation run: the
extra-km rate collects roughly the right money, but it is the wrong product, and the customer
never chose it.

**The guard:** incity wins only if `distanceKm` fits within `incity.max_distance_multiple` ×
the longest active variant's `includedKm`. Above that it falls through to outstation. The
multiple will live in `globalSettings` so ops can tune it without a deploy; the key is not
defined yet (see below).

### On rung (b) — defensive only

Under destination-point classification, `to` is either inside a hill zone or it is not. HILL and
PLAIN candidates are therefore **mutually exclusive by construction**, and this rung cannot fire.

It stays anyway, in the same spirit as `priority DESC` in zone resolution: if it ever *does*
separate two candidates, something upstream is broken and we want a deterministic answer plus an
alert rather than whichever document Mongo returned first.

### On rung (c) — which total

Rung (c) only ever fires between two packages of the same type and terrain, which is a
configuration error that P-2 should have prevented — except for incity, where two active
packages against one city zone are legal and the admin panel warns about them rather than
forbidding them.

Compare on the **fare for this request**: the band's fare for the requested direction, or for
incity the cheapest active variant. That is now much closer to "the total the customer pays"
than it was, because a band's fare no longer has a per-km component bolted on — what remains
outside it is the pickup fee, the time-of-day surcharge, insurance and tax, all of which belong
to the `pricing` module. Never resolve an ambiguity in the direction of charging more.

## No fallback across terrain

A destination inside a hill zone with no HILL band covering its distance returns
`NO_PACKAGE_FOR_DISTANCE` and writes an `unservedDistanceRequests` row naming the terrain and
the distance, so ops knows exactly which band to add.

**It never falls back to the PLAIN package of the same band.** That would price a hill trip off
a plains ladder and underpay the driver on the hardest work — which is the entire reason terrain
is a pricing dimension. A booking we decline is a gap ops can close in a minute; a booking we
take at the wrong price is a driver who stops accepting hill trips.

## Overlap, and the guards against it

**P-2, restated for this model:** for a given terrain, no two active packages may have
overlapping `[minKm, maxKm)` bands.

Across terrains, overlap is **normal and intended**. `0–70 PLAIN` and `0–70 HILL` are the
expected configuration, not a conflict — they are two independent ladders that happen to cover
the same distances.

Bands are half-open, so adjacent bands tile cleanly: `0–70`, `70–100`, `100–150` leaves no gap
and no double cover, and 70 km belongs to the second band.

One guard is not enough, because the two failure modes are opposites — an overlap gives two
prices, a gap gives none:

| Layer | Catches | Where |
|---|---|---|
| Write-time overlap query, scoped by terrain | The overlap as it is being created | `createOutstationPackage` / `updateOutstationPackage` |
| P-4: `minKm < maxKm`, half-open | Inverted and zero-width bands | Domain validation |
| Band-coverage strip in the admin editor, per terrain | The **gap** — the failure nobody notices until a customer hits it | [`admin-panel.md`](admin-panel.md) |
| Nightly integrity job | Drift, and any overlap predating the check | Alerts, never auto-fixes |
| Precedence at read time | Turns a surviving misconfiguration into a deterministic answer + an alert, never a customer-facing failure | Rung (c) |

The write-time query, half-open on both sides:

```ts
const conflict = await OutstationPackage.findOne({
  _id: { $ne: candidateId },
  isActive: true,
  terrain,                      // the whole scope. No pickup-zone clause.
  minKm: { $lt: maxKm },
  maxKm: { $gt: minKm },
});
```

## Invariants

- **P-1** *Retired* with the package ↔ pickup-zone link. See [`domain-model.md`](domain-model.md).
- **P-2** No overlapping bands within a terrain, as above.
- **P-3** *Incity only.* An active package has at least one active variant. It used to also
  require an active price row inside that variant, because a variant could hold zero priced
  categories and still look healthy; a variant now carries its fare structurally, so the inner
  clause has nothing left to check. **Retired for outstation** — `oneWayFarePaise` is a required
  field on the band, which makes "active but unsellable" unrepresentable rather than merely
  forbidden. An invariant that cannot be violated is a comment, and it is written as one in
  `outstationPackage.entity.ts`.
- **P-4** `minKm < maxKm`. Bands are `[minKm, maxKm)`.

## Codes

Reused from `packages/contracts/src/errors.ts`:

| Code | HTTP | When |
|---|---|---|
| `NO_PACKAGE_AVAILABLE` | 200 | No incity package configured for the city. Admin alert — a serviceable area with nothing to sell is a config gap, not a customer problem |
| `NO_PACKAGE_FOR_DISTANCE` | 200 | No band covers this distance for this terrain. Writes `unservedDistanceRequests` |

New faults:

| Code | HTTP | When |
|---|---|---|
| `PACKAGE_BAND_OVERLAP` | 409 | Save would create an overlapping band. `data` carries the conflicting package id, so the editor can link straight to it |
| `PACKAGE_NOT_SELLABLE` | 422 | P-3 — activating an incity package with no active variant. Outstation cannot raise it: a band's fare is a required field |

The same rule as everywhere else: **"we can't serve this" is a 200 with `available: false`**;
4xx/5xx is for genuine faults.

## Edge cases

| Case | Outcome |
|---|---|
| `to` in a hill zone that overlaps the city zone | Both candidates exist; rung (a) picks incity. Legal — Z-2 only forbids same-*type* overlap |
| `distanceKm` exactly on a band boundary | Half-open: 70 km belongs to `70–100`, never to `0–70` |
| `distanceKm` below every band's `minKm` | `NO_PACKAGE_FOR_DISTANCE`. Ops needs a 0–N band |
| A 60 km drop inside the city polygon | Falls through to outstation via the `incity.max_distance_multiple` guard |
| Package deactivated between quote and booking | The quote is honoured — its fare snapshot is frozen and immutable (B-1) |
| A price edited inside the quote's TTL | The quote holds the old fare until it expires. Re-quoting shows the new one; `QUOTE_EXPIRED` carries the diff |
| Active package with zero active variants | P-3 forbids creating it; the nightly job alerts if one exists |
| Two candidates tie on total | Rung (d) — most recent, then id. Deterministic, never a coin flip |
| `ROUND_TRIP` asked of a band whose `roundTripFarePaise` is null | That band is not a candidate. If nothing else matches, `NO_PACKAGE_AVAILABLE` — **not** `NO_PACKAGE_FOR_DISTANCE`, because the distance is covered and the band already exists |
| Ops wants `0–150` split into `0–70` and `70–150` | The band's **Split** action: shrink the original, then create the upper half with the fares copied. Two writes, one button. Doing it by hand in the other order hits `PACKAGE_BAND_OVERLAP` |
| ⚠ Hill polygon drawn around the town but not the approach road | Trip prices as PLAIN and underpays the driver. The failure this model trades for its simplicity — see §What it costs |

## The module

Tier 4, above `zones`. Skeleton per [`adding-a-module.md`](../engineering/adding-a-module.md).

The module is named **`packages`**, and `MODULE_TIERS` in `.dependency-cruiser.cjs` reads
`packages` — the rename from `catalog` is done. One honest cost of the name: `packages` as an
API module sits awkwardly beside the monorepo's own `packages/` directory, and prose has to say
"the packages module" every time to stay unambiguous. `catalog` avoided that. Consistency with
the code that already exists wins, but the collision is real and worth knowing about.

```ts
/** Read-only. quotes calls this; it cannot write a package. */
export interface PackageLookupContract {
  /** Exactly one package, or a typed reason why none applies. */
  resolveForTrip(input: TripContext): Promise<PackageMatch | Unavailable>;
}
```

There is no `PackageAdminContract` in the code, deliberately. Admin CRUD is reachable over HTTP
and nowhere else: the band-overlap guard (P-2) and the has-an-active-price guard (P-3) live in
the admin use cases, and a second in-process write path would make both a convention rather than
a guarantee. Add one when a module genuinely needs to author a package.

`resolveForTrip` returns **one** match. It does not hand back a list for the caller to rank —
the precedence ladder is this module's rule, and a caller applying it independently is a caller
that will eventually apply it differently.

### Admin surface

`POST/GET/PUT` on `/admin/packages/incity` and `/admin/packages/outstation`, with nested
variants and prices. The editors, the live commission-split preview and the band-coverage strip
are specified in [`admin-panel.md`](admin-panel.md).

### What is built, and what is still open

| Gap | Blocked on |
|---|---|
| The `unservedDistanceRequests` write on `NO_PACKAGE_FOR_DISTANCE` | Nothing owns that collection yet |
| An audit port and adapter | Nothing. Every admin write in `zones` records one; none in `packages` do |
| `incity.max_distance_multiple` moving into the `settings` registry | Nothing — it is a constant `2` in `resolveForTrip.usecase.ts`. A key is added when the code reading it is written |
| Rung (c) comparing a full computed total rather than the band fare | The `pricing` module |

Closed since: the DTO mapper and `packages.typecheck.ts` (the controllers used to put camelCase
domain entities on the wire against snake_case contracts, which silently broke the zones screen's
package count), and the whole per-car-category price model.

## Deliberately deferred

| Deferred | Trigger |
|---|---|
| Per-hill-zone pricing | Ops wants Darjeeling and Kalimpong to differ. `resolveAt` already returns *which* hill zone, so this is a key change, not new plumbing |
| Route-based terrain | Drivers report specific routes as underpaid. `classifyTerrain` is retained, tested, and unused |
| Multi-day outstation | `open-questions.md` Q4 closes. Different driver economics, genuinely a different product |
| Per-pickup-zone catalogues | The paid zone needs to sell something the free zone does not |
