# Open Questions

🔴 blocks implementation · 🟡 needed before pilot · 🟢 can be decided later

Each question notes a recommended default so work isn't blocked on an answer — but a 🔴
default that turns out wrong is expensive to unwind.

---

### ✅ Q1 — Destination enforcement on long incity variants — **CLOSED 2026-08-28**

**There is no destination rule.** `enforce_drop_in_city` is deleted, and with it the 4-hour
threshold it was defaulted from. A trip whose pickup and drop are both inside the city zone is
incity, at any distance; one whose drop is outside is outstation. See
[`../decision-log.md`](../decision-log.md).

The recommendation this answered relied on "the included-km cap plus the extra-km rate already
price the risk" — and both of those are gone too (Q2). So the risk is now unpriced rather than
priced differently, which is the honest reading and is recorded in the log.

---

### ✅ Q2 — Overage billing — **CLOSED 2026-08-28**

**There is none.** A 3-hour booking that runs 3h 40m is an operations conversation, not a fare
line. `extraMinuteRatePaise`, `extraKmRatePaise` and the `includedKm` cap they billed against were
removed from the variant; `includedMinutes` stays because it is what the customer buys and what
tells the driver when they are released. See [`../decision-log.md`](../decision-log.md).

This closes the question by deleting the feature rather than specifying it, and the cost is the
one the question named: the most common real-world event in an hourly product now has no fare
consequence. Re-opening it means restoring two rate fields and a grace/block policy — the
"who decides when a trip ended" half was never answered and would have to be answered then.

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

### ✅ Q4 — Round trip: what is actually included? — **CLOSED 2026-08-28**

**The whole two-way journey, however long it takes.** A 540 km destination matches the band
containing 540 — the ONE-WAY distance — and that band's `roundTripFarePaise` covers all 1,080 km
of driving. There is no same-day cap, no maximum included wait and no per-day allowance: one
number covers the driver's whole trip, including nights away. See
[`../decision-log.md`](../decision-log.md).

The recommendation on file was the opposite — cap v1 at same-day and defer multi-day — and it was
not taken. The cost of the decision that was: **a 2-day and a 5-day trip to the same town pay the
same fare**, because distance is the only thing that selects a band. The question's warning that
this is the highest-dispute product still stands.

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
