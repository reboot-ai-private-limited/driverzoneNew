# Zone Resolution

This is the core algorithm. Everything the customer sees flows from it.

## The single query

Resolve **all** zone memberships for a point in one indexed round trip. Do not query per
zone type, and never do point-in-polygon in application code.

```ts
await Zone.find({
  isActive: true,
  geometry: {
    $geoIntersects: { $geometry: { type: 'Point', coordinates: [lng, lat] } },
  },
}).sort({ priority: -1 }).lean();
```

Coordinates go in as `[lng, lat]` — **longitude first**. Getting this backwards is the single
most common bug in this kind of system, and it does not throw: it returns *a* result somewhere
in the Arabian Sea rather than an error, so the customer standing in a city you serve is told
you do not serve it.

Never build that array inline. `@driverzone/geo` owns the conversion and the tripwire:

```ts
import { assertPlausibleCoordinate, toGeoJsonPoint, type LatLng } from '@driverzone/geo';

async function resolveZones(p: LatLng): Promise<ResolvedZones> {
  assertPlausibleCoordinate(p, 'point');          // throws on a swap or an unpopulated 0,0

  const zones = await zoneRepo.findContaining(toGeoJsonPoint(p));
  return {
    city:   zones.find((z) => z.type === 'CITY')   ?? null,
    pickup: zones.find((z) => z.type === 'PICKUP') ?? null,
    hill:   zones.find((z) => z.type === 'HILL')   ?? null,
    all:    zones,
  };
}
```

Because of invariant **Z-2** there is at most one active zone per type containing a point.
`priority DESC` is a defensive tiebreak, not the normal path — if it ever actually
disambiguates, invariant Z-2 has been violated and we want to know.

Performance: with a `2dsphere` index over a few hundred polygons this is sub-millisecond, and
stays sub-millisecond at tens of thousands. No caching layer is needed; adding one only
introduces staleness after an admin edits a zone.

`$geoIntersects` rather than `$geoWithin`: a point exactly on a shared border is *within*
neither polygon under some interpretations but *intersects* both, and returning one result for
a border point is better than returning zero.

## InCity resolution

```
resolveInCity(from: LatLng, to: LatLng, carCategoryId) -> Quote[] | Error

 1. fromZones ← resolveZones(from)

 2. if fromZones.pickup is null
        → ERROR ZONE_NO_PICKUP_COVERAGE
          "We don't have drivers at your pickup location yet."
          side effect: log coverage_requests(point, customer_id, timestamp)
                       this table is the expansion roadmap

 3. if fromZones.city is null
        → PICKUP_OUTSIDE_CITY
          "Hourly rentals aren't available from this pickup point.
           Try an outstation trip."
          payload carries: suggested_service = 'OUTSTATION', from, to
          NOT a fault. A pickup zone is a serviceability gate, not a child of a city
          (zones.md) — a pickup point outside the city is simply a point we will not
          sell an hourly rental from.

 4. toZones ← resolveZones(to)

 5. if toZones.city is null OR toZones.city.id != fromZones.city.id
        → DROP_OUTSIDE_CITY
          "That drop-off is outside <City>. This looks like an outstation trip."
          payload carries: suggested_service = 'OUTSTATION', from, to
          the app switches tab and keeps both points — no re-entry

 6. packages ← incity packages where
        city_zone_id = fromZones.city.id
        AND is_active
        -- no pickup-zone filter. Packages do not reference pickup zones; the pickup
        -- zone has already done its whole job at step 2. See zones.md.

 7. if packages is empty
        → NO_PACKAGE_AVAILABLE
          "No packages are configured for your area right now."
          side effect: admin alert (a serviceable pickup zone with nothing to sell
                       is a configuration gap, not a customer problem)

 8. variants ← active variants of those packages,
                with an active price row for carCategoryId,
                ordered by included_minutes

 9. for each variant: fare ← computeInCityFare(variant, carCategory, fromZones.pickup, when)
10. persist quotes, return them
```

Step 2 is the only serviceability gate, and it is shared with outstation. Steps 3 and 5 are
about the *product*: an hourly rental only makes sense when both ends sit inside the city we
sell hourly rentals in. Neither is a fault — both hand the customer outstation instead.

### On step 5 — the destination check

**This rule is too strict for long variants.** For a 10-hour rental the destination is
mostly a formality: the customer is doing errands, multiple stops, possibly a nearby town
and back. Hard-blocking on `to ∉ city` will reject bookings you want to take.

**Resolved 2026-08-28, and not the way this section recommended.** There is no destination rule
at all: `enforce_drop_in_city` was deleted along with the 4-hour threshold it was defaulted from
(`open-questions.md` Q1, [`../decision-log.md`](../decision-log.md)).

The drop point still decides the PRODUCT — inside the city zone is incity, outside is outstation —
it just no longer blocks or warns. The refinement above leaned on "the included-km cap plus the
extra-km rate already price the risk"; both were removed the same day, so the risk is now unpriced
rather than priced differently.

## Outstation resolution

```
resolveOutstation(from, to, direction, carCategoryId) -> Quote[] | Error

 1. fromZones ← resolveZones(from)
 2. if fromZones.pickup is null → ERROR ZONE_NO_PICKUP_COVERAGE

 3. toZones ← resolveZones(to)
    terrain ← toZones.hill ? 'HILL' : 'PLAIN'     -- see §Terrain
    no extra query: the same $geoIntersects that resolves the city resolves the hill zone

 4. route ← routing.route(from, to)          -- OSRM; see §Road distance
    if route is null → ERROR ROUTE_NOT_FOUND

 5. distanceKm ← ceil(route.distance_m / 1000)

 6. packages ← outstation packages where
        is_active
        AND terrain = terrain
        AND min_km <= distanceKm < max_km
        AND has an active price for (carCategoryId, direction)
        -- no pickup-zone filter, and no city zone either: outstation never consults
        -- the city. Step 2 already decided whether we serve this pickup point.

 7. if packages is empty
        → ERROR NO_PACKAGE_FOR_DISTANCE
          "We don't cover trips of <distanceKm> km from your area yet."
          side effect: log to unserved_distance_requests — tells ops which band to add

 8. if packages.length > 1                   -- invariant P-2 says impossible
        → alert admin; the precedence ladder in packages.md decides, and its price
          rung picks the lowest total for the customer, never the highest
          (silently over-charging on a config error is far worse than under-charging)

    NOTE: a HILL destination with no HILL band does NOT fall back to the PLAIN
          ladder. It returns NO_PACKAGE_FOR_DISTANCE — see packages.md.

 9. fare ← computeOutstationFare(...)
10. persist quote, return
```

### Road distance, not straight-line

Straight-line (haversine) distance under-reports by 30–50% in hill terrain. With 70–100 km
bands, that error puts trips in the wrong band constantly and mis-prices them.

Use the **Google Routes API** (Compute Routes), keyed to distance only:

```
POST https://routes.googleapis.com/directions/v2:computeRoutes
X-Goog-FieldMask: routes.distanceMeters
{ origin, destination, travelMode: DRIVE, routingPreference: TRAFFIC_UNAWARE }
→ { routes: [ { distanceMeters: 87421 } ] }     // {} when no route exists
```

Per-call pricing is contained rather than avoided (see the reversal in
[`../decision-log.md`](../decision-log.md) — the pilot VM cannot host an OSRM India extract).
The field mask and `TRAFFIC_UNAWARE` keep the call in the Essentials SKU ($5 / 1000, 10k free
per month); a jam must not move a fare band. `OsrmRoadDistance` stays in the tree behind
`OSRM_BASE_URL` for anyone who does self-host.

**Two things keep billable calls inside the free tier:**

1. **In-city trips never call the router.** Road distance only decides outstation bands, and
   in-city packages outrank outstation unconditionally — so `CreateQuoteUseCase` resolves the
   in-city match first and only measures the road if that misses.
2. **Cache** on a rounded-coordinate key (~110 m grid), TTL 30 days, `NO_ROUTE` cached for 1 day:

   ```
   key: roaddist:{lat.toFixed(3)},{lng.toFixed(3)}:{lat.toFixed(3)},{lng.toFixed(3)}
   val: "<km>" | "NO_ROUTE"
   ```

   Hit rate runs 60–80% because pickup and drop points cluster hard around towns and landmarks.
   The design on file is an H3 res-8 cell pair (~460 m); rounded coordinates are finer and need
   no dependency. Redis is not a hard dependency — a miss or an outage falls through to the API.

Distance only, no geometry: the route polyline was only ever fetched so terrain classification
could measure it, and terrain now comes from the destination point. We need the distance and
nothing else — a smaller response, a smaller cache value, and a cheaper call.

### Terrain

Terrain is a property of the **destination point**, not of the route.

```ts
const { city, hill } = await zones.resolveAt(to);
const terrain = hill ? 'HILL' : 'PLAIN';
```

That is the whole classifier. `resolveAt` is already running to answer the `to`-in-city question,
and it returns every zone type containing the point, so terrain costs nothing extra — no second
query, no threshold, no geometry measurement.

**This reverses the earlier route-intersection design**, which measured how many metres of the
route fell inside a hill polygon and compared that to
`outstation.hill_route_threshold_m`. That approach was more faithful in principle and worse in
practice: the threshold was an admitted guess, a contested fare could only be explained by
walking a driver through a route-length sum, and it carried a tail of geometry edge cases. See
[`packages.md`](packages.md) §Terrain and the decision-log entry.

**The cost, stated plainly:** a plains destination reached only by crossing a hill stretch now
prices as `PLAIN`, and the driver is underpaid for the hardest part of the job.

**The mitigation is where the polygon gets drawn.** A hill zone's edge is now a price boundary,
so it must cover the *approach corridor* and not just the summit towns. If a destination is
reached through the hills, the road to it belongs inside the hill polygon.

`classifyTerrain` and `hillMetresOnRoute` are retained in `@driverzone/geo`, tested but unused.
Reviving route-based classification is a wiring change rather than a rewrite — the trigger is
drivers reporting specific routes as underpaid.

## Error codes

| Code | HTTP | Customer message | Side effect |
|------|------|------------------|-------------|
| `ZONE_NO_PICKUP_COVERAGE` | 200¹ | "We don't have drivers at your pickup location yet." | Log to `coverage_requests`; offer waitlist |
| `PICKUP_OUTSIDE_CITY` | 200¹ | "Hourly rentals aren't available from this pickup point. Try an outstation trip." | Return `suggested_service: OUTSTATION` + both points |
| `DROP_OUTSIDE_CITY` | 200¹ | "That drop-off is outside \<City\>. This looks like an outstation trip." | Return `suggested_service: OUTSTATION` + both points |
| `NO_PACKAGE_AVAILABLE` | 200¹ | "No packages are available for your area right now." | Admin alert — serviceable zone with nothing to sell |
| `NO_PACKAGE_FOR_DISTANCE` | 200¹ | "We don't cover \<N\> km trips from your area yet." | Log to `unserved_distance_requests` |
| `ROUTE_NOT_FOUND` | 200¹ | "We couldn't find a driving route between these points." | Log; often a bad map pin (in water, wrong country) |
| `ZONE_CONFIG_FAULT` | 500 | "Something went wrong. Please try again shortly." | **High-priority admin alert.** Never expose the cause. Narrow since pickup zones lost their parent link — there is no longer a pickup/city relationship that can disagree. |
| `AMBIGUOUS_ZONE_MATCH` | 500 | as above | High-priority alert; invariant Z-2 breached |
| `QUOTE_EXPIRED` | 409 | "Prices have updated. Please review the new fare." | Re-quote automatically and show a diff |

¹ These are **expected outcomes**, not errors. Returning HTTP 200 with a typed
`unavailable` result keeps them out of your error dashboards and lets the app render a
helpful screen instead of a generic failure. Reserve 4xx/5xx for genuine faults.

```jsonc
// 200 OK — a normal "we can't serve this" answer
{
  "available": false,
  "reason": "DROP_OUTSIDE_CITY",
  "message": "That drop-off is outside Siliguri. This looks like an outstation trip.",
  "suggestion": {
    "service_type": "OUTSTATION",
    "pickup": { "lat": 26.7271, "lng": 88.3953 },
    "drop":   { "lat": 27.0410, "lng": 88.2663 }
  }
}
```

## Coverage intelligence

Two collections that cost almost nothing and are worth a great deal: `coverageRequests` and
`unservedDistanceRequests`. Schemas in [`database-schema.md`](database-schema.md); the write
obligation — log a row only when a lookup genuinely resolved to nothing, never on a validation
error or a retry — is on `ZoneResolutionContract` in [`zones.md`](zones.md).

Every failed lookup becomes a demand signal. Cluster `coverageRequests` and you have a ranked
list of exactly where to draw the next pickup zone — and when you draw it, you can notify
everyone who asked.

## Testing this

Zone logic is the highest-risk code in the system and the easiest to test — it's a pure
function of geometry.

Fixtures live in `packages/geo/test/fixtures.ts` and model a real place, because reasoning
about "is this polygon inside that one" is far easier when the shapes correspond to somewhere
you can picture.

```ts
SILIGURI_CITY        // CITY,   lng 88.35–88.50, lat 26.65–26.78
CENTRAL_PICKUP       // PICKUP, FREE, well inside
PAID_PICKUP          // PICKUP, PAID, shares CENTRAL's edge exactly
EASTERN_PICKUP       // PICKUP, shares CENTRAL's east edge exactly
STRADDLING_PICKUP    // PICKUP, crosses the north city boundary — legal now, and the half
                     //         outside the city is what drives PICKUP_OUTSIDE_CITY
DARJEELING_HILLS     // HILL
```

Cases every implementation must pass:

- point in a pickup zone → resolves city + pickup
- point in the city but in a coverage gap → `ZONE_NO_PICKUP_COVERAGE`
- point outside all pickup zones → `ZONE_NO_PICKUP_COVERAGE`
- point in a pickup zone but **outside the city** → `PICKUP_OUTSIDE_CITY` for incity, and a
  perfectly normal quote for outstation
- point **exactly on a shared border** between two pickup zones → exactly one result, and where
  those zones are `FREE` and `PAID` it must be the `FREE` one
- drop in the same city → variants returned
- drop in a different city → `DROP_OUTSIDE_CITY` with a suggestion payload
- drop 200 m outside the city boundary → `DROP_OUTSIDE_CITY` (verify no float slop)
- lat/lng swapped → **rejected by the bounds guard**, not silently resolved to the wrong place.
  `assertPlausibleCoordinate` in `@driverzone/geo` covers India (lat 6–37.6, lng 68–97.5) and
  names the swap in the error, because that is nearly always the cause.
- a zone saved with a **clockwise** exterior ring → stored counter-clockwise, and resolves
  normally. Left unnormalised MongoDB reads it as the whole earth minus the shape, silently
  (`zones.md` §Why MongoDB geo).
- pickup zone deactivated mid-session → existing quote still honoured, new quotes fail
- **drop point inside a hill zone → `HILL`; drop point outside every hill zone → `PLAIN`**,
  regardless of what the route between them crosses
- drop point exactly on a hill-zone border → resolves, and resolves the same way twice
- drop point inside a hill zone that also overlaps the city zone → both candidates exist and
  incity wins on precedence (`packages.md`). Legal: Z-2 only forbids same-*type* overlap
