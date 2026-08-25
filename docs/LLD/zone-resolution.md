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

Recommended refinement:

| Variant length | Destination handling |
|----------------|----------------------|
| ≤ 4 hours | Hard block if outside city — a 200 km drop genuinely is the wrong product |
| > 4 hours | **Advisory only.** Show *"Your drop-off is outside <City>. Extra distance beyond <N> km will be charged at ₹<r>/km."* Let the booking through. |

The included-km cap plus the extra-km rate already price the risk correctly. The hard
block adds nothing for long variants except lost bookings.

Implement as a per-variant boolean `enforce_drop_in_city`, defaulted from
`included_minutes <= 240`, so operations can tune it per package without a deploy.

## Outstation resolution

```
resolveOutstation(from, to, direction, carCategoryId) -> Quote[] | Error

 1. fromZones ← resolveZones(from)
 2. if fromZones.pickup is null → ERROR ZONE_NO_PICKUP_COVERAGE

 3. route ← routing.route(from, to)          -- OSRM; see §Road distance
    if route is null → ERROR ROUTE_NOT_FOUND

 4. terrain ← classifyTerrain(route)         -- see §Terrain

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
        → alert admin; pick lowest total for the customer, never the highest
          (silently over-charging on a config error is far worse than under-charging)

 9. fare ← computeOutstationFare(...)
10. persist quote, return
```

### Road distance, not straight-line

Straight-line (haversine) distance under-reports by 30–50% in hill terrain. With 70–100 km
bands, that error puts trips in the wrong band constantly and mis-prices them.

Use **OSRM**, self-hosted on the India OSM extract:

```
GET /route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson
→ { routes: [ { distance: 87421.3, duration: 7200.1, geometry: {...} } ] }
```

Self-hosting is the right call here — Google Distance Matrix priced per call becomes a
meaningful line item once every quote request hits it, and quote requests are ~3× booking
volume. One `c6g.xlarge` handles the India extract comfortably.

**Cache** on an H3 cell pair at resolution 8 (~460 m edge), TTL 30 days:

```
key: route:{h3(from,8)}:{h3(to,8)}
val: { distance_m, duration_s, polyline }
```

Hit rate in practice runs 60–80% because pickup and drop points cluster hard around towns
and landmarks. Store the polyline in the cache too — terrain classification needs it.

### Terrain classification

Do **not** classify on the destination point alone. Siliguri → a plains town reached only
by crossing a hill stretch is a hill trip for the driver, and pricing it as plains
under-pays them.

Classify on **route intersection**. MongoDB can find the candidate hill zones but cannot
measure how much of the route lies inside one — there is no `$geoIntersection` and no length
aggregation — so this is a two-step: narrow in the database, measure with Turf.

```ts
// 1. Which hill zones does this route touch at all? Indexed, cheap.
const hillZones = await Zone.find({
  isActive: true,
  type: 'HILL',
  geometry: { $geoIntersects: { $geometry: routeLineString } },
}).lean();

// 2. How many metres are actually inside them? @driverzone/geo, in process.
const { terrain, hillMetres } = classifyTerrain(
  routeLineString,
  hillZones.map((z) => z.geometry),
  settings['outstation.hill_route_threshold_m'],
);
```

`classifyTerrain` splits the route on each polygon boundary and sums the segments whose
midpoint falls inside — the midpoint rather than a vertex, because a split vertex sits exactly
*on* the boundary where point-in-polygon is a coin flip. Zones are summed independently, which
is safe because Z-2 forbids two active hill zones from overlapping, so no stretch is
double-counted.

Default threshold 5,000 m. A route that clips a hill zone corner for 800 m is not a hill
trip; one that spends 30 km climbing is.

The 5 km threshold is a guess and should be tuned once there's real data — the metric to
watch is driver complaints about specific routes being under-paid.

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
- route grazing a hill zone for 500 m → `PLAIN`
- route through 30 km of hill zone → `HILL`
