# 11 — Roadmap

Phases are ordered by **risk retirement**, not by feature count. The two things that can
sink this build are zone/pricing correctness and dispatch reliability, so both get proven
before any polish.

## Phase 0 — Foundations (~1 week)

- Monorepo scaffold (pnpm + Turborepo, four apps, five packages) — **done**
- Docker Compose (Mongo replica set, Redis, OSRM on an India extract) — **done**, split
  into dev (infrastructure) and prod (full stack); see
  [`setup-development.md`](../setup-development.md)
- Migration tooling, seed fixtures — the seed script is specced in
  [`setup-development.md`](../setup-development.md#seed-data--planned-not-yet-implemented):
  a dev admin, drivers, customers, zones and packages created in one idempotent command
- Auth: phone+OTP for customer/driver, email+TOTP for admin
- CI: lint, typecheck, migrations, tests

**Done when:** `docker compose -f docker-compose.dev.yml up -d` plus `pnpm turbo run dev`
gives a working stack with seeded Siliguri zones, and CI is green.

## Phase 1 — Zones & the resolution engine (~2 weeks)

The riskiest logic, built first, with no UI in the way.

- `zones` collection + `2dsphere` index
- Invariants Z-1…Z-3 in `@driverzone/geo` — **done**, 31 tests
- `resolveZones` + typed wrapper with the lat/lng guard
- Incity and outstation resolution algorithms
- OSRM integration + H3 route cache
- Terrain classification by route intersection
- `coverage_requests` / `unserved_distance_requests`
- **Full test suite from `04-zone-resolution.md`, including the border cases**

**Done when:** every case in the zone-resolution test table passes, and a deliberately
misconfigured zone is rejected by `createZone.usecase.ts` — with `lint:deps` green, proving no
other module can bypass it.

## Phase 2 — Packages, pricing, quotes (~2 weeks)

- Incity and outstation package/variant/price tables + P-1…P-4 triggers
- `pricing` module as **pure functions** at tier 0, with property-based tests on the reconciliation
  assertion (`driver + company + allowance + tax == total`)
- Quote generation, TTL, single-consumption
- Fare snapshot shape, versioned

**Done when:** `POST /quotes` returns correct fares for every fixture, and no arithmetic
path can produce a non-reconciling breakdown.

## Phase 3 — Admin panel v1 (~3 weeks)

Ops needs to configure the system before anyone can book anything.

- Zone tree + MapLibre polygon editor with live `POST /admin/zones/validate`
- Violation rendering (`offending_geometry` in red), clip-to-city
- Zone versioning and version history
- Incity + outstation package editors with the live commission split preview
- Pricing preview tool (FR-P6) including rejected-package reasons
- Global settings, audit log

**Done when:** an ops person with no engineering help can configure Siliguri end to end,
and cannot save an invalid zone.

## Phase 4 — Bookings & lifecycle (~2 weeks)

- `bookings`, `bookingEvents`, the `transition()` function
- `immutable: true` on `fareSnapshot`; insert-only DB role on `bookingEvents`
- Cancellation policy + `cancellation_charges`
- Start OTP
- Admin booking list and detail with the event timeline

**Done when:** every transition in the table is exercised by a test, and no code path
writes `bookings.status` outside `transition()`.

## Phase 5 — Dispatch (~3 weeks)

The other high-risk subsystem. Budget generously; this always takes longer than expected.

- BullMQ workers, durable wave timeouts, the 60 s sweeper
- Eligibility query, scoring, wave escalation
- Atomic claim + supersede
- Socket.IO offer delivery + FCM fallback + delivery tracking
- Scheduled dispatch (T−90 min) and reconfirmation
- Reassignment and the manual-assignment queue

**Done when:** a chaos test — kill the API mid-wave — leaves no booking stranded, and a
concurrent-accept test with 20 simultaneous claims assigns exactly one driver.

## Phase 6 — Driver app (~4 weeks)

- Onboarding, document upload, verification status
- Duty toggle with the **Android foreground service**
- Full-screen offer with countdown; accept/decline; lost-race handling
- Navigation handoff, arrived, OTP start, complete
- Earnings ledger view, cash-collected reconciliation
- **OEM battery-optimisation onboarding flow** — Xiaomi, Oppo, Vivo, Realme

That last item is not optional and not quick. It is the difference between a driver app
that receives offers and one that doesn't.

**Done when:** offers arrive reliably on a backgrounded app across all four major OEM
skins, verified on real devices.

## Phase 7 — Customer app (~4 weeks)

- Auth, saved addresses, coverage pre-check on the home screen
- Pickup/drop entry with map pins and search
- Incity/outstation switching that carries points across (FR-B3)
- Variant + car category selection with the full fare card and overage notice
- Booking, live tracking, masked calling, share-trip
- Cancellation with the fee shown before confirming
- Receipt, rating, history

**Done when:** every `available: false` reason renders a helpful screen, not a generic error.

## Phase 8 — Money (~2 weeks)

Ledger writes ship in Phase 4/5; this phase is the finance surface on top.

- Payout batching, negative-balance blocking, collections view
- Nightly wallet reconciliation with drift alerts
- Invoices with GST
- Payment gateway (UPI first — it's what the market uses)

## Phase 9 — Pilot: one city, one zone (~3 weeks)

Siliguri only. One pickup zone. Ten drivers. Staff-and-friends bookings.

Watch: assignment rate, time to assignment, offer delivery rate, overage disputes,
`ZONE_CONFIG_FAULT` count (must be zero).

Fix what breaks. **Do not add features during the pilot** — the pilot's job is to tell you
what's wrong with what you have.

## Phase 10 — Expansion

Add pickup zones by `coverage_requests` density. Add cities. Add outstation bands where
`unserved_distance_requests` cluster. The data tells you the order.

---

## Rough totals

| Phase | Weeks |
|-------|-------|
| 0–2 Backend core | 5 |
| 3 Admin panel | 3 |
| 4–5 Bookings + dispatch | 5 |
| 6 Driver app | 4 |
| 7 Customer app | 4 |
| 8 Money | 2 |
| 9 Pilot | 3 |
| **Total** | **~26 weeks** |

With parallel work (one backend, one mobile, one frontend developer) roughly **16–18
weeks** to pilot. Phases 6 and 7 overlap with 4 and 5 once the API contracts in
`08-api-contracts.md` are frozen — freeze them early, they're the critical path for the
mobile team.

## Sequencing rules

1. **Zones and pricing before anything else.** Everything else depends on them and they're
   pure logic — cheap to test, expensive to get wrong late.
2. **Admin panel before the apps.** You cannot test a booking flow you can't configure.
3. **Driver app before customer app.** No supply, no product. A customer app with no
   drivers is a demo.
4. **Ledger from day one.** Reconstructing months of financial history from booking rows
   is genuinely miserable work.
5. **Pilot small.** One zone, ten drivers, real money. Every assumption in these docs meets
   reality there, and some of them will lose.
