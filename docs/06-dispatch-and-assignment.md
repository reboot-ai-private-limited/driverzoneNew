# 06 — Dispatch & Assignment

The riskiest subsystem in the product. Everything here is about two failure modes:
**a booking that silently hangs with no driver**, and **two drivers assigned to one trip**.

## Non-negotiable: durable timers

Your 30–60 s offer window **must not** be a `setTimeout` in the API process.

If the process restarts, deploys, crashes, or is scaled down mid-offer, that timer
vanishes. The booking sits in `SEARCHING` forever: no driver, no error, no next wave.
The customer stares at a spinner. Nobody is paged, because nothing failed.

Use **BullMQ delayed jobs on Redis** (or Temporal if you want it at a higher level). Jobs
survive restarts, retry on failure, and are inspectable when something goes wrong.

```ts
await dispatchQueue.add(
  'wave-timeout',
  { bookingId, wave },
  { delay: offerTtlSeconds * 1000, jobId: `wave:${bookingId}:${wave}` }
);
```

The deterministic `jobId` makes enqueue idempotent — a retried handler can't schedule two
timeouts for the same wave.

## Wave-based broadcast

Two obvious approaches, both wrong on their own:

- **Sequential** (one driver at a time, 45 s each): a booking can take 5 minutes to fill
  even with willing drivers nearby. Too slow.
- **Broadcast to everyone**: fills fast, but N drivers get a notification, N−1 lose the
  race, and they learn to ignore offers. Destroys acceptance rate over weeks.

**Waves** are the middle path: offer to a small ranked batch, widen if nobody takes it.

```
dispatch(booking):
  wave = 1
  loop:
    radius     = settings['dispatch.wave_radius_m'][wave-1]   -- [3k, 7k, 15k, 30k]
    candidates = findEligibleDrivers(booking, radius)
                   minus drivers already offered this booking
    if candidates is empty and wave < maxWaves:
        wave++ ; continue                    -- widen immediately, don't burn the TTL
    if candidates is empty and wave == maxWaves:
        → NO_DRIVER_FOUND

    batch = top N by score, N = settings['dispatch.wave_size']   -- default 5
    create dispatch_offers rows (status SENT, expires_at = now + ttl)
    push offer to each driver (socket + FCM)
    schedule wave-timeout job at now + ttl

    on driver accept → claim() ; if won, stop dispatching
    on timeout       → mark SENT offers LAPSED ; wave++ ; if wave > maxWaves → NO_DRIVER_FOUND
```

Defaults: TTL 45 s, wave size 5, max waves 4 → worst case ~3 minutes to `NO_DRIVER_FOUND`.
That is the right ceiling. A customer waiting 10 minutes for a "no drivers" answer is
worse served than one told in 3.

**Widening on empty is important.** If wave 1's radius contains no eligible drivers, do
not sit through 45 s of silence — jump straight to wave 2. Only burn the TTL when offers
were actually sent.

## Eligibility

```sql
SELECT d.id,
       ST_Distance(d.last_location, $pickup) AS distance_m,
       d.rating, d.acceptance_rate
FROM drivers d
JOIN driver_car_categories dcc ON dcc.driver_id = d.id
WHERE d.is_on_duty
  AND d.is_verified
  AND NOT d.is_blocked
  AND dcc.car_category_id = $carCategory
  AND d.last_location_at > now() - interval '2 minutes'   -- stale = probably offline
  AND ST_DWithin(d.last_location, $pickup, $radius)
  AND ($terrain <> 'HILL' OR d.can_drive_hill)
  AND d.wallet_balance_paise > $minBalance
  AND NOT EXISTS (                       -- no overlapping committed trip
    SELECT 1 FROM bookings b
    WHERE b.driver_id = d.id
      AND b.status IN ('ASSIGNED','DRIVER_EN_ROUTE','ARRIVED','STARTED')
  )
  AND NOT EXISTS (                       -- no open offer elsewhere
    SELECT 1 FROM dispatch_offers o
    WHERE o.driver_id = d.id AND o.status = 'SENT' AND o.expires_at > now()
  )
  AND NOT EXISTS (                       -- scheduled trip conflict
    SELECT 1 FROM bookings b
    WHERE b.driver_id = d.id
      AND b.status = 'ASSIGNED'
      AND tstzrange(b.scheduled_at, b.scheduled_at + interval '1 minute' * $durationMin)
          && tstzrange($start, $end)
  )
ORDER BY score DESC
LIMIT $waveSize;
```

The **one open offer at a time** rule matters. A driver holding three simultaneous offers
will accept all three and lose two races, which is exactly the experience that teaches
drivers to stop responding.

`last_location_at > now() - 2 min` filters drivers whose app was killed by the OS but who
never flipped off duty. Without it a meaningful share of wave 1 goes to phones that are
asleep, and your first wave silently does nothing.

## Ranking

```
score =  0.45 × proximity        -- 1 - (distance / radius)
       + 0.30 × acceptanceRate   -- rolling 30-day
       + 0.15 × ratingNorm       -- (rating - 3) / 2, clamped 0..1
       + 0.10 × idleTime         -- normalised minutes since last trip, capped at 60
```

The `idleTime` term is a fairness floor. Without it, the highest-rated driver nearest the
centre of town gets every offer and everyone else drifts off the platform. Fairness in
dispatch is a supply-retention feature, not a nicety.

Keep the weights in `global_settings` so they're tunable without a deploy, and store the
computed `score` on `dispatch_offers` so you can analyse what the ranker actually did.

## The accept race

Two drivers tap Accept 40 ms apart. Exactly one must win, with no lock and no ambiguity:

```sql
UPDATE bookings
SET    driver_id = $driverId,
       status = 'ASSIGNED',
       assigned_at = now()
WHERE  id = $bookingId
  AND  driver_id IS NULL
  AND  status = 'SEARCHING'
RETURNING id;
```

Zero rows → this driver lost. Return a clean, non-punitive response:

```json
{ "claimed": false, "reason": "ALREADY_ASSIGNED",
  "message": "This trip was just taken by another driver." }
```

Losing a race must **never** count against `acceptance_rate` — the driver did the right
thing. Only `LAPSED` and `DECLINED` count.

In the same transaction as a successful claim:

```sql
UPDATE dispatch_offers SET status = 'ACCEPTED', responded_at = now()
WHERE booking_id = $b AND driver_id = $d AND status = 'SENT';

UPDATE dispatch_offers SET status = 'SUPERSEDED'
WHERE booking_id = $b AND status = 'SENT' AND driver_id <> $d;
```

Then, outside the transaction: cancel the pending wave-timeout job, push a dismiss event
to the superseded drivers so their ringing screens close immediately, and notify the
customer.

## Scheduled bookings

Do not dispatch a 6 am booking at 9 pm the night before. No driver knows their morning
availability, so they decline or ignore — and you've damaged their acceptance score for
a trip they might well have taken at 4:30 am.

```
on booking confirmed:
  dispatch_at = is_scheduled
                  ? scheduled_at - settings['dispatch.scheduled_lead_minutes']  -- 90 min
                  : now()
  enqueue dispatch job at dispatch_at, jobId = `dispatch:${booking.id}`
```

A sweeper runs every minute as a safety net, catching anything whose job was lost:

```sql
SELECT id FROM bookings
WHERE status = 'CONFIRMED' AND dispatch_at <= now()
ORDER BY dispatch_at LIMIT 100;
```

Belt and braces. Queues lose jobs occasionally; a booking that never dispatches is a
customer who never gets a driver, and that is worth a redundant query every minute.

### Pre-assignment for scheduled trips

Optional, for high-value or early-morning bookings where certainty matters more than
efficiency: dispatch at T−12 h, then **reconfirm at T−2 h**.

```
at T-2h: push "Confirm you're still taking this 6:00 AM trip"
         no response in 30 min → unassign, mark the driver, re-dispatch immediately
```

The reconfirm step is what makes pre-assignment safe. Without it, a driver who took a trip
yesterday and forgot it leaves you discovering the problem at 6:00 am with no fallback.

## Reassignment

Admin-initiated, from the ops dashboard, with a mandatory reason:

```
reassign(booking, reason, actor):
  transaction:
    UPDATE bookings SET driver_id = NULL, status = 'SEARCHING', assigned_at = NULL
    WHERE id = $b AND status IN ('ASSIGNED','DRIVER_EN_ROUTE','ARRIVED')
    INSERT booking_events (from, to='SEARCHING', actor, reason)
    if reason ∈ DRIVER_FAULT_REASONS:
        INSERT driver_earnings (PENALTY, -amount)
  after commit:
    notify previous driver — trip removed, with the reason
    exclude that driver from all future waves for this booking
    dispatch(booking) from wave 1
```

Reassignment after `STARTED` is not a reassignment — it's a cancellation plus a new
booking. Don't blur them; the fare, the ledger, and the customer's receipt all differ.

## Manual assignment

When dispatch exhausts its waves, the booking lands in an ops queue. An admin can assign
any eligible driver directly, bypassing the ranker but **not** the eligibility rules —
except `is_on_duty`, which an admin may override after phoning the driver.

The queue view needs, per booking: time waiting, pickup zone, car category, how many
drivers were offered, and how many declined. That last number is the diagnosis — five
lapses means nobody's online; five declines means your price is wrong for that route.

## Notification delivery

**FCM alone is not sufficient for a 45-second ringing offer.** Chinese OEM battery
managers (Xiaomi, Oppo, Vivo, Realme — the bulk of the Indian driver market) delay or drop
FCM messages to backgrounded apps, sometimes by minutes.

Belt and braces, both channels every time:

1. **Persistent socket** (Socket.IO) — primary path when the app is foreground or a
   foreground service is running. Sub-second, reliable.
2. **FCM high-priority data message** — wakes the app; the app then renders a full-screen
   intent. Fallback for backgrounded apps.

On Android the driver app should run a **foreground service** while on duty (persistent
notification, "DriverZone is online"). This keeps the socket alive and is the difference
between a working driver app and an unreliable one. Budget real time for OEM-specific
autostart and battery-optimisation onboarding — it's tedious, unavoidable, and the single
biggest cause of "I never got the notification".

Track delivery explicitly:

```sql
ALTER TABLE dispatch_offers
  ADD COLUMN delivered_via text,        -- 'SOCKET','FCM','BOTH','NONE'
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN seen_at timestamptz;
```

An offer that lapsed but was never delivered is an **infrastructure failure**, not a
driver failure. It must not count against acceptance rate, and a rising `NONE` rate is
your early warning that push delivery is degrading.

## Metrics to instrument from day one

| Metric | Watch for |
|--------|-----------|
| Time to assignment (p50/p95) | Rising p95 → supply thinning in some zone |
| Assignment rate | The headline number |
| `NO_DRIVER_FOUND` by pickup zone × hour | Where and when to recruit |
| Offers per assignment | > 3 means ranking or pricing is off |
| Acceptance rate by driver | Below ~40% needs a conversation |
| Offer delivery rate | Below 95% means push is broken |
| Wave reached at assignment | Mostly wave 3+ means wave-1 radius is too tight |
