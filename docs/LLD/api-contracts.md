# API Contracts

`https://api.driverzone.in/v1`

- JSON only. `snake_case` keys.
- Auth: `Authorization: Bearer <jwt>`. Separate audiences for `customer`, `driver`, `admin`.
- All coordinates in requests/responses are `{ "lat": …, "lng": … }`. The **API layer**
  swaps to GeoJSON `[lng, lat]` order via `@driverzone/geo`; no caller ever deals with that.
- Money is always `*_paise` integers, plus a preformatted `*_display` string
  (`"₹1,050"`) so every client renders identically.
- `Idempotency-Key` header is **required** on all POSTs that create or move money.

## The envelope

Every response — success and failure alike — is wrapped. The shapes are `HttpSuccessBody` and
`HttpErrorBody` in `packages/contracts/src/http.ts`, which `apps/api` imports directly so the
four clients and the server cannot drift apart.

```jsonc
// success
{
  "success": true,
  "statusCode": 200,
  "request": { "method": "POST", "url": "/v1/quotes", "requestId": "req_01J…" },
  "message": "Quote generated.",
  "data": { /* the payload documented for each endpoint below */ }
}

// failure
{
  "success": false,
  "statusCode": 409,
  "code": "QUOTE_EXPIRED",
  "request": { "method": "POST", "url": "/v1/bookings", "requestId": "req_01J…" },
  "message": "Prices have updated. Please review the new fare.",
  "data": { "quote_id": "…", "expired_at": "…" }
}
```

`message` is customer-safe and displayable as-is. `data` on an error carries only what the
*caller* needs in order to act — field-level validation errors, most often. Internal causes go to
the logs keyed by `requestId`, never into the response; `AppError` keeps the two apart via
`publicDetails` and `details`. `trace` appears outside production only.

**Every payload below is the `data` field.** The envelope is omitted from the examples for
brevity, not because those endpoints skip it.

**"We can't serve this" is not an error.** Zone-resolution outcomes return `200` with
`available: false` — see `zone-resolution.md`. This keeps genuine faults visible in
error dashboards instead of drowning in expected outcomes.

---

## Customer

### `POST /quotes`

```jsonc
{
  "service_type": "INCITY",
  "pickup": { "lat": 26.7271, "lng": 88.3953, "address": "Sevoke Road, Siliguri" },
  "drop":   { "lat": 26.7100, "lng": 88.4300, "address": "Matigara" },
  "car_category": "SEDAN",
  "scheduled_at": "2026-08-21T09:30:00+05:30",
  "direction": null
}
```

**200 — available**

```jsonc
{
  "available": true,
  "service_type": "INCITY",
  "resolution": {
    "city": { "id": "…", "name": "Siliguri" },
    "pickup_zone": { "id": "…", "name": "Siliguri Central", "charge_type": "FREE" },
    "distance_m": 8400,
    "terrain": null
  },
  "quotes": [
    {
      "quote_id": "…",
      "variant": { "id": "…", "label": "3 Hours", "included_minutes": 180, "included_km": 30 },
      "fare": {
        "lines": [
          { "code": "BASE", "label": "3 Hours / 30 km", "amount_paise": 90000, "amount_display": "₹900" },
          { "code": "PICKUP_FEE", "label": "Pickup charge", "amount_paise": 0, "amount_display": "₹0" }
        ],
        "tax_paise": 4500,
        "total_paise": 94500,
        "total_display": "₹945"
      },
      "overage": {
        "extra_minute_rate_paise": 500,
        "extra_km_rate_paise": 1200,
        "grace_minutes": 15,
        "billing_block_minutes": 30,
        "notice": "Includes 3 hours and 30 km. Beyond that: ₹150 per 30 min, ₹12 per km. 15-minute grace applies."
      },
      "expires_at": "2026-08-20T09:24:22Z"
    }
  ]
}
```

**200 — unavailable**

```jsonc
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

Every `available: false` response carries a displayable `message`. The app should never
have to build copy from a code — new reasons then render correctly on old app versions.

### `POST /bookings`

```jsonc
{ "quote_id": "…", "customer_car_plate": "WB74AB1234",
  "scheduled_at": "2026-08-21T09:30:00+05:30", "payment_mode": "CASH",
  "save_pickup_address": { "label": "HOME", "is_preferred_pickup": true },
  "save_vehicle": true }
```

`save_pickup_address` and `save_vehicle` are optional and opt-in — when present, this endpoint
calls into `identity`'s `CustomerBookingProfileContract` to upsert them onto the customer's
saved addresses/vehicles as a side effect of placing the booking, so the booking flow is the
capture point rather than a separate profile-setup step. See
`user.md` §Module contract.

**201**

```jsonc
{
  "booking": {
    "id": "…", "reference": "DZ-8F3K2M", "status": "CONFIRMED",
    "scheduled_at": "…", "is_scheduled": true,
    "dispatch_at": "2026-08-21T08:00:00+05:30",
    "start_otp": "4821",
    "fare": { "total_paise": 94500, "total_display": "₹945" },
    "cancellation_policy": {
      "free_until": "2026-08-21T08:30:00+05:30",
      "fee_after_paise": 5000
    }
  }
}
```

Idempotent on `quote_id`: replaying the same quote returns the same booking with `200`
rather than creating a second one.

### Other customer endpoints

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/bookings` | `?status=&page=` |
| `GET` | `/bookings/:id` | Includes driver details once assigned |
| `POST` | `/bookings/:id/cancel` | Body `{ reason }`; returns the fee charged |
| `GET` | `/bookings/:id/track` | Driver position + ETA; poll 5 s or use the socket |
| `GET` | `/bookings/:id/receipt` | Final itemised fare, post-completion |
| `POST` | `/bookings/:id/rate` | `{ rating, comment }` |
| `GET` | `/car-categories` | For the picker |
| `GET` | `/coverage/check?lat=&lng=` | Pre-flight, before the customer types a destination |
| `POST` | `/coverage/waitlist` | Notify me when my area is covered |

`GET /coverage/check` is worth having: it lets the app show "we serve your area" or "not
yet" on the home screen, before the customer invests effort in picking a destination. It answers
from the pickup-zone gate alone, so it also returns the charge type — the app can warn about a
paid-zone pickup fee up front rather than at the fare card.

```jsonc
{ "available": true, "pickup_zone": { "charge_type": "PAID", "charge": { "amount_paise": 10000, "amount_display": "₹100" } } }
{ "available": false, "reason": "ZONE_NO_PICKUP_COVERAGE", "message": "We don't have drivers at your pickup location yet." }
```

A miss is `available: false` at `200`, never a `404` — see `zone-resolution.md` §Error codes.
Both routes are served by the `zones` module (`zones.md`); they are the only customer-facing
routes it has.

---

## Driver

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/driver/duty` | `{ on_duty: true }` — 409 if not yet admin-verified, documents expired, or wallet blocked |
| `POST` | `/driver/location` | Batched pings; see below |
| `GET` | `/driver/offers/current` | Recovery path after an app restart mid-offer |
| `POST` | `/driver/offers/:id/accept` | The atomic claim |
| `POST` | `/driver/offers/:id/decline` | `{ reason? }` |
| `POST` | `/driver/bookings/:id/arrived` | |
| `POST` | `/driver/bookings/:id/start` | `{ otp }` |
| `POST` | `/driver/bookings/:id/complete` | `{ actual_distance_m, cash_collected_paise }` |
| `GET` | `/driver/earnings` | `?from=&to=` — ledger view |
| `GET` | `/driver/schedule` | Upcoming assigned trips |

### `POST /driver/location`

```jsonc
{ "pings": [
  { "lat": 26.72, "lng": 88.39, "accuracy_m": 12, "heading": 178,
    "speed_mps": 8.3, "recorded_at": "2026-08-20T09:14:22Z" }
]}
```

Batch 5–10 pings per request, every 10–15 s. Never one HTTP request per GPS fix — that
drains driver batteries and costs you a driver base. The app buffers when offline and
flushes on reconnect, which is why `recorded_at` is client-supplied and the array is
ordered.

Server writes to Redis (live) and appends to the trip trace during an active trip. It does
**not** write `drivers.last_location` on every ping — see `architecture.md`.

### `POST /driver/offers/:id/accept`

**200 — won**

```jsonc
{ "claimed": true, "booking": { "id": "…", "reference": "DZ-8F3K2M",
    "pickup": {…}, "drop": {…}, "customer": { "name": "…", "masked_phone": "…" },
    "earning_paise": 70875, "earning_display": "₹708.75" } }
```

**200 — lost the race**

```jsonc
{ "claimed": false, "reason": "ALREADY_ASSIGNED",
  "message": "This trip was just taken by another driver." }
```

`200`, not `409`. Losing a race is a normal outcome of a correct system, and it must not
count against the driver's acceptance rate.

---

## Admin

| Method | Path | Notes |
|--------|------|-------|
| `GET/POST` | `/admin/zones` | `POST` body carries GeoJSON. `201` on create |
| `GET/PATCH` | `/admin/zones/:id` | `PATCH` is **metadata only** — name, code, priority, pickup charge |
| `PATCH` | `/admin/zones/:id/geometry` | Its own route: creates a new version, takes `expected_version` |
| `DELETE` | `/admin/zones/:id` | Soft deactivate; returns the updated zone |
| `POST` | `/admin/zones/validate` | **Dry run** — returns violations without saving. Always `200` |
| `GET` | `/admin/zones/:id/versions` | Version history, newest first |
| `GET` | `/admin/zones/:id/dependents` | What breaks if this is deactivated |
| CRUD | `/admin/packages/incity` | + nested variants and prices |
| CRUD | `/admin/packages/outstation` | + nested prices |
| `POST` | `/admin/pricing/preview` | The FR-P6 what-would-the-customer-see tool |
| `GET` | `/admin/bookings` | Rich filters: status, zone, date, driver |
| `POST` | `/admin/bookings/:id/reassign` | `{ driver_id?, reason }` — reason required |
| `POST` | `/admin/bookings/:id/cancel` | `{ reason, waive_fee }` |
| `GET` | `/admin/dispatch/queue` | Bookings with no driver, oldest first |
| `GET` | `/admin/drivers/live` | Positions for the ops map |
| CRUD | `/admin/drivers` | + document verification |
| `GET/PATCH` | `/admin/settings` | Global settings |
| `GET` | `/admin/alerts` | Config faults and operational alerts |
| `GET` | `/admin/coverage/heatmap` | Clustered `coverage_requests` — where to expand |

### `POST /admin/zones/validate`

The most important admin endpoint. Runs every invariant check against a candidate polygon
and returns violations **without writing anything**, so the map editor gives live feedback
as the admin draws rather than an error after they hit Save.

```jsonc
// request
{ "type": "PICKUP", "geometry": { "type": "Polygon", "coordinates": […] } }

// response — 200, because a violation is a valid answer, not a request error
{
  "valid": false,
  "violations": [
    { "rule": "Z-2", "severity": "ERROR",
      "message": "Overlaps active PICKUP zone \"Siliguri Central\".",
      "offending_geometry": { "type": "Polygon", "coordinates": […] } },
    { "rule": "Z-COMPLEXITY", "severity": "WARN",
      "message": "612 vertices. The editor will feel sluggish above ~500." }
  ],
  "stats": { "area_km2": 12.4, "existing_bookings_in_area": 843 }
}
```

`offending_geometry` is the key detail: the editor renders it in red directly on the map,
so the admin sees precisely which corner is wrong instead of guessing.

### `POST /admin/pricing/preview`

Same request shape as `POST /quotes`, but the response includes the full resolution trace:
which zones matched, which packages were considered and why each was accepted or rejected,
and the fare arithmetic step by step. This is how ops debugs "why is this customer seeing
the wrong price" without opening a database console.

---

## Realtime (Socket.IO)

```
namespace /customer   auth: customer JWT
  join  booking:{id}
  recv  booking.status_changed  { status, at }
  recv  driver.location         { lat, lng, heading, eta_seconds }
  recv  booking.driver_assigned { driver: {…} }

namespace /driver     auth: driver JWT
  join  driver:{id}
  recv  offer.new        { offer_id, booking, expires_at, earning_paise }
  recv  offer.cancelled  { offer_id, reason }   ← closes a ringing screen instantly
  recv  booking.updated  { booking_id, status }
  emit  location.ping    { lat, lng, … }

namespace /admin      auth: admin JWT
  join  ops
  recv  dispatch.queue_changed
  recv  alert.raised     { severity, code, message }
```

`offer.cancelled` matters more than it looks: without it, a driver who lost a race keeps a
full-screen offer ringing until the TTL expires, taps it, and gets an error. Push the
dismissal the moment another driver claims the trip.
