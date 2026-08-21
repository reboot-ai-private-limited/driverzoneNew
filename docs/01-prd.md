# 01 — Product Requirements

## 1. Problem

Customers who own a car often need a **driver**, not a cab. Existing options are informal
(local agents, WhatsApp groups) with no price transparency, no verification, and no
accountability when a driver doesn't show up.

DriverZone supplies vetted drivers on demand, with fixed published pricing that varies by
geography — because a driver's cost is genuinely different in Siliguri vs Kolkata, and a
hill route is genuinely harder than a plains route.

**Geography is the core of the product, not a detail.** Every price, every availability
decision, and every dispatch flows from which polygon a point falls in.

## 2. Users

| Actor | Surface | Primary jobs |
|-------|---------|--------------|
| **Customer** | Mobile app (iOS/Android) | Book a driver now or later, see a fixed price up front, track the driver, pay, rate |
| **Driver** | Mobile app (Android-first) | Go on duty, receive and accept trip offers, navigate, start/end trips, see earnings |
| **Operations admin** | Web panel | Draw zones, configure packages and pricing, monitor live trips, reassign drivers, resolve failures |
| **Finance admin** | Web panel | Reconcile commissions, run driver payouts, handle disputes |
| **Super admin** | Web panel | Global settings, user roles, audit trail |

Android-first for drivers is deliberate — the driver population is effectively all Android.

## 3. Core concepts

### 3.1 Zones

A **zone** is a named polygon drawn by an admin. Three types:

- **CITY** — the operational boundary of a city (Siliguri, Kolkata, Asansol, Patna,
  Coochbehar). Defines what counts as "incity."
- **PICKUP** — a sub-area *inside* a city zone where we actually have driver supply.
  Every pickup zone is either `FREE` (no pickup fee) or `PAID` (a pickup fee applies).
  A city zone is typically covered by several pickup zones with gaps between them; the
  gaps are areas we don't serve yet.
- **HILL** — a classifier polygon used to decide whether an outstation route is hill or
  plains terrain. Independent of city boundaries; may span multiple districts.

### 3.2 Services

**InCity** — an hourly driver rental within one city.
- Belongs to exactly one CITY zone
- Available from one or more PICKUP zones inside that city
- Offered as **variants**: 3 hours, 10 hours, etc., each with included km, a base fare,
  overage rates, and a commission split
- Price also depends on the customer's car category

**Outstation** — a point-to-point trip out of the city.
- Matched by **road distance band** (e.g. 70–100 km) and **terrain** (hill / plain)
- Available from one or more PICKUP zones
- Priced separately for **one-way** and **round-trip**
- Price also depends on car category

### 3.3 Pickup fee

If the customer's pickup point falls in a `PAID` pickup zone, a pickup fee is added.
The amount comes from the zone if set, otherwise from global settings.

## 4. Functional requirements

### 4.1 Admin — zone management
- FR-Z1 Draw, edit, and delete zone polygons on an interactive map
- FR-Z2 Import a polygon from GeoJSON; export any zone as GeoJSON
- FR-Z3 A PICKUP zone **must** be fully contained within its parent CITY zone, enforced on
  save. Saving an out-of-bounds polygon is rejected with a map preview of the violation.
- FR-Z4 Two active zones of the same type must not overlap, enforced on save
- FR-Z5 Polygons must be topologically valid (no self-intersection), enforced on save
- FR-Z6 Deleting/deactivating a zone that has active packages or in-flight bookings is
  blocked with an explanation of what depends on it
- FR-Z7 Every zone change is versioned and audited (who, when, previous geometry)

### 4.2 Admin — package & pricing management
- FR-P1 Create incity packages: city zone, applicable pickup zones, variants
- FR-P2 Per variant: included hours, included km, and per car category — base fare,
  extra-hour rate, extra-km rate, driver commission, company commission
- FR-P3 Create outstation packages: name, terrain, distance band, applicable pickup zones,
  and per car category × direction — base fare, extra-km rate, driver allowance, commissions
- FR-P4 Overlapping outstation distance bands for the same pickup zone + terrain are
  rejected on save (ambiguous match)
- FR-P5 Price changes never alter already-confirmed bookings
- FR-P6 Preview tool: enter a pickup/drop pair, see exactly what the customer would be
  quoted and why — including which zones matched

### 4.3 Admin — operations
- FR-O1 Live map of on-duty drivers and in-flight trips
- FR-O2 Manually assign or reassign a driver to any booking, with a mandatory reason
- FR-O3 Queue of bookings that found no driver, with time-in-queue
- FR-O4 Alert feed for configuration faults detected at runtime (see FR-B4)
- FR-O5 Cancel a booking on the customer's behalf with a waiver option on the fee

### 4.4 Customer — booking
- FR-B1 Enter pickup and drop points (map pin, search, or saved address)
- FR-B2 If the pickup point is in no PICKUP zone → *"We don't have drivers at your pickup
  location yet."* Offer to notify the customer when coverage arrives, and log the point —
  this is the expansion signal.
- FR-B3 If the drop point is outside the pickup point's CITY zone → *"This looks like an
  outstation trip"* with a one-tap switch that carries the entered points across.
- FR-B4 If the pickup point's PICKUP zone is not inside a CITY zone (a configuration
  fault that should be impossible — see FR-Z3) → show a generic retry message, never
  expose the cause, and raise a high-priority admin alert
- FR-B5 Show variants with a fully itemised fare — base, pickup fee, taxes, total — plus
  what is included and what overage costs
- FR-B6 Select car category; the price updates
- FR-B7 Book immediately or schedule for a future date/time
- FR-B8 Live driver tracking, driver contact via masked number, share-trip link
- FR-B9 Cancel with the applicable fee shown *before* confirming

### 4.5 Driver
- FR-D1 Go on/off duty; dispatch only considers on-duty drivers
- FR-D2 Receive a full-screen trip offer with a visible countdown; accept, decline, or
  let it lapse
- FR-D3 Accepting a taken trip fails gracefully — *"This trip was taken by another driver"*
- FR-D4 Navigate to pickup, mark arrived, start the trip with the customer's OTP, end trip
- FR-D5 Earnings view: per-trip breakdown, cash collected, commission owed, payout history
- FR-D6 Documents (licence, ID) with expiry tracking; expired documents block going on duty

## 5. Non-functional requirements

| | Target |
|---|---|
| Zone resolution (point → zones) | p99 < 50 ms |
| Quote generation end-to-end | p99 < 800 ms (road-distance call dominates) |
| Driver offer delivery | p95 < 3 s from dispatch |
| Live location freshness | ≤ 5 s during an active trip |
| API availability | 99.5% |
| Concurrent on-duty drivers (yr 1) | 2,000 |
| Data residency | India region |

## 6. Explicit non-goals for v1

- Surge / dynamic pricing — the fixed-price promise is the differentiator
- Driver-to-customer bidding or negotiation
- Cab/vehicle supply (we supply drivers only; the customer's car is used)
- Multi-city outstation chaining (A→B→C)
- Corporate accounts and monthly invoicing
- Subscriptions
- iOS driver app

## 7. Success metrics

| Metric | Why it matters | Target |
|--------|----------------|--------|
| Quote → booking conversion | Is the price acceptable? | > 35% |
| Booking → driver assigned | Supply adequacy | > 92% |
| Median time to assignment | Customer experience | < 90 s |
| `NO_DRIVER_FOUND` rate | The number that kills the product | < 5% |
| Driver offer acceptance rate | Supply engagement health | > 60% |
| `ZONE_NO_PICKUP_COVERAGE` hits | Where to expand next | tracked, not targeted |
| Config-fault alerts (FR-B4) | Should be zero | 0 |

## 8. Key product risks

| Risk | Mitigation |
|------|-----------|
| No drivers in a zone → dead-end for the customer | Waitlist capture + coverage heatmap drives expansion |
| Hourly overage disputes ("I was only 20 min late") | OTP-gated start, server-authoritative clock, itemised receipt, grace period |
| Drivers cherry-picking long trips | Acceptance-rate scoring feeds wave-1 ranking |
| Cash-collected commission leakage | Wallet balance goes negative; blocked from duty past a threshold |
| Admin misdraws a polygon and kills a city | Write-time validation + preview + versioned rollback |
