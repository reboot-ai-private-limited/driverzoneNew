# Pricing & Commission

## Rules

1. **Integers in paise.** Never a float. `₹1,499.50` is `149950`.
2. **The client never sends a price.** It sends a `quote_id`.
3. **Snapshot at confirmation.** A booking's fare is frozen; later price edits don't touch it.
4. **Commission comes from the snapshot**, never from the live package row.
5. **Round once, at the end**, to the nearest rupee (`100` paise). Rounding intermediate
   components produces receipts whose lines don't sum to the total, and customers notice.

## The pickup fee

One rule, shared by both products, because a pickup zone is a global serviceability gate rather
than an incity concept (`zones.md`):

```
pickup_fee = pickupZone.pickup_charge_type == 'PAID'
               ? (pickupZone.pickup_charge_paise
                  ?? rupeesToPaise(settings['pickup.default_charge']))
               : 0
```

`pickup.default_charge` is the number ops actually tunes. The per-zone override exists for
the day a second paid zone needs a different figure, and costs nothing until then. A `FREE` zone
adds nothing at all — there is no zero-value fee line on the receipt.

> **Units.** Every `settings[...]` money value below is in **whole rupees**, while every
> `*_paise` field beside it is in paise. `rupeesToPaise()` is not decoration — the settings
> contract hands these back as an opaque `Rupees`, so omitting the conversion is a compile error
> rather than a silent 100× undercharge. See `database-schema.md` §Conventions.

## InCity fare

```
computeInCityFare(variant, pickupZone, scheduledAt) -> FareBreakdown

  -- The whole fare. There is no overage term and no completion-time recompute: the quoted
  -- total IS the total (open-questions.md Q2, closed 2026-08-28).
  base        = variant.base_fare_paise

  pickup_fee  = as above — identical for both products

  -- Time-of-day surcharge. GLOBAL, not per price row: at most ONE window can contain a given
  -- pickup time (the two windows are kept non-overlapping by a cross-key invariant), so this is
  -- one lookup and never a sum.
  tod_fee     = rupeesToPaise(surchargeFor(scheduledAt))   -- 0 outside both windows

  insurance   = rupeesToPaise(settings['pricing.insurance_charge'])

  subtotal    = base + pickup_fee + tod_fee + insurance
  tax         = round(subtotal * TAX_BPS / 10000)
  total       = roundToRupee(subtotal + tax)
```

### Completion — there is no final-fare recompute

`computeFinalFare` used to live here and billed overage: a 15-minute grace, then 30-minute blocks,
extra time and extra km never netted off. It is gone with the rates it read
(`open-questions.md` Q2, closed 2026-08-28). A booking's fare is the fare it was quoted, and a
3-hour rental that runs 3h 40m costs what the customer was told.

`includedMinutes` still means something — it is what the customer bought and what tells the driver
when they are released — it just has no fare consequence when it is exceeded.

The question that closed alongside it and was never answered: *who decides when a trip ended?* It
stopped mattering for the fare. It still matters for the driver's day, and if overage ever comes
back it has to be answered then. The fare card line that used to disclose the rates goes with
them:

> ~~Includes 3 hours and 30 km. Beyond that: ₹150 per 30 min, ₹12 per km.~~
> Includes 3 hours.

## Time-of-day surcharge

```
surchargeFor(scheduledAt) ->
  inWindow(scheduledAt, settings['pricing.early_morning_window'])
    ? settings['pricing.early_morning_charge']
    : inWindow(scheduledAt, settings['pricing.late_night_window'])
      ? settings['pricing.late_night_charge']
      : 0                                        -- rupees, convert before adding
```

Both windows are IST wall-clock `[start, end)` and either may wrap midnight (the late-night
default, `22:00`–`04:00`, does). They are held non-overlapping by a cross-key invariant on the
settings write path, which is what lets the branch above be an if/else rather than a precedence
rule nobody can remember. Setting a charge to `0` disables that surcharge; the window stays
meaningful.

This replaces the per-price-row `night_charge_paise` field, removed 2026-08-28: the same fare
line configured in two places is one place too many, and the row-level copy was never read.

## Outstation fare

```
computeOutstationFare(pkg, direction, pickupZone, scheduledAt)

  -- FLAT ACROSS THE BAND. No distance term: 72 km and 98 km both pay the 70-100 fare.
  base        = direction == 'ROUND_TRIP' ? pkg.round_trip_fare_paise : pkg.one_way_fare_paise
  -- `null` means this band does not sell that direction. Resolution has already rejected the
  -- request with NO_PACKAGE_AVAILABLE, so `base` is never null here.

  pickup_fee  = as above — identical for both products
  tod_fee     = rupeesToPaise(surchargeFor(scheduledAt))   -- as above, identical for both
  insurance   = rupeesToPaise(settings['pricing.insurance_charge'])

  subtotal    = base + pickup_fee + tod_fee + insurance
  tax         = round(subtotal * TAX_BPS / 10000)
  total       = roundToRupee(subtotal + tax)
```

**`open-questions.md` Q3 is closed** (2026-08-28): the band price is flat.
`extra_km_rate_paise` and `driver_allowance_paise` were removed from the band rather than set to
zero — a field that is always zero is a field someone eventually sets. Its cost is the one Q3
named: flat pricing needs many narrow bands.

For `ROUND_TRIP`, the fare is a separate field rather than a computed 2× — round trips are
usually less than double one-way (the driver is returning anyway) and you want that
pricing power explicit rather than derived.

## Commission split

Stored per price row; percent values are **basis points** (`2500` = 25%).

```
splitFare(commissionable, driverCommissionBps) -> { driver, company }

  driverShare  = round(commissionable * driverCommissionBps / 10000)
  companyShare = commissionable - driverShare
```

Where `commissionable = subtotal` — **tax is excluded**, being passed through to the government
rather than split. There is no driver allowance to exclude any more; it went with the outstation
price row.

**The company's share is the remainder, and is never stored.** Both sides used to be stored
independently, each with its own `PERCENT | FLAT` type, which let a form save 75% and 20% and
quietly leave 5% of every trip in nobody's column. Deriving one from the other deletes that
failure mode instead of validating against it, and makes the assertion below true by
construction rather than by check.

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
    // The category the booking was placed for. Recorded because dispatch matches on it and a
    // dispute needs to know which car was driven — NOT because it affected the price. It has
    // not since 2026-08-28. There is no `price_row_id`: there are no price rows.
    "car_category": "SEDAN",
    "pickup_zone_id": "…", "pickup_zone": "Siliguri Central",
    "city_zone_id": "…", "city": "Siliguri"
  },

  // What the customer bought. No `rates` block: there is no overage, so there is nothing the
  // snapshot needs to freeze a rate for.
  "included": { "minutes": 180 },

  "lines": [
    { "code": "BASE",       "label": "3 Hours",        "amount_paise": 90000 },
    { "code": "PICKUP_FEE", "label": "Pickup charge (Siliguri Outskirts)", "amount_paise": 10000 },
    { "code": "NIGHT",      "label": "Night charge",    "amount_paise": 0 }
  ],

  "subtotal_paise": 100000,
  "tax_bps": 500,
  "tax_paise": 5000,
  "total_paise": 105000,

  "split": {
    "commissionable_paise": 100000,
    // The rate is one number. The company's share is the remainder, and both sides are frozen
    // here as amounts so a later rate change cannot alter what was owed on this booking.
    "driver_commission_bps": 7500,
    "driver_paise": 75000,
    "company_paise": 25000
  }
}
```

`source` records *why* this price was charged, which is what you need when a customer
disputes it eight weeks later and the packages have since been reorganised. `version`
lets the parser handle old snapshots after the shape changes.

## The quote flow

```
POST /quotes  { service_type, pickup, drop, car_category, scheduled_at, direction? }
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
-- NOT YET DEFINED — this key is added when the ledger code that reads it is written.
    → block going on duty
    → in-app prompt to settle via UPI
    → notify ops after 48 hours
```

This is a real loss vector in cash-heavy markets. Set the threshold low at launch and
raise it for drivers with history.

## Things not in v1 but designed around

- **Surge** — deliberately excluded (`prd.md` §6). If it ever arrives it becomes a
  multiplier line in `lines[]`, which the snapshot shape already accommodates.
- **Coupons** — another negative line item; needs `applied_promotions` on the quote.
- **Tolls / parking** — reimbursables the driver adds mid-trip with a photo. Add as
  `TRIP_EXPENSE` ledger entries plus adjustment lines; do not touch the snapshot.
- **Cancellation fees** — a separate `cancellation_charges` table referencing the booking.
  Never an edit to the fare snapshot.
