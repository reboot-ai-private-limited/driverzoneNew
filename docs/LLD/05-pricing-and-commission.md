# 05 — Pricing & Commission

## Rules

1. **Integers in paise.** Never a float. `₹1,499.50` is `149950`.
2. **The client never sends a price.** It sends a `quote_id`.
3. **Snapshot at confirmation.** A booking's fare is frozen; later price edits don't touch it.
4. **Commission comes from the snapshot**, never from the live package row.
5. **Round once, at the end**, to the nearest rupee (`100` paise). Rounding intermediate
   components produces receipts whose lines don't sum to the total, and customers notice.

## InCity fare

```
computeInCityFare(variant, price, pickupZone, scheduledAt) -> FareBreakdown

  base        = price.base_fare_paise

  pickup_fee  = pickupZone.pickup_charge_type == 'PAID'
                  ? (pickupZone.pickup_charge_paise
                     ?? settings['pickup.default_charge_paise'])
                  : 0

  night_fee   = isInNightWindow(scheduledAt) ? price.night_charge_paise : 0

  subtotal    = base + pickup_fee + night_fee
  tax         = round(subtotal * TAX_BPS / 10000)
  total       = roundToRupee(subtotal + tax)
```

The quoted total covers the **included** hours and km only. Overage is billed at
completion and is disclosed at quote time.

### Overage — the part that gets disputed

This is the most common real-world event in an hourly-rental product and the most common
source of complaints. Specify it precisely and show it before booking.

```
computeFinalFare(booking, actualMinutes, actualDistanceM) -> FinalFare

  snap        = booking.fare_snapshot
  grace       = settings['booking.overage_grace_minutes']         -- default 15

  extraMin    = max(0, actualMinutes - snap.included_minutes - grace)
  extraMin    = roundUpTo(extraMin, 30)          -- billed in 30-min blocks
  extraKm     = max(0, ceil(actualDistanceM/1000) - snap.included_km)

  time_charge = extraMin * snap.extra_minute_rate_paise
  dist_charge = extraKm  * snap.extra_km_rate_paise

  final = roundToRupee(snap.subtotal + time_charge + dist_charge + tax_on_extras)
```

Decisions baked in above, all of which favour the customer at the margin:

- **15-minute grace**, so a driver being slightly slow in traffic doesn't trigger a charge
- **30-minute billing blocks** — easy to explain, avoids per-minute nickel-and-diming
- Both grace and block size are settings, not constants
- Extra time and extra distance are billed **independently**. A 10-hour booking that used
  9 hours but 140 km against a 100 km cap pays km overage only. Do not "net off."

**The customer must see this before confirming.** A line in the fare card:

> Includes 3 hours and 30 km. Beyond that: ₹150 per 30 min, ₹12 per km.
> A 15-minute grace period applies.

## Outstation fare

Band pricing is **flat**: any trip whose road distance falls inside `[minKm, maxKm)` pays the
same `base_fare_paise`, whether that's 51 km or 99 km against a 50–100 band. There is no
per-km charge inside a band — see the decision log entry below.

```
computeOutstationFare(pkg, price, pickupZone, distanceKm, direction, scheduledAt)

  base        = price.base_fare_paise                 -- flat for the whole [minKm, maxKm) band,
                                                        -- and flat regardless of trip duration
  pickup_fee  = (as incity)
  night_fee   = ...

  subtotal    = base + pickup_fee + night_fee
  tax         = round(subtotal * TAX_BPS / 10000)
  total       = roundToRupee(subtotal + tax)
```

**Consequence for band design:** because there's no per-km charge to absorb the variance
inside a band, bands must be cut narrow enough that the cheapest and most expensive trip in
the band are close in actual driver cost — e.g. `50–60`, `60–70`, `70–80`, not one wide
`50–100`. A 51 km and a 99 km trip in the same band earn the driver the same amount for
very different work, so band width is now a pricing decision, not just a matching one.

For `ROUND_TRIP`, the price row is separate rather than a computed 2× — round trips are
usually less than double one-way (the driver is returning anyway) and you want that
pricing power explicit rather than derived.

### Round trip — multi-day, and driver expenses

Multi-day round trips (driver waits overnight, or several nights) are **in scope**: `total`
above is quoted for the whole trip and does not change with how many days it actually takes.
There is no per-extra-day charge through the app — the fixed-price promise holds however long
the trip runs.

**The driver's meals and night-halt are not an app transaction.** There is no
`driver_allowance_paise` in the fare, no line in `fare_snapshot.lines`, no ledger entry, and no
commission implication — the customer pays the driver directly, in cash, with zero admin or app
involvement in that money. This is why the `outstationPriceSchema` allowance field was removed;
see `03-database-schema.md`.

Because it's real money the customer will pay outside the app, it must be **disclosed and
explicitly accepted before booking**, not buried in fine print:

- The quote response carries a `direct_expenses` block for any `ROUND_TRIP` quote — a
  customer-facing notice (e.g. *"You pay the driver's meals and night-halt directly, in cash —
  not collected by DriverZone."*) plus an admin-editable indicative range where set.
- `POST /bookings` requires `round_trip_terms_accepted: true` on the request when the quote is
  an outstation round trip; omitting or falsifying it is rejected with
  `ROUND_TRIP_TERMS_NOT_ACCEPTED` (422), the same way an unaccepted cancellation policy would be.
- The acceptance timestamp is stamped onto the booking (`roundTripTermsAcceptedAt`) — not because
  the app mediates the payment, but so a dispute eight weeks later has a record that the
  customer was shown and agreed to the term before confirming.

See `08-api-contracts.md` for the exact shapes.

## Commission split

Stored per price row; percent values are **basis points** (`2500` = 25%).

```
splitFare(total, price) -> { driver, company }

  driverShare  = price.driver_commission_type == 'PERCENT'
                   ? round(commissionable * price.driver_commission_value / 10000)
                   : price.driver_commission_value

  companyShare = commissionable - driverShare
```

Where `commissionable = subtotal` — **tax is excluded**; it's passed through to the government,
not split. There is no driver-allowance line to exclude any more — see Round trip above; a
round trip's meals/night-halt money never enters `subtotal` because it never enters the app.

```
assert driverShare + companyShare + tax == total
```

Make that a runtime assertion in the fare builder, and a property-based test. Fare
arithmetic that doesn't reconcile is how you end up unable to close the books.

## The fare snapshot

Written once into `bookings.fare_snapshot` at confirmation, never updated:

```jsonc
{
  "version": 1,
  "service_type": "INCITY",
  "computed_at": "2026-08-20T09:14:22Z",

  "source": {
    "package_id": "…", "package_name": "Siliguri Hourly",
    "variant_id": "…", "variant_label": "3 Hours",
    "price_row_id": "…",
    "car_category_id": "…", "car_category": "SEDAN",
    "pickup_zone_id": "…", "pickup_zone": "Siliguri Central",
    "city_zone_id": "…", "city": "Siliguri"
  },

  "included": { "minutes": 180, "km": 30 },

  "rates": {
    "extra_minute_rate_paise": 500,
    "extra_km_rate_paise": 1200,
    "grace_minutes": 15,
    "billing_block_minutes": 30
  },

  "lines": [
    { "code": "BASE",       "label": "3 Hours / 30 km", "amount_paise": 90000 },
    { "code": "PICKUP_FEE", "label": "Pickup charge (Siliguri Outskirts)", "amount_paise": 10000 },
    { "code": "NIGHT",      "label": "Night charge",    "amount_paise": 0 }
  ],

  "subtotal_paise": 100000,
  "tax_bps": 500,
  "tax_paise": 5000,
  "total_paise": 105000,

  "split": {
    "commissionable_paise": 100000,
    "driver_paise": 75000,  "driver_commission_type": "PERCENT",  "driver_commission_value": 7500,
    "company_paise": 25000, "company_commission_type": "PERCENT", "company_commission_value": 2500
  }
}
```

`source` records *why* this price was charged, which is what you need when a customer
disputes it eight weeks later and the packages have since been reorganised. `version`
lets the parser handle old snapshots after the shape changes.

## The quote flow

```
POST /quotes  { service_type, pickup, drop, car_category_id, scheduled_at, direction? }
  → resolve zones (04)
  → match packages
  → compute fares
  → persist one quotes row per variant, expires_at = now + 10 min
  → 200 { quotes: [ { quote_id, variant, fare_breakdown, total_paise }, … ] }

POST /bookings { quote_id, customer_car_plate, scheduled_at }
  → SELECT … FROM quotes WHERE id = $1 FOR UPDATE
  → reject if expired          → QUOTE_EXPIRED (409)
  → reject if consumed_by IS NOT NULL → return the existing booking (idempotent)
  → copy fare_breakdown → bookings.fare_snapshot
  → UPDATE quotes SET consumed_by = booking.id
  → 201 { booking }
```

`FOR UPDATE` plus `consumed_by` makes a double-tapped Confirm button return the same
booking rather than creating two. This costs one line and saves a support category.

On `QUOTE_EXPIRED`, re-quote automatically and show the customer a diff — *"The price
changed from ₹1,050 to ₹1,100"* — rather than an error. Most of the time nothing changed
and you can proceed silently.

## The ledger

Build this in phase 1. Retrofitting a ledger after 10,000 bookings means reconstructing
history from booking rows, and it is genuinely miserable work.

Every money movement is an append-only signed row in `driver_earnings`.

**Trip completed, ₹1,050 total, ₹750 driver share, paid in cash:**

| entry_type | amount_paise | meaning |
|------------|--------------|---------|
| `TRIP_EARNING`    | `+75000` | driver earned this |
| `CASH_COLLECTED`  | `−105000` | driver holds company money |
| `COMMISSION_DEBIT`| `0` | — already netted; the cash line covers it |

Net wallet: `−30000` — the driver owes ₹300. Correct: they hold ₹1,050 cash and earned ₹750.

**Same trip paid online:**

| entry_type | amount_paise |
|------------|--------------|
| `TRIP_EARNING` | `+75000` |

Net wallet: `+75000` — the company owes the driver ₹750.

`wallet_balance_paise` on `drivers` is a **cache** of `SUM(amount_paise)`. Recompute it
nightly and alert on drift; never let it be the source of truth.

### Payouts

```sql
CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     uuid NOT NULL REFERENCES drivers(id),
  amount_paise  bigint NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  status        text NOT NULL DEFAULT 'PENDING',  -- PENDING/PROCESSING/PAID/FAILED
  utr           text,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

Weekly batch: sum unpaid entries per driver, create a payout, stamp `payout_id` on the
included rows **in the same transaction**. Skip drivers with a negative balance — they owe
money — and surface them in a collections view instead.

### Negative balance policy

A driver accumulating cash-collected debt must be blocked before it becomes
uncollectable:

```
if wallet_balance_paise < -settings['driver.max_negative_balance_paise']  (default −₹5,000)
    → block going on duty
    → in-app prompt to settle via UPI
    → notify ops after 48 hours
```

This is a real loss vector in cash-heavy markets. Set the threshold low at launch and
raise it for drivers with history.

## Things not in v1 but designed around

- **Surge** — deliberately excluded (`01-prd.md` §6). If it ever arrives it becomes a
  multiplier line in `lines[]`, which the snapshot shape already accommodates.
- **Coupons** — another negative line item; needs `applied_promotions` on the quote.
- **Tolls / parking** — reimbursables the driver adds mid-trip with a photo. Add as
  `TRIP_EXPENSE` ledger entries plus adjustment lines; do not touch the snapshot.
- **Cancellation fees** — a separate `cancellation_charges` table referencing the booking.
  Never an edit to the fare snapshot.
