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
Settings           global settings, rendered from the API's own registry
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

Neither editor prices by car category. Both used to, and the incity one was a five-row grid per
variant while the outstation one was ten rows per band, nine of which read `not sold`. Retired
2026-08-28 ([`../decision-log.md`](../decision-log.md)).

### InCity

```
Package "Siliguri Hourly"     City [Siliguri ▾]     [Active ✓]

              Sold from every pickup zone. Packages do not reference pickup
              zones — the zone gates serviceability and adds its fee, and
              that is the whole of its job (zones.md).

Variants                                              [+ Add variant]
┌────────────────────────────────────────────────────────────────────┐
│ ▸ 3 Hours    180 min · ₹900                                        │
│ ▾ 10 Hours   600 min · ₹2,200                                      │
│     Label [10 Hours]   Included time [600] min                     │
│     Base fare ₹[2200]  Driver's share [75]%                        │
│     [✓] Active                                                     │
│     ──────────────────────────────────────────────────────────     │
│     Base fare ₹2,200 · Driver earns ₹1,650 · Company keeps ₹550    │
└────────────────────────────────────────────────────────────────────┘
```

A variant is a duration and a price. The included-km cap, both overage rates, the
destination-enforcement flag and the sort order were all removed 2026-08-28
([`../decision-log.md`](../decision-log.md)) — there is **no overage**, so `includedMinutes` tells
the driver when they are released and has no fare consequence when it is exceeded. Variants
display in the order they are listed here.

The split line is essential and is why it is on every variant: a commission error is invisible
in a form field and obvious in a rupee figure. It shows the split of the BASE FARE and says so —
there is no "customer pays" total, because the pickup fee, surcharge, insurance and tax belong
to the `pricing` module and a total assembled from half the formula is a number ops would trust
and we could not honour.

There is no unallocated-remainder warning any more. The company's share is `100% − driver's`,
derived rather than entered, so the two can no longer fail to add up.

**No city zone drawn** blocks the create form outright, with a link to `/zones`, rather than
rendering an empty picker that only explains itself after Save.

**Two active packages against one city zone** is legal — `domain-model.md` §Cardinality refuses
to hard-code the singleton — and ambiguous, since a quote returns only one. The list warns and
names the winner (cheapest active variant, then most recently created); it does not forbid it.

### Outstation

```
Band "PKG-1"   Terrain [Hills ▾]   Distance [70] – [100] km   [Active ✓]

  ⚠ This range overlaps "Hills mid" (70–150 km, same terrain). To break an
    existing band in two, use its Split action instead.

Pricing        One-way fare  ₹[2,100]
               Return fare   ₹[3,700]   the whole two-way journey;
                                        blank = this band sells no return trip
               Driver's share  [75]%    (the company keeps the rest)

               One-way ₹2,100 · Driver earns ₹1,575 · Company keeps ₹525
               Return  ₹3,700 · Driver earns ₹2,775 · Company keeps ₹925
```

The fare is **flat across the band** — 72 km and 98 km pay the same — and the band is matched on
the ONE-WAY distance. The return fare covers the whole out-and-back journey, however many days it
takes, and is set independently rather than as a multiple of the one-way.

### The band list, and the gap

```
Terrain  Distance          One-way   Return   Driver
─────────────────────────────────────────────────────────────────
PLAINS   0–70 km           ₹1,800    ₹3,200    75%    Edit  Split
PLAINS   70–100 km         ₹2,100    ₹3,700    75%    Edit  Split
PLAINS   100–150 km        ₹2,600    ₹4,500    70%    Edit  Split
PLAINS ⚠ 150 km and above    —         —        —       Add band
─────────────────────────────────────────────────────────────────
HILLS    0–70 km           ₹2,400    ₹4,100    75%    Edit  Split
HILLS  ⚠ 70 km and above     —         —        —       Add band
```

This was a proportional coverage strip. It became a table when a band stopped hiding ten price
rows behind it and started fitting in a row.

**The red rows are the whole point.** A gap in the distance bands is the failure nobody notices
until a customer hits it: an overlap is refused at write time, caught again by the nightly job
and made deterministic by read-time precedence, while a gap is caught by nobody, because nothing
is wrong with any individual band. Two adjacent bands that fail to meet is a silence. So it is
rendered as a row, in the terrain it belongs to, whose `Add band` action opens the create form
pre-filled with exactly the missing range.

Hills and plains are listed separately because they are independent ladders — the same range on
both is the expected configuration, not a conflict — and each needs to tile without a gap on its
own.

Inactive bands appear in neither ladder, matching the server's active-only overlap filter, so
they get a collapsed table below. Without it "deactivate" would read as "delete" on a resource
that has no DELETE.

### Splitting a band

Flat pricing needs many narrow bands (`open-questions.md` Q3), so "this band should really be
two" is routine. `Split` asks for a break point, shrinks the original, and creates the upper half
with the fares **copied**:

```
Split "Plains long" (0–150 km)

  Break at [ 70 ] km

  0–70 km      ₹1,800 / ₹3,200   keeps this band
  70–150 km    ₹1,800 / ₹3,200   new

  The fares are copied, not divided. Until you edit the new band, both
  halves cost the same — dividing a fare by distance would invent a
  per-km rate, and this product does not have one.
```

Two writes, in this order and no other: shrink first (a shrink cannot collide), then create (the
space is free by then). No transaction is available, so the second can fail with the first
committed — in which case the dialog says exactly that, and the range that was not created is
already a red row in the list with its `Add band` pre-filled.

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

## Settings

The tunable numbers — fare surcharges, waiting, dispatch, cancellation — at `/settings`.
Built on `GET`/`PATCH /api/admin/settings` (see
[`database-schema`](database-schema.md#globalsettings)).

**The form is not hand-built.** Every setting arrives carrying its own `group`, `label`, `unit`
and `description`, and the screen renders from that: `RUPEES` gets a `₹`-prefixed box, `MINUTES`
and `SECONDS` get a suffixed one, `TIME_WINDOW` gets a pair of time pickers. Nothing in
`features/settings/` knows any setting by name. A key added to the API's registry appears here,
correctly rendered and documented, with no frontend change at all — which is the property that
makes the registry worth having.

```
Settings                          3 unsaved changes  [Discard]  [Save changes]

These take effect within a minute, on new quotes only. Amounts are in whole rupees.

┌ Fare & surcharges ──────────────────────────────────────────────────────┐
│ Late night charge                    [Changed]        [₹ 150      ] [↺]  │
│ Added when the pickup time falls inside the late night window.           │
│ pricing.late_night_charge                             Default: 150       │
│                                                                          │
││Late night window                    [Unsaved]  [23:00] to [03:00]       │
││Pickups scheduled inside this window attract the late night charge.      │
││pricing.late_night_window            The early morning and late night    │
││                                     windows overlap.                    │
└──────────────────────────────────────────────────────────────────────────┘
```

**One save for the whole page.** The API checks cross-key rules against the configuration the
write would produce, so per-field autosave would let an incoherent pair through one request at a
time. A rejection is mapped back onto the fields that caused it — and a `SETTING_INVARIANT_VIOLATED`
names *every* key in the rule, so both sides of an overlapping pair light up rather than only the
one that was touched.

Three things that are easy to get subtly wrong here, and what this screen does instead:

- **Reset is a server action, not a local revert.** `POST /admin/settings/reset` deletes the
  override so the built-in default takes over. Typing the default value back in looks identical
  on screen and stores a row saying "deliberately 150", which a later change to the shipped
  default would then silently fail to reach.
- **A refetch does not eat unsaved work.** Resetting one field invalidates the whole query, so
  the screen reseeds; fields the admin is still editing are preserved through it by an explicit
  touched-key list. Comparing drafts to server values cannot do this — right after a reset the
  local draft still holds the override that was just deleted, so it looks edited too.
- **`refetchOnWindowFocus` is off**, unlike zones. This is a form: pulling new values under a
  half-finished edit either discards it or leaves the "changed from" baseline disagreeing with
  what is on screen. Concurrent edits are handled at save time by the server refusing an
  incoherent result, not by moving the page under someone.

Client-side validation is deliberately limited to the shape of one field — is this a whole
number, is this a real time of day — for the feedback loop. The server stays authoritative, and
the rules it holds that the client cannot are the interesting ones, because they are about pairs
of keys.

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
