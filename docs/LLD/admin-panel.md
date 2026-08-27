# Admin Panel

The admin panel is not a CRUD afterthought — it is where every price and every service
boundary in the product is defined. A mistake here takes a city offline.

## Roles

| Role | Can |
|------|-----|
| `SUPER_ADMIN` | Everything, including global settings and role assignment |
| `OPS_ADMIN` | Zones, packages, pricing, bookings, reassignment, drivers |
| `OPS_AGENT` | View bookings, reassign, cancel, contact — no pricing or zone edits |
| `FINANCE` | Ledger, payouts, disputes — read-only on operations |
| `VIEWER` | Read-only dashboards |

Pricing and zone editing sit behind `OPS_ADMIN` deliberately. Support agents need to fix
bookings at 11 pm; they do not need to be able to change the price of every trip in
Siliguri.

## Screens

```
Dashboard          live KPIs, active trips map, alerts
Zones              map editor + typed rail: city card, pickup pair, hill list
Packages
  ├ InCity         per city → variants → per-car pricing
  └ Outstation     distance bands → per-car × direction pricing
Pricing Preview    the "what would the customer see" tool
Bookings           filterable list → detail with full event timeline
Dispatch Queue     unassigned bookings, oldest first
Drivers            list, documents, verification, wallet, duty history
Live Map           on-duty drivers + in-flight trips
Finance            earnings ledger, payout batches, negative balances
Coverage           heatmap of failed lookups — the expansion roadmap
Settings           global settings with inline documentation
Audit Log          every admin action, filterable
```

## The zone editor

This is the most important screen in the panel. Get it right and the whole class of
configuration faults in `zone-resolution.md` disappears.

### Layout

One Coverage screen. There is no city switcher and no zone tree, because there is no hierarchy
left to draw — the three types are flat and independent (`domain-model.md`).

```
┌───────────────────────────────────────────────────────────────────────┐
│ Zones                                          [ Map | List ]         │
├──────────────────────────┬────────────────────────────────────────────┤
│ ╭──────────────────────╮ │ [Map|Satellite|Terrain]  [search…]         │
│ │ CITY BOUNDARY        │ │                                            │
│ │ Siliguri · SLG       │ │              MAP                           │
│ │ 148.2 km² · v3       │ │         (Google Maps JS API)               │
│ │ ──────────────────── │ │                                            │
│ │ Defines incity.      │ │   ── city boundary   (blue, DASHED always) │
│ │ Siliguri Hourly →    │ │   ── pickup zone     (green fill, FREE)    │
│ │ [ Edit boundary ]    │ │   ── pickup zone     (amber fill, PAID)    │
│ ╰──────────────────────╯ │   ── hill zones      (violet)              │
│                          │   ── the draft       (interactive, dashed) │
│ PICKUP · 2               │   ── violation       (red)                 │
│ 34% of Siliguri covered  ├────────────────────────────────────────────┤
│ • Central       FREE     │ Name [Siliguri Paid North]  Code [SLG-PN]  │
│ • Paid North    PAID     │ Charge [PAID ▾]  Fee ₹[100] (blank=global) │
│ [+ Pickup zone]          │ Area 12.4 km²  Vertices 34  [Import GeoJSON]│
│                          │                                            │
│ HILL · 4                 │ ⚠ Overlaps active PICKUP zone "Central"    │
│ • Darjeeling             │   [Show]                                   │
│ • Kalimpong              │                                            │
│ [+ Hill zone]            │ Saving creates version 4.                  │
│                          │        [Cancel]  [Save]  ← disabled        │
└──────────────────────────┴────────────────────────────────────────────┘
```

**Three types, three renderings — this is the point of the screen.** A table gives every zone
the same row, and the three types are not the same kind of thing. The tell was already there in
the old one: a `Pickup charge` column reading `—` on five rows out of seven. Sparse columns mean
sparse *entities*.

| | Cardinality | Renders as |
|---|---|---|
| CITY | exactly one, operationally | a **card**, and **no add button** — the absence is what says "setting, not collection", more plainly than any label could |
| PICKUP | a fixed pair, FREE and PAID | two rows plus the number that matters: **% of the city covered** |
| HILL | N and growing | a list |

The city card also carries **which packages sell against it**, read from
`GET /admin/packages/incity` and linked out to the package editor. `cityZoneId` is the only zone
reference either product carries ([`packages.md`](packages.md)) and it is invisible on every
other screen — so zero active packages renders as a warning, not an empty list: it means every
hourly quote returns `NO_PACKAGE_AVAILABLE`.

### Two views

`[ Map | List ]`, map by default, both in the URL alongside the selected zone so a link to "the
zone I'm asking about" is a link rather than a description.

The list is the **audit** surface — superseded versions and inactive zones, which stack
invisibly on a map — and keeps the search, sort and paging the old screen had. The map answers
what the list cannot: whether the city actually has coverage.

### Getting a shape in

**Import is the primary path, drawing is the fallback.** A municipal corporation boundary, a
subdivision — these are published and exist as OSM relations, exportable to GeoJSON in about a
minute. Tracing one by hand is slower and less accurate on any basemap, and it puts a zone edge
in the wrong place with nobody able to say by how much. `Import GeoJSON` accepts a Feature, a
FeatureCollection or a bare geometry, takes the largest polygon out of a MultiPolygon and says
so, and normalises winding on the way in so the browser's verdict matches the API's.

Hand-drawing stays for the case with no published shape — a pickup zone, which is a commercial
decision about where drivers wait rather than a line on a survey.

**Map types, and the three are not interchangeable.** *Satellite* is Google's hybrid view —
imagery **with** road labels — and it answers the question a pickup boundary actually asks: where
the built-up area ends, and what road that is. Neither layer alone answers it. *Terrain* carries
shaded relief, for the hill-zone question: the edge is a price boundary that must cover the
approach corridor, and relief is what shows where the corridor runs. *Map* is the default, being
the least visually noisy to select polygons on.

**Address search moves the map and nothing else.** The gap against a commercial basemap was never
that it fails to draw every shop — you do not trace a service boundary along a shopfront. It was
orientation: standing on a map of Siliguri and not knowing which part you are looking at. A search
box solves that directly. It never touches the draft geometry, so an admin mid-boundary who looks
up a landmark does not come back to a changed polygon.

**A hill zone's edge is a price boundary.** Terrain is decided by whether the customer's drop
point lands inside the polygon, not by measuring the route (`packages.md` §Terrain), so drawing
a hill zone *is* a pricing action. Draw it over the approach corridor, not just the summit
towns. The editor should say so when the type is `HILL`.

No Parent picker: a pickup zone is not a child of anything. A pickup zone drawn partly or wholly
outside the city boundary is **legal** — it stays serviceable for outstation, and incity quotes
from it return `PICKUP_OUTSIDE_CITY` (`zone-resolution.md`). The map still draws the city
boundary, because an admin should be able to see the relationship even though nothing enforces
it.

### Live validation

Call `POST /admin/zones/validate` (debounced ~400 ms) on every geometry change while
drawing. Never wait for Save to reveal a problem.

| Rule | Severity | Message |
|------|----------|---------|
| `Z-2` overlaps same type | ERROR | "Overlaps active PICKUP zone 'Siliguri Central'." → highlight both |
| `Z-3` invalid geometry | ERROR | "Polygon crosses itself." → mark the crossing vertex |
| `Z-MIN-AREA` | ERROR | "Too small to be a serviceable zone." |
| `Z-MAX-AREA` | ERROR | "Too large to be an operational zone." |
| `Z-COMPLEXITY` > 500 vertices | WARN | "Very detailed polygon — simplify for faster lookups." |
| pickup zone covers < 20% of city | INFO | "Only 18% of Siliguri has pickup coverage." |
| PAID with no fee and no global default | ERROR | "Set a pickup fee or configure the global default." |

**Save stays disabled while any ERROR stands.** The API refuses it anyway — `createZone` is the
invariant choke point (`zones.md`) — and the UI's job is to make sure the admin never gets that
far. The two can never disagree, because the browser runs the same `validateZone` from
`@driverzone/geo` that the API does.

Ring winding is **normalised silently**, not reported: a clockwise polygon is not an admin's
mistake to fix, it is a serialisation detail, and `@turf/rewind` handles it in the write path.

### Editing an existing zone

Geometry edits create a **new version**, they don't mutate in place:

```
1. Show impact first:
     "12 active bookings have pickups in the area you're removing."
     "This is 1 of your 2 pickup zones."
2. On save:
     INSERT new zone row (version = old.version + 1)
     UPDATE old row SET is_active = false, superseded_by = new.id
     write audit_log with before/after geometry
     (nothing to re-point: no package references a pickup zone)
3. In-flight bookings keep their original zone reference — they resolved against
   the old geometry and their fare snapshot says so.
```

A "Version history" tab shows each version with its geometry on the map, who changed it,
and a one-click restore.

### Deactivating a zone

`GET /admin/zones/:id/dependents` before anything happens:

```
Deactivating "Siliguri Central" will:
  • remove pickup coverage for ~34% of Siliguri
  • leave 8 scheduled bookings without coverage  [view them]
  • affect no packages — packages don't reference pickup zones

[Cancel]  [Deactivate anyway]
```

The case that needs its own wording is the **last** active pickup zone, because nothing else in
the UI makes the consequence obvious:

```
"Siliguri Paid" is your last active pickup zone.
Deactivating it stops ALL service — incity and outstation both.

[Cancel]  [Deactivate anyway]
```

Blocking outright is wrong — sometimes you genuinely must pull a zone. Blind
deactivation is also wrong. Show the blast radius and let a human decide.

## Package editors

### InCity

```
Package: "Siliguri Hourly"        City: Siliguri          [Active ✓]

                  Sold from every pickup zone. Packages do not reference pickup
                  zones — the zone gates serviceability and adds its fee, and
                  that is the whole of its job (zones.md).

Variants
┌──────────┬───────┬──────┬──────────────────────────────────────────┐
│ Label    │ Hours │ km   │ Pricing per car category                 │
├──────────┼───────┼──────┼──────────────────────────────────────────┤
│ 3 Hours  │  3    │  30  │ Hatchback ₹800 · Sedan ₹900 · SUV ₹1,100 │
│ 10 Hours │ 10    │ 100  │ Hatchback ₹2,200 · Sedan ₹2,500 · …      │
└──────────┴───────┴──────┴──────────────────────────────────────────┘

Expanding a variant row → per-car-category editor:

  Sedan
    Base fare              ₹ [900]
    Extra time (per 30min) ₹ [150]
    Extra distance (per km)₹ [12]
    Night charge           ₹ [100]      window: 22:00–06:00 (global)
    Driver commission      [PERCENT ▾] [75] %   → ₹675
    Company commission     [PERCENT ▾] [25] %   → ₹225
    Enforce drop in city   [ ] (auto: off for variants over 4 hours)
    ──────────────────────────────────────────────
    Customer pays ₹945 incl. tax · Driver earns ₹675 · Company ₹225
```

The live split preview at the bottom is essential. Commission errors are invisible in a
form field and obvious in a rupee figure.

### Outstation

```
Package "PKG-1"    Terrain [HILL ▾]    Distance [70] – [100] km    [Active ✓]

Pricing        ┌───────────┬───────────┬────────────┐
               │           │ One-way   │ Round trip │
               ├───────────┼───────────┼────────────┤
               │ Hatchback │ ₹1,800    │ ₹3,200     │
               │ Sedan     │ ₹2,100    │ ₹3,700     │
               │ SUV       │ ₹2,600    │ ₹4,500     │
               └───────────┴───────────┴────────────┘
               + extra ₹/km beyond 70 km, driver allowance, commission split

⚠ Band coverage for HILL:
   0–70 ✓   70–100 ✓ (this)   100–150 ✓   150+ ✗ gap
```

That coverage strip catches the failure nobody notices until a customer hits it: a gap in
the distance bands where no package matches and the customer gets
`NO_PACKAGE_FOR_DISTANCE` for a trip you'd happily take. It is now per terrain rather than per
pickup zone — two strips, `PLAIN` and `HILL`, and both must tile without a gap.

**The strip is the only guard against a gap.** Overlap is caught at save time and again by the
nightly job; a gap is caught by nobody, because nothing is wrong with any individual package.
Two adjacent bands that fail to meet is a silence, not an error — which is exactly why it needs
to be visible on the screen where bands are edited (`packages.md` §Overlap).

## Pricing preview (FR-P6)

```
Pickup [Sevoke Road, Siliguri      ] 📍
Drop   [Matigara                   ] 📍
Car    [Sedan ▾]   When [Now ▾]

                                                    [Run preview]

── Resolution ──────────────────────────────────────────────
  Pickup zone   Siliguri Central (FREE)
  City zone     Siliguri
  Drop in city  ✓ yes
  Road distance 8.4 km
── Packages considered ─────────────────────────────────────
  ✓ Siliguri Hourly      matched (pickup zone linked, city matches)
  ✗ Siliguri Premium     rejected: no Sedan price row configured
── Fare (3 Hours) ──────────────────────────────────────────
  Base                                              ₹900
  Pickup charge (FREE zone)                           ₹0
  Tax 5%                                             ₹45
  ─────────────────────────────────────────────────────────
  Customer pays                                     ₹945
  Driver earns                                      ₹675
  Company keeps                                     ₹225
```

Showing **rejected** packages with the reason is what makes this a debugging tool rather
than a calculator. "Why doesn't this customer see the premium package" gets answered by
ops in ten seconds instead of a support escalation.

## Booking detail

The event timeline from `booking_events`, rendered verbatim:

```
DZ-8F3K2M · Siliguri Hourly 3H · Sedan · ₹945

09:14:22  CONFIRMED        customer   quote consumed
09:14:23  SEARCHING        system     wave 1 · 5 drivers offered · radius 3 km
09:15:08  SEARCHING        system     wave 1 lapsed · 5 no response
09:15:08  SEARCHING        system     wave 2 · 5 drivers offered · radius 7 km
09:15:31  ASSIGNED         driver     Ramesh K. claimed (offer 4/5)
09:22:10  DRIVER_EN_ROUTE  driver
09:31:44  ARRIVED          driver     2.1 km travelled
09:33:02  STARTED          driver     OTP verified
12:41:19  COMPLETED        driver     3h 08m · 34 km · ₹945 + ₹24 extra km

[Reassign driver]  [Cancel booking]  [Contact customer]  [Contact driver]
```

Support staff should never need an engineer to explain what happened to a booking.

## Alerts

A persistent feed, with the critical ones also going to Slack/PagerDuty:

| Severity | Trigger |
|----------|---------|
| CRITICAL | `ZONE_CONFIG_FAULT` — a pickup zone resolved outside its city (should be impossible) |
| CRITICAL | `AMBIGUOUS_ZONE_MATCH` — two active zones of one type contain a point |
| HIGH | `NO_DRIVER_FOUND` rate in any zone > 15% over 1 hour |
| HIGH | Offer delivery rate < 90% over 15 minutes |
| HIGH | Scheduled booking within 2 hours still unassigned |
| MEDIUM | Serviceable pickup zone with no active package |
| MEDIUM | Driver documents expiring within 7 days |
| MEDIUM | Driver wallet below the negative threshold |
| LOW | Distance-band gap detected in an outstation configuration |
| LOW | Coverage requests clustering outside all zones (expansion signal) |

Each alert links straight to the screen that fixes it. An alert you can't act on from
where it appears gets ignored within a week.
