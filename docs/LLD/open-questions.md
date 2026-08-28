# Open Questions

🔴 blocks implementation · 🟡 needed before pilot · 🟢 can be decided later

Each question notes a recommended default so work isn't blocked on an answer — but a 🔴
default that turns out wrong is expensive to unwind.

---

### 🔴 Q1 — Destination enforcement on long incity variants

Your spec hard-blocks a booking when the drop point falls outside the pickup point's city
zone. For a **10-hour** rental that will reject bookings you want: the customer is doing
errands and multiple stops, and the destination they typed is mostly a formality.

**Recommendation:** enforce only for variants ≤ 4 hours. Above that, warn and let it
through — the included-km cap plus the extra-km rate already price the risk.
Implemented as a per-variant `enforce_drop_in_city` flag, defaulted from duration.

*Why it's 🔴:* it changes the resolution algorithm, the variant schema, and the customer
copy. Cheap now, three code paths later.

---

### 🔴 Q2 — Overage billing

Not in your spec at all, and it's the most common real-world event in an hourly product.
A 3-hour booking that runs 3h 40m needs a defined answer.

**Recommendation:** 15-minute grace, then bill in 30-minute blocks at a per-variant rate.
Extra time and extra km billed independently, never netted off. All values in
`global_settings` so ops can tune without a deploy.

**Also needs deciding:** who decides when a trip ended? The driver taps Complete — what
stops them tapping it 20 minutes late? Suggested: server clock is authoritative, and the
customer gets a "confirm trip ended" push whose timestamp wins if it comes first.

---

### ✅ Q3 — Outstation band pricing: flat or base + per-km? — **CLOSED 2026-08-28**

**Flat.** A 70–100 km band charges the same for 72 km and 98 km; `extraKmRatePaise` and
`driverAllowancePaise` were removed from the band entirely rather than set to zero. See
[`../decision-log.md`](../decision-log.md).

The warning this question carried still stands and is now a live constraint rather than a
hypothetical: **flat pricing needs many narrow bands.** That is why the admin panel makes an
uncovered stretch a red row in the band list, and why splitting a band is a first-class action
instead of an edit-then-create sequence with a 409 in the middle.

---

### 🔴 Q4 — Round trip: what is actually included?

A round-trip price implies the driver waits at the destination. For how long? Is a
multi-day trip (driver stays overnight) the same product?

**Needs defining:** maximum included wait, per-day driver allowance, night-halt charge,
and what happens when the customer extends on the day. Without this, round-trip outstation
is your highest-dispute product.

**Recommendation for v1:** cap round trips at same-day return, defer multi-day entirely.
Multi-day is a genuinely different product with different driver economics.

---

### 🟡 Q5 — Car category: whose car is it?

The driver drives the **customer's** car, so `driver_car_categories` means "categories
this driver is competent to drive", not "cars they own". Confirm — and confirm that an SUV
booking should actually cost more, given the driver isn't supplying the vehicle.

Defensible either way (an SUV is harder to drive in city traffic), but be deliberate: if
the answer is "no difference", collapse pricing to one category and delete a whole
dimension from the pricing matrix.

---

### 🟡 Q6 — Hill zones and driver capability

`drivers.can_drive_hill` gates hill dispatch. How is it granted — self-declared,
admin-verified, or earned after N plains trips?

**Recommendation:** admin-verified at onboarding. Hill driving in the Darjeeling region is
a genuine safety matter, and self-declaration is how you end up with an inexperienced
driver on a mountain road at night.

The gating signal is now the same one that prices the trip: a booking is a hill booking when its
drop point falls inside a hill zone (`packages.md`). Dispatch and pricing therefore agree by
construction — there is no state where a trip is priced as hill but offered to a driver who is
not cleared for it.

---

### 🟡 Q7 — Payment timing

Prepaid at booking, or cash at completion?

- **Cash** matches market expectation but creates the wallet-debt problem
  (`pricing-and-commission.md`), needs collections, and means no-shows cost you nothing
  to the customer.
- **Prepaid** removes debt entirely but adds refunds and reduces conversion.

**Recommendation:** cash for incity, **prepaid advance (~25%) for outstation**. Outstation
no-shows waste a driver's entire day and are worth protecting against.

---

### 🟡 Q8 — Night charge window and driver allowance

`22:00–06:00` is a placeholder. Does it apply when the trip *starts* in the window, or
pro-rata for hours falling inside it? Pro-rata is fairer and much harder to explain on a
receipt.

**Recommendation:** applies if the trip **starts** in the window. Simple, explainable,
matches market norms.

---

### 🟢 Q9 — Waiting charges before trip start

Driver arrives at 09:00; customer comes down at 09:25. Who pays?

**Recommendation:** 10 minutes free from `ARRIVED`, then bill at the extra-time rate, and
credit it entirely to the driver. Their time is the cost.

---

### 🟢 Q10 — Driver acceptance-rate consequences

Scoring is specified. Consequences are not. Below what rate does a driver get warned,
deprioritised, or removed?

**Recommendation:** below 40% over 30 days → warning; below 25% → wave-1 exclusion. Never
auto-deactivate; low acceptance often means the driver's zone or hours are wrong, which is
a supply-planning signal rather than a discipline problem.

---

### 🟢 Q11 — Zone edits and in-flight bookings

If a zone shrinks while a booking sits in `SEARCHING` with a pickup that is now outside
coverage, what happens?

**Recommendation:** honour it. The booking already resolved against the old geometry and
its snapshot records that. Flag it to ops rather than cancelling on the customer.

---

### 🟢 Q12 — Multi-stop incity

Common for hourly rentals and not in the spec. Does the customer enter one destination or
several?

**Recommendation:** v1 takes a single indicative destination; the km cap handles reality.
Add explicit multi-stop once you see how customers actually use the 10-hour package.

---

### 🟢 Q13 — Tax

`pricing-and-commission.md` uses a flat `TAX_BPS`. Actual GST treatment for a
driver-supply service — rate, whether the driver's share is separately taxable, reverse
charge — is a question for an accountant, not an engineer.

Get this answered before Phase 8. The snapshot shape accommodates whatever the answer is,
but invoices need to be right from the first one you issue.

---

## Assumptions made in these docs

Where a decision was needed to keep writing, these were taken. Each is cheap to change now
and progressively more expensive later.

| # | Assumption | Where |
|---|-----------|-------|
| A1 | One active zone per type contains any point (Z-2 enforced) | `domain-model.md`, `database-schema.md`, `zone-resolution.md` |
| A2 | ~~Pickup zones are children of city zones~~ — **superseded 2026-08-25.** Pickup zones are flat: a serviceability gate and a fee, with no parent and no package links | `zones.md`, [`decision-log.md`](../decision-log.md) |
| A3 | Money in paise, percentages in basis points | throughout |
| A4 | Fare snapshots immutable; corrections are adjustment rows | `pricing-and-commission.md` |
| A5 | ~~Terrain classified by route intersection, not destination point~~ — **superseded 2026-08-25.** Terrain is decided by whether the drop point falls inside a hill zone; the route is never measured | `packages.md`, [`decision-log.md`](../decision-log.md) |
| A6 | Dispatch is wave-based broadcast, 5 drivers, 45 s, 4 waves | `dispatch-and-assignment.md` |
| A7 | Scheduled bookings dispatch at T−90 min | `dispatch-and-assignment.md` |
| A8 | Trip start requires a customer OTP | `booking-lifecycle.md` |
| A9 | Commission excludes tax and driver allowance | `pricing-and-commission.md` |
| A10 | Self-hosted OSRM for road distance | `zone-resolution.md`, `architecture.md` |
| A11 | Modular monolith, not microservices | `architecture.md` |
| A12 | Android-first for drivers, foreground service while on duty | `dispatch-and-assignment.md`, `architecture.md` |
| A13 | MongoDB `2dsphere` for containment, Turf for geometric predicates | `zones.md` |
