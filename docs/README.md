# DriverZone — Documentation

Design docs for DriverZone: a zone-based driver-booking platform (admin web panel +
customer app + driver app).

> Status: **draft / pre-implementation**. Nothing here is built yet.
> Decisions marked 🔴 in [`LLD/open-questions.md`](LLD/open-questions.md) block
> implementation.

## What lives where

| | |
|---|---|
| [`prd.md`](prd.md) | What we're building and for whom. Start here. |
| [`setup-development.md`](setup-development.md) | Clone to running stack. |
| [`decision-log.md`](decision-log.md) | Decisions already made, dated, with what they replaced. |
| [`LLD/`](#read-in-this-order) | Low-level design: the domain, the algorithms, the schemas. |
| [`engineering/`](engineering/README.md) | How the code is structured, and why. |

## Setting up

New here? [`setup-development.md`](setup-development.md) takes a fresh clone to a running
stack, and explains the two Docker Compose workflows: `docker-compose.dev.yml` for
infrastructure while the apps run on your machine with hot reload, and
`docker-compose.prod.yml` for the whole stack in built images.

## Read in this order

[`prd.md`](prd.md) first — what we're building, for whom, and what's out of scope. Then
the low-level design in [`LLD/`](LLD/):

| Doc | What it answers |
|-----|-----------------|
| [Domain Model](LLD/domain-model.md) | Glossary, entities, and the invariants that must never break |
| [Database Schema](LLD/database-schema.md) | Mongoose schemas, indexes, where the invariants live |
| [Zone Resolution](LLD/zone-resolution.md) | The core algorithm: point → zones → packages |
| [Pricing & Commission](LLD/pricing-and-commission.md) | Fare computation, snapshots, the earnings ledger |
| [Dispatch & Assignment](LLD/dispatch-and-assignment.md) | Driver offer waves, accept races, reassignment |
| [Booking Lifecycle](LLD/booking-lifecycle.md) | State machine and the event log |
| [API Contracts](LLD/api-contracts.md) | Endpoints, payloads, error codes |
| [Auth](LLD/auth.md) | Phone + OTP, tokens, rotation and reuse detection |
| [User](LLD/user.md) | Profiles, addresses, vehicles, driver onboarding, admin verification |
| [Architecture](LLD/architecture.md) | Stack, services, realtime, deployment |
| [Admin Panel](LLD/admin-panel.md) | Screens, the polygon editor, validation rules |
| [Roadmap](LLD/roadmap.md) | Build phases |
| [Open Questions](LLD/open-questions.md) | Decisions needed before/during build |

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
