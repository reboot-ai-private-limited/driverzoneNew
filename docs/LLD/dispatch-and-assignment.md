# Dispatch & Assignment

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

## Favourite drivers — wave 0

A customer may mark drivers they have completed a trip with as **favourites**, and ask for them
when they book (`CreateBookingRequest.preferFavouriteDrivers`, frozen onto the booking as
`preferFavouriteDrivers`). When they do, dispatch runs one extra wave **before** the radius ladder.

```
dispatch(booking):
  if booking.preferFavouriteDrivers:
      favourites = favourites.favouriteDriverIds(booking.customerId)   -- read LIVE, not frozen
      if favourites is not empty:
          candidates = findEligibleDrivers(booking, settings['dispatch.favourite_radius_m'])
                         restricted to favourites
                         minus drivers already offered this booking
          if candidates is not empty:
              ring ALL of them as wave 0,
                   ttl = settings['dispatch.favourite_offer_ttl_seconds']
              return                       -- the ordinary ladder runs only if this wave lapses
  -- fall through to wave 1 immediately in every other case
```

**It is a preference, never a restriction.** Every path out of wave 0 leads to the ordinary
search, with no delay added:

| Case | What happens |
|---|---|
| Booking did not ask for favourites | Wave 1, exactly as before. The list is not even read. |
| Asked, but the customer has none | Wave 1 immediately. |
| Asked, but no favourite is eligible or in range | Wave 1 immediately — the favourite TTL is not burned. |
| Rung, and they all decline | Wave 1 the moment the last one answers (see below). |
| Rung, and they ignore it | Wave 1 when the wave-0 timeout fires. |

**Numbered 0 rather than shifting the ladder up.** Everything the ordinary waves already do works
unchanged for it: the `dispatch_offers` rows, the deterministic BullMQ timeout job id, the
"already offered" exclusion that stops a favourite being rung again in wave 1, and the timeout's
`wave + 1`, which lands exactly on the ordinary first wave.

**Every eligibility gate still applies.** The favourite shortlist NARROWS the query and never
widens it: a favourite who is off duty, unverified, in debt, out of position, or not competent for
this car category is no more eligible than a stranger in the same state. Being chosen by a
customer is a preference about people, not an exemption from being able to do the job.

**Its own radius and TTL, and both are wider than wave 1's.** `dispatch.favourite_radius_m`
(15 km) and `dispatch.favourite_offer_ttl_seconds` (60 s) answer a different question from
`dispatch.wave_base_radius_m` (3 km) and `dispatch.offer_ttl_seconds` (45 s). The ordinary first
wave asks "who can be here soonest"; this one asks "is the driver this customer actually wants
anywhere near", and a customer waits a little longer for a person they chose. Both are admin
settings, so the trade is tunable without a deploy.

**The whole list is rung, not the top `wave_size` of it.** The cap on favourites (20) is what
bounds the wave. Truncating a customer's own chosen drivers by a ranking they cannot see would be
the one place in dispatch where the score overrules a decision a person already made.

### A wave advances when its last offer is answered

Declining used to write the offer row and nothing else: the booking then sat out the whole TTL
ringing nobody. That was always slightly wrong, and the favourite wave makes it obvious — a
customer who names one driver gets a wave of one, and a single tap of Decline cost them the full
60 s.

So: **when no offer in a wave is still `SENT` and the booking is still `SEARCHING`, the next wave
starts immediately.** One decline out of five does not do this — the other four still have their
TTL, and cutting it short would waste their chance to accept.

The superseded wave's timeout job is still in Redis and fires on schedule. It is made harmless by
a guard rather than by deleting the job: the timeout returns early if any offer exists at a later
wave. That check holds even when a Redis delete fails, and leaves no second place for the two to
disagree.

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

**This eligibility query is not what `MongoDriverPool.findEligible` implements.** The Mongo
version filters on duty, verification, blocked, location freshness and wallet balance, plus the
competency match — but not on any of the three `NOT EXISTS` clauses above. That was true when this
paragraph originally argued for "one open offer at a time" as a rule worth enforcing; as of
2026-09-04 it is a deliberate product decision rather than a gap to close: a driver may legitimately
hold more than one live offer, or one while already mid-trip, and the *driver app* — not the
matching query — is responsible for presenting more than one without confusion (`GET
/driver/offers` returns all of them, soonest-expiring first; the ring screen shows one at a time
with a way to see the rest). Accepting one never auto-declines another live offer for a different
booking; each is independent until its own outcome.

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

### Ring early, park, ring again

**This section reverses the opening rule above, deliberately and only partly.** That rule says
do not dispatch a 6 am booking at 9 pm — and the reasoning still holds: a driver rung at 9 pm
does not know their morning, so they decline or ignore. What it produced in practice, though, is
a scheduled booking where *nothing happens at all* until T−90, and if the waves fail there, the
booking dies ninety minutes before a pickup the customer arranged days ago. One attempt, no
warning, no fallback.

The design below keeps the "do not ring at 9 pm" instinct but adds two things it lacked: an
early attempt that costs nothing when it fails, and a place for the booking to *wait* rather
than die.

```
booking created, pickup more than 90 min away
  │
  ├─ EARLY RING, immediately          CONFIRMED → SEARCHING → waves 0..max
  │     accepted   → ASSIGNED         (driver sees it under "Booked for later")
  │     exhausted  → WAITING_DRIVER   (parked; customer told we are still looking)
  │
  ├─ PARKED WINDOW, until T−90
  │     admin assigns       → SEARCHING → ASSIGNED
  │     driver takes it off the board → SEARCHING → ASSIGNED
  │
  └─ FINAL RING at T−90               WAITING_DRIVER → SEARCHING → waves 0..max
        accepted  → ASSIGNED
        exhausted → NO_DRIVER_FOUND   (terminal, as today)
```

A booking **60–90 minutes out has no early ring**, because `dispatch_at = max(now, T−90)` already
puts its only attempt at `now`. Early and final are the same instant, and running two would ring
the same drivers twice in a row.

#### `WAITING_DRIVER`, and why it is a status rather than a flag

The parked state needs to be visible to ops, filterable in the panel, and distinct from both
"nobody has looked yet" (`CONFIRMED`) and "we gave up" (`NO_DRIVER_FOUND`). A boolean on the
booking would leave `CONFIRMED` meaning two different things depending on a column, which is how
status tables rot.

Two new edges in `TRANSITIONS`:

```
SEARCHING      → WAITING_DRIVER    -- the early ring found nobody
WAITING_DRIVER → SEARCHING         -- final ring, admin assignment, or a driver taking it
```

**The second edge is the risky one.** The table is otherwise a one-way funnel, and `SEARCHING` is
the state `claimForDriver`'s compare-and-swap depends on. A booking that can re-enter `SEARCHING`
can be entered twice, so the claim must stay safe when the early ring's last lapsing offer and a
board acceptance land in the same moment. This is the part to write tests for first.

Manual assignment reaches it through `transferBooking`'s PRE-ASSIGNMENT branch, beside
`CONFIRMED` — not through `REASSIGNABLE_STATUSES`, which is derived from `COMMITTED_STATUSES` and
describes taking a booking AWAY from a driver who holds it. A parked booking has no driver to
release, so it goes straight to the claim. And `findDueForDispatch` matches it as well as
`CONFIRMED` — otherwise the sweeper stops being a safety net for exactly the bookings that most
need one.

#### The early ring must not cost drivers anything

This is the condition that makes the early attempt acceptable at all. A driver rung at 9 pm for a
6 am trip who does not answer has done nothing wrong, and the code is already careful about this
distinction — `respondToOffer` marks a loser `SUPERSEDED` precisely so losing a race stays off an
acceptance rate.

An early-ring offer that lapses or is declined must be excluded the same way. Whether that is a
new offer status or a flag on the row, the metrics job must not read it as a refusal. Get this
wrong and the feature quietly punishes the drivers who take the most work.

#### The final ring must be allowed to ask the same drivers again

`driverIdsOffered(bookingId)` excludes every driver already rung for that booking, so that a
later wave never rings someone twice. Across two attempts hours apart that is exactly backwards:
the drivers the early ring asked at 9 pm are the ones worth asking again at 4:30 am.

The exclusion has to be scoped to the attempt, not the booking.

#### The scheduled board

Between the two rings the booking sits on a board any **eligible** driver can take:

```
GET  /driver/scheduled-bookings          -- WAITING_DRIVER, future, eligible for this driver
POST /driver/scheduled-bookings/:id/accept
```

"Eligible" means the same gates `MongoDriverPool` applies to a wave — verified, unblocked, and
vehicle-competent for the trip (`vehicleMismatchReason`, including the hill check). It is not an
open marketplace: a hatchback driver must not be able to take an SUV booking from a list when
dispatch would never have rung them for it.

Favourites get no priority here. They already get wave 0 in both rings, which is where that
preference belongs; a board that hid trips from everyone else for a window would leave real work
sitting unclaimed for no gain.

Acceptance goes through `beginSearching` + `claimForDriver` with a `DRIVER` actor, the same path
manual assignment uses — never around it, so the transition table, the event log and the claim
race keep having one implementation each.

**A driver must not be able to hold two trips that overlap.** `hasActiveBooking` answers "on a
trip now", which is not the question here. Taking 10:00 and 10:30 on the same morning needs a
real overlap check against the trip's expected duration.

#### When the final ring fails

`NO_DRIVER_FOUND`, terminal, as today. There is no cancellation fee and nothing to refund through
the payment provider: the payment method is chosen after the trip starts, so a booking that never
found a driver was never charged.

**With one exception that is already broken today.** Wallet credit is spent at booking time —
`createBooking` writes a `SPENT_ON_RIDE` ledger entry for `creditAppliedPaise` because the
booking confirms synchronously and there is no later webhook to do it. `markNoDriverFound` is a
bare status transition and touches none of it, so a customer who paid partly from their wallet
loses that credit when the booking dies.

That is a pre-existing bug, not one this design introduces — but this design makes it far worse.
Today a booking dies minutes after being made; under this flow it can die ninety minutes before a
pickup the customer arranged days earlier, with the credit consumed for that entire time. The
fix belongs with this work: releasing `walletCreditPaise` and clearing `walletDebtPaise` on
`NO_DRIVER_FOUND`.

`NO_DRIVER_FOUND → SEARCHING` already exists for an admin retry, so ops keep their last resort.

#### What the customer sees

Three states that today are one:

| Booking state | What the customer is told |
|---|---|
| `SEARCHING` (either ring) | the live search screen — radar, "finding your driver" |
| `WAITING_DRIVER` | "We're still finding you a driver for <time>. We'll keep trying." |
| `NO_DRIVER_FOUND` | already rendered by both apps |

The parked message is the one that does not exist yet, and it is the whole point of the feature
from the customer's side: the difference between silence and being told the trip is still being
worked on.

## Reassignment and manual assignment

### Manual-dispatch bookings

A booking an admin makes from the panel for a customer carries `dispatchMode: 'MANUAL'`, and
**automatic dispatch never touches it**. Two doors are shut, because either one alone would leak:

- `createBooking` enqueues no dispatch job for it, and the sweeper's `findDueForDispatch` filters it
  out (`dispatchMode: { $ne: 'MANUAL' }` — rows from before the field have no value and are still
  swept).
- `RunDispatchWaveUseCase` returns `NOT_SEARCHING` for it before touching the status, for any job
  that reaches it anyway.

It waits at `CONFIRMED` until ops assigns a driver through the endpoint below, which already
handles a driverless `CONFIRMED` booking (`beginSearching` then claim). `POST
/admin/bookings/:id/auto-dispatch` flips it to `AUTO` — conditional on it still being driverless
and waiting — and enqueues dispatch at `max(now, scheduledAt − lead)`.

### Assigning

Both are one endpoint — `POST /admin/bookings/:id/assign { driver_id, reason }` — because they are
one act: put this booking on this driver. Whether somebody has to be taken off it first is a
detail of the booking's current state, not a different feature.

**Served by `dispatch`, despite the path saying bookings.** Assigning a driver writes
`bookings.driverId`, and dispatch is the only module permitted to (`.dependency-cruiser.cjs`
enforces it by tier, `bookings.public.ts` by shape). The route reaches it by the same
overlapping-prefix fall-through `/admin/drivers` already uses for `ledger`.

```
assign(booking, toDriver, reason, admin):
  refuse unless toDriver is verified, unblocked, and not already on a trip
  if booking has a driver:
      refuse unless status ∈ {ASSIGNED, DRIVER_EN_ROUTE, ARRIVED}
      releaseDriver()          -- → SEARCHING, driver_id = NULL, assigned_at = NULL
  else:
      refuse unless status = SEARCHING
  claimForDriver(toDriver)     -- the EXISTING accept-race CAS, unchanged
  record a dispatchOffers row: wave = -1, status = ACCEPTED
  notify the outgoing driver, the incoming driver, and the customer
```

**RELEASE THEN CLAIM, not a third write path.** `claimForDriver` already refuses anything but a
`SEARCHING` booking with no driver — which is exactly the state `releaseDriver` produces. So the
one compare-and-swap that guarantees invariant B-2 ("`driverId` goes from null to non-null exactly
once") keeps having exactly one implementation. If a dispatch wave lands in the gap between the
two, the wave's winner keeps the trip and the admin is told their pick did not stick; the booking
is assigned either way.

**Eligibility is checked BEFORE the release.** Discovering the target is ineligible afterwards
would have taken a trip off a working driver to achieve nothing.

**`STARTED` is refused.** Reassigning a running trip is a cancellation plus a new booking — the
fare, the ledger and the customer's receipt all differ — and blurring them breaks all three.

**The released driver is not penalised**: no ledger row, no acceptance-rate effect
(`COUNTS_AGAINST_ACCEPTANCE` is untouched), and the push they receive says so, because a driver
has no way to tell an ops reassignment from their own cancellation and that one does carry a
penalty.

**The picker does not filter on duty.** `GET /admin/bookings/assignable-drivers?search=` returns
verified, unblocked drivers with `is_on_duty` alongside, and the panel renders it as a warning. An
admin using manual assignment has usually just phoned the driver, and the common reason to reach
for it is that nobody nearby is online — a duty filter would refuse precisely the case the feature
exists for.

**The offer row** is written at `wave: -1` (`MANUAL_ASSIGNMENT_WAVE`). Negative so it cannot
collide with a real wave — 0 is the favourite wave, 1 upwards the radius ladder — which keeps a
hand-picked driver out of the metrics that judge the ranker, while still putting the assignment
where every other one lives and covering that driver with `driverIdsOffered`.

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
