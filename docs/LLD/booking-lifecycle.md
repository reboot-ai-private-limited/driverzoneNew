# Booking Lifecycle

## State machine

```
                    ┌─────────┐
                    │  DRAFT  │  customer entering points
                    └────┬────┘
                         │ POST /quotes
                    ┌────▼─────┐
                    │  QUOTED  │  fare shown, 10-min TTL
                    └────┬─────┘
                         │ POST /bookings
                    ┌────▼──────┐
                    │ CONFIRMED │  fare frozen, dispatch_at set
                    └────┬──────┘
                         │ dispatch job fires
                    ┌────▼──────┐◄──────────────┐
              ┌─────│ SEARCHING │               │ admin reassign
              │     └────┬──────┘               │
   no driver  │          │ driver claims        │
   after N    │     ┌────▼─────┐                │
   waves      │     │ ASSIGNED │────────────────┤
              │     └────┬─────┘                │
     ┌────────▼───┐      │ driver starts moving │
     │ NO_DRIVER_ │ ┌────▼───────────┐          │
     │   FOUND    │ │ DRIVER_EN_ROUTE│──────────┤
     └────────────┘ └────┬───────────┘          │
                         │ driver at pickup     │
                    ┌────▼────┐                 │
                    │ ARRIVED │─────────────────┘
                    └────┬────┘
                         │ OTP verified
                    ┌────▼────┐
                    │ STARTED │
                    └────┬────┘
                         │ driver ends trip
                   ┌─────▼─────┐
                   │ COMPLETED │  final fare computed, ledger written
                   └───────────┘

Cancellation is reachable from CONFIRMED, SEARCHING, ASSIGNED, DRIVER_EN_ROUTE, ARRIVED:
  → CANCELLED_BY_CUSTOMER | CANCELLED_BY_DRIVER | CANCELLED_BY_ADMIN

QUOTED → EXPIRED on TTL.
```

## Transition table

Every transition goes through **one** function. No handler writes `bookings.status`
directly — this is invariant **B-3** and it's what makes the event log trustworthy.

```ts
const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  DRAFT:           ['QUOTED', 'EXPIRED'],
  QUOTED:          ['CONFIRMED', 'EXPIRED'],
  CONFIRMED:       ['SEARCHING', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_ADMIN'],
  SEARCHING:       ['ASSIGNED', 'NO_DRIVER_FOUND',
                    'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_ADMIN'],
  ASSIGNED:        ['DRIVER_EN_ROUTE', 'SEARCHING',        // ← reassignment
                    'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'],
  DRIVER_EN_ROUTE: ['ARRIVED', 'SEARCHING',
                    'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'],
  ARRIVED:         ['STARTED', 'SEARCHING',
                    'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'],
  STARTED:         ['COMPLETED', 'CANCELLED_BY_ADMIN'],    // admin only, and it's rare
  COMPLETED:              [],
  NO_DRIVER_FOUND:        ['SEARCHING'],                   // admin retry
  CANCELLED_BY_CUSTOMER:  [],
  CANCELLED_BY_DRIVER:    [],
  CANCELLED_BY_ADMIN:     [],
  EXPIRED:                [],
};
```

```ts
async function transition(
  tx: Tx, bookingId: string, to: BookingStatus, actor: Actor, ctx: TransitionCtx = {}
): Promise<Booking> {
  const b = await tx.one(
    `SELECT * FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);

  if (!TRANSITIONS[b.status].includes(to)) {
    throw new InvalidTransition(
      `${b.reference}: ${b.status} → ${to} is not allowed`);
  }
  if (REASON_REQUIRED.has(to) && !ctx.reason) {
    throw new BadRequest(`A reason is required to move ${b.reference} to ${to}`);
  }

  const updated = await tx.one(
    `UPDATE bookings SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [bookingId, to]);

  await tx.none(
    `INSERT INTO booking_events
       (booking_id, from_status, to_status, actor_type, actor_id, reason, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [bookingId, b.status, to, actor.type, actor.id, ctx.reason ?? null, ctx.metadata ?? {}]);

  return updated;
}
```

`FOR UPDATE` serialises concurrent transitions on one booking. Without it, a customer
cancelling at the same instant a driver accepts produces a booking that is both
`CANCELLED` and `ASSIGNED` depending on write order.

`REASON_REQUIRED` covers every cancellation, `SEARCHING` when it comes from a
reassignment, and `NO_DRIVER_FOUND`. An unexplained state change is one you can't act on
later.

## Side effects per transition

Side effects run **after** the transaction commits, never inside it. A failed push
notification must not roll back a state change.

| Transition | Side effects |
|-----------|--------------|
| `→ CONFIRMED` | Consume quote; generate OTP; enqueue dispatch job at `dispatch_at`; confirmation push + SMS |
| `→ SEARCHING` | Start wave 1; notify customer "finding your driver" |
| `→ ASSIGNED` | Supersede other offers; cancel wave timeout; push driver details + masked number to customer; push trip card to driver |
| `→ DRIVER_EN_ROUTE` | Open live tracking for the customer; ETA push |
| `→ ARRIVED` | "Your driver has arrived" push + SMS; start the waiting-charge clock |
| `→ STARTED` | Verify OTP; stamp `started_at`; begin the trip trace; share-trip link goes live |
| `→ COMPLETED` | Compute final fare; write `TRIP_EARNING` + `CASH_COLLECTED` ledger rows; generate the receipt; prompt both sides for ratings |
| `→ CANCELLED_*` | Compute the cancellation fee; refund if prepaid; free the driver; notify the other party |
| `→ NO_DRIVER_FOUND` | Push apology + full refund if prepaid; add to the ops queue; alert if the zone's rate is spiking |

## Trip start OTP

`bookings.start_otp` is a 4-digit code, shown in the customer app, read aloud to the
driver, entered in the driver app.

Without it, drivers mark trips started while still driving over — and since billing runs
from `started_at`, every minute of that is billed to a customer who wasn't in the car yet.
It is one of the highest-yield 20 lines of code in the whole product.

```
POST /driver/bookings/:id/start { otp }
  → constant-time compare against booking.start_otp
  → wrong: increment attempt counter; lock after 5 attempts, route to support
  → right: transition(ARRIVED → STARTED)
```

Also verify the driver is physically near the pickup:

```
if ST_Distance(driverLocation, booking.pickup_point) > 500  -- metres
    → warn, allow with an override flag, and record it in booking_events.metadata
```

Warn rather than block — GPS drifts badly in dense areas and near tall buildings, and a
hard block strands a legitimate driver. But record it: a driver with many overrides is
worth looking at.

## Cancellation policy

| When | Customer cancels | Driver cancels |
|------|------------------|----------------|
| Within 5 min of confirming, before assignment | Free | — |
| After assignment, before driver departs | Free | Counts toward the driver's cancellation rate |
| After `DRIVER_EN_ROUTE` | Cancellation fee (default ₹50) | Penalty ledger entry + rate hit |
| After `ARRIVED` | Higher fee (default ₹100) | Significant penalty; auto-review at a threshold |
| After `STARTED` | Admin only, manual fare settlement | Admin only |

All thresholds live in `global_settings`. The fee is shown in the confirm dialog
**before** the customer commits — never charge a fee the customer hasn't seen.

Cancellation charges go to a separate `cancellation_charges` table. They never modify
`fare_snapshot` (invariant **B-1**).

## Scheduled bookings

`is_scheduled = true` when `scheduled_at > now() + 60 minutes`.

- Stays in `CONFIRMED` until `dispatch_at` (default T−90 min)
- Customer can cancel free until T−60 min
- A reminder push goes out at T−2 h and again at T−30 min
- If `NO_DRIVER_FOUND` fires on a scheduled booking, escalate to ops **immediately** —
  there's still time to solve it by phone, which is the whole advantage of booking ahead

## The event log is the product's memory

`booking_events` is append-only and the app role has `UPDATE`/`DELETE` revoked
(`database-schema.md`). Every dispute, every "the driver never came", every "I was
charged for time I didn't use" is answered from this table.

Reconstruct any booking's full history:

```sql
SELECT to_status, actor_type, reason, metadata,
       created_at AT TIME ZONE 'Asia/Kolkata' AS at
FROM booking_events
WHERE booking_id = $1
ORDER BY id;
```

Render this verbatim in the admin booking detail view. Support staff should never have to
ask an engineer what happened to a booking.
