# DriverZone — Documentation

Design docs for DriverZone: a zone-based driver-booking platform (admin web panel +
customer app + driver app).

> Status: **draft / pre-implementation**. Nothing here is built yet.
> Decisions marked 🔴 in `12-open-questions.md` block implementation.

## Setting up

New here? [`setup-development.md`](setup-development.md) takes a fresh clone to a running
stack, and explains the two Docker Compose workflows: `docker-compose.dev.yml` for
infrastructure while the apps run on your machine with hot reload, and
`docker-compose.prod.yml` for the whole stack in built images.

## Read in this order

| # | Doc | What it answers |
|---|-----|-----------------|
| 01 | [Product Requirements](01-prd.md) | What we're building, for whom, and what's out of scope |
| 02 | [Domain Model](02-domain-model.md) | Glossary, entities, and the invariants that must never break |
| 03 | [Database Schema](03-database-schema.md) | Mongoose schemas, indexes, where the invariants live |
| 04 | [Zone Resolution](04-zone-resolution.md) | The core algorithm: point → zones → packages |
| 05 | [Pricing & Commission](05-pricing-and-commission.md) | Fare computation, snapshots, the earnings ledger |
| 06 | [Dispatch & Assignment](06-dispatch-and-assignment.md) | Driver offer waves, accept races, reassignment |
| 07 | [Booking Lifecycle](07-booking-lifecycle.md) | State machine and the event log |
| 08 | [API Contracts](08-api-contracts.md) | Endpoints, payloads, error codes |
| 09 | [Architecture](09-architecture.md) | Stack, services, realtime, deployment |
| 10 | [Admin Panel](10-admin-panel.md) | Screens, the polygon editor, validation rules |
| 11 | [Roadmap](11-roadmap.md) | Build phases |
| 12 | [Open Questions](12-open-questions.md) | Decisions needed before/during build |

## Engineering handbook

How the code is structured, and why: [`engineering/`](engineering/README.md) — monorepo layout,
clean architecture and SOLID, module boundaries, tech choices, build and deploy.

## The one-paragraph version

Admin draws **zones** as polygons on a map — cities, pickup-coverage areas, and hill
regions. Packages (incity hourly rentals, outstation trips) are attached to those zones.
When a customer enters pickup and drop points, the backend resolves both points against
the zone layers in a single spatial query, decides whether this is an incity or outstation
trip, matches applicable packages, and returns priced variants. On confirmation the fare is
frozen onto the booking and the trip is offered to drivers in expanding waves until one
claims it.

## Conventions used throughout

- **Money** is always an integer in **paise**. Never a float, never rupees.
- **Distance** is metres; **duration** is minutes.
- **Coordinates** are `[lng, lat]` in GeoJSON and MongoDB — the reverse of how humans write
  them. The apps send `{lat, lng}`; `@driverzone/geo` swaps at the boundary and is the only
  place that does. This is the single most common source of "my point isn't in the polygon"
  bugs, and it does not throw — it silently resolves to the Arabian Sea.
- **Timestamps** are `timestamptz`, stored UTC, rendered in `Asia/Kolkata`.
- **IDs** are UUID v7 where ordering matters, v4 otherwise.
