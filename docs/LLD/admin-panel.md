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
Zones              tree: City → Pickup zones; map editor; hill zones
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

```
┌──────────────┬────────────────────────────────────────────┐
│ ZONES        │                                            │
│              │                                            │
│ ▾ Siliguri   │              MAP                           │
│   • Central  │      (MapLibre + Mapbox Draw)              │
│   • Outskirts│                                            │
│   • Matigara │   ── city boundary   (blue, dashed)        │
│ ▸ Kolkata    │   ── pickup zones    (green fill, FREE)    │
│ ▸ Asansol    │   ── pickup zones    (amber fill, PAID)    │
│ ▸ Patna      │   ── hill zones      (brown hatch)         │
│ ▸ Coochbehar │   ── violation       (red, animated)       │
│              │                                            │
│ HILL ZONES   ├────────────────────────────────────────────┤
│ • Darjeeling │ Name  [Siliguri Outskirts        ]         │
│ • Kalimpong  │ Type  [PICKUP ▾]  Parent [Siliguri ▾]      │
│              │ Charge[PAID  ▾]   Fee ₹[100] (blank=global)│
│ [+ New Zone] │ Area  12.4 km²    Vertices 34              │
│              │                                            │
│              │ ⚠ Extends 0.42 km² outside Siliguri        │
│              │   [Show on map] [Clip to city]             │
│              │                                            │
│              │        [Cancel]  [Save]  ← disabled        │
└──────────────┴────────────────────────────────────────────┘
```

### Live validation

Call `POST /admin/zones/validate` (debounced ~400 ms) on every geometry change while
drawing. Never wait for Save to reveal a problem.

| Rule | Severity | Message |
|------|----------|---------|
| `Z-1` pickup ⊄ city | ERROR | "Extends 0.42 km² outside Siliguri." → render the spill in red |
| `Z-2` overlaps same type | ERROR | "Overlaps active PICKUP zone 'Siliguri Central'." → highlight both |
| `Z-3` invalid geometry | ERROR | "Polygon crosses itself." → mark the crossing vertex |
| area < 1 ha | ERROR | "Too small to be a serviceable zone." |
| > 500 vertices | WARN | "Very detailed polygon — simplify for faster lookups." |
| pickup zone covers < 20% of city | INFO | "Only 18% of Siliguri has pickup coverage." |
| PAID with no fee and no global default | ERROR | "Set a pickup fee or configure the global default." |

**Save stays disabled while any ERROR stands.** The database trigger will reject it
anyway — the UI's job is to make sure the admin never gets that far.

### Clip to city

When a pickup polygon spills outside its parent, offer a one-click fix:

```
new_geom = ST_Intersection(drawn_geom, city_geom)
```

Show the result as a preview before applying. Redrawing 34 vertices by hand because one
corner strayed 200 m is how admins learn to work around your tool rather than with it.

### Editing an existing zone

Geometry edits create a **new version**, they don't mutate in place:

```
1. Show impact first:
     "12 active bookings have pickups in the area you're removing."
     "3 incity packages reference this zone."
2. On save:
     INSERT new zone row (version = old.version + 1)
     UPDATE old row SET is_active = false, superseded_by = new.id
     re-point package links to the new zone id
     write audit_log with before/after geometry
3. In-flight bookings keep their original zone reference — they resolved against
   the old geometry and their fare snapshot says so.
```

A "Version history" tab shows each version with its geometry on the map, who changed it,
and a one-click restore.

### Deactivating a zone

`GET /admin/zones/:id/dependents` before anything happens:

```
Deactivating "Siliguri Central" will:
  • disable 3 incity packages (no other pickup zone)
  • affect 2 outstation packages (they have other pickup zones — these keep working)
  • leave 8 scheduled bookings without coverage  [view them]
  • remove pickup coverage for ~34% of Siliguri

[Cancel]  [Deactivate anyway]
```

Blocking outright is wrong — sometimes you genuinely must pull a zone. Blind
deactivation is also wrong. Show the blast radius and let a human decide.

## Package editors

### InCity

```
Package: "Siliguri Hourly"        City: Siliguri ▾        [Active ✓]

Pickup zones      ☑ Siliguri Central   ☑ Matigara   ☐ Outskirts
                  (only zones whose parent is Siliguri are listed — invariant P-1)

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

Pickup zones   ☑ Siliguri Central  ☑ Matigara

Pricing        ┌───────────┬───────────┬────────────┐
               │           │ One-way   │ Round trip │
               ├───────────┼───────────┼────────────┤
               │ Hatchback │ ₹1,800    │ ₹3,200     │
               │ Sedan     │ ₹2,100    │ ₹3,700     │
               │ SUV       │ ₹2,600    │ ₹4,500     │
               └───────────┴───────────┴────────────┘
               + extra ₹/km beyond 70 km, driver allowance, commission split

⚠ Band coverage for Siliguri Central · HILL:
   0–70 ✓   70–100 ✓ (this)   100–150 ✓   150+ ✗ gap
```

That coverage strip catches the failure nobody notices until a customer hits it: a gap in
the distance bands where no package matches and the customer gets
`NO_PACKAGE_FOR_DISTANCE` for a trip you'd happily take.

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
