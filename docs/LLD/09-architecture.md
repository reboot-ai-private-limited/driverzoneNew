# 09 — Architecture

## Stack

| Layer | Choice | Why this one |
|-------|--------|--------------|
| Database | **MongoDB 7 + Mongoose 8** | Team fluency, and `2dsphere` covers the two hot-path operations: `$geoIntersects` for zone resolution, `$geoNear` for driver search. Requires a replica set — transactions need one. |
| Backend | **Express 4 (TypeScript)** | A deliberately thin edge. The architecture lives in the modules and containers, not the framework — see [`engineering/02`](engineering/02-clean-architecture-and-solid.md). |
| Geometry | **Turf.js** | Carries the zone invariants MongoDB cannot express as constraints, and runs in the browser so the admin editor validates live. |
| Monorepo | **pnpm + Turborepo** | Four apps, five shared packages. See [`engineering/01`](engineering/01-monorepo-layout.md). |
| Cache / queue | **Redis 7** | Driver locations (GEO), settings cache, BullMQ job store. |
| Jobs | **BullMQ** | Durable delayed jobs — the dispatch timers depend on this. |
| Routing | **OSRM**, self-hosted | Road distance on every quote; per-call pricing gets expensive fast. |
| Realtime | **Socket.IO** + Redis adapter | Offers, tracking, ops dashboard. |
| Push | **FCM** | Android-first; APNs via FCM for iOS customers. |
| Admin | **Next.js 14** + MapLibre GL + Mapbox Draw | MapLibre avoids Mapbox seat pricing; Draw is the polygon editor. |
| Apps | **React Native (Expo)** | Two apps, one language, one team. Flutter is a fine alternative — do not run both. |
| Storage | S3-compatible | Driver documents, receipts. |
| Observability | OpenTelemetry → Grafana/Loki/Tempo | Trace a booking end-to-end across dispatch. |
| Deploy | Docker on AWS ap-south-1 (Mumbai) | Data residency; latency to users. |

## Repository layout

One monorepo, four apps, five shared packages. Full detail in
[`engineering/01`](engineering/01-monorepo-layout.md).

```
driverzone/
├── apps/        api (Express + worker) · web (Next.js) · customer (Expo) · driver (Expo)
├── packages/    contracts · geo · design-system · mobile-ui · config
└── docs/        product docs + engineering/
```

**Monorepo does not mean monodeploy.** Each Dockerfile builds from the repo root — the lockfile
lives there — but copies only its own output into a clean final stage:

| Artifact | Contains | Goes to |
|---|---|---|
| `driverzone-api` image | `dist/` + prod deps | VM / ECS |
| `driverzone-worker` | **the same image**, different `CMD` | VM / ECS |
| `driverzone-web` image | Next standalone output | VM / ECS |
| `customer.aab` / `.ipa` | — | Play / App Store |
| `driver.aab` | — | Play Store |

Two server artifacts, two store binaries. The API image contains no admin-panel code and no
mobile code; the mobile apps never reach a server at all. See
[`engineering/09`](engineering/09-build-and-deploy.md).

## Services

Start as a **modular monolith** — one deployable, hard module boundaries. At this stage
microservices buy you distributed-transaction problems in exchange for scaling you don't
need.

```
api/
  modules/
    zones/          polygon CRUD, validation triggers, resolution queries
    packages/       incity + outstation config
    pricing/        fare computation, snapshots  ← pure functions, heavily tested
    quotes/
    bookings/       state machine, event log
    dispatch/       waves, offers, claim  ← the only module allowed to set driver_id
    drivers/        onboarding, documents, duty, location
    ledger/         earnings, payouts
    notifications/  socket + FCM fan-out
    admin/
    settings/
  workers/
    dispatch.worker.ts     wave timeouts, scheduled dispatch
    sweeper.worker.ts      missed dispatch safety net (every 60 s)
    location.worker.ts     Redis → Mongo location flush (every 30 s)
    reconcile.worker.ts    nightly wallet + ledger reconciliation
    metrics.worker.ts      nightly acceptance rates, ratings
```

Three rules that keep the boundaries real, all machine-enforced by
`.dependency-cruiser.cjs` ([`engineering/04`](engineering/04-boundaries-and-enforcement.md)):

1. **`pricing` is pure.** No I/O. Inputs in, `FareBreakdown` out. This makes the most
   dispute-prone logic in the system exhaustively testable without a database.
2. **Only `dispatch` writes `bookings.driverId`.** One module owning the assignment race is
   what keeps invariant B-2 true.
3. **Only `zones` writes a polygon.** Under MongoDB the zone invariants are application guards
   rather than database triggers, so this rule is what keeps them a real guarantee.

Modules communicate only through `<name>.public.ts` contracts — types only, erased at compile
time, zero runtime cost. See [`engineering/03`](engineering/03-module-anatomy.md).

## Driver location — the write-volume problem

2,000 on-duty drivers × 1 ping / 10 s = **200 writes/s sustained**, all day. Sent straight
to Mongo this bloats collections, thrashes the 2dsphere index, and starves booking queries.

Three tiers:

```
1. LIVE (Redis)                  every ping
   GEOADD drivers:live  <lng> <lat> <driver_id>
   SET    driver:{id}:meta {heading, speed, accuracy, at}  EX 300
   → dispatch candidate search: GEOSEARCH drivers:live FROMLONLAT … BYRADIUS … M

2. DISPATCH CACHE (Mongo)        every ~30 s, batched
   UPDATE drivers SET last_location = …, last_location_at = …
   → keeps SQL eligibility joins possible without touching Redis mid-query

3. TRIP TRACE (Mongo)            only during STARTED, batched every 30 s
   INSERT INTO trip_traces (booking_id, path, recorded_at)
   → the audit trail for distance disputes
```

```sql
CREATE TABLE trip_traces (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id),
  path        geography(LineString, 4326) NOT NULL,
  point_count int NOT NULL,
  recorded_at timestamptz NOT NULL
) PARTITION BY RANGE (recorded_at);
```

Partition monthly and drop partitions after 12 months. Traces are by far the largest table
in the system and their value decays fast.

### Candidate search: Redis or Mongo?

Use **Redis GEOSEARCH** for the radius query, then Mongo for the eligibility filters:

```
1. GEOSEARCH drivers:live … BYRADIUS 3000 m ASC  → ~40 driver ids
2. SELECT … FROM drivers WHERE id = ANY($1) AND <eligibility>  → ~12 eligible
3. rank, take top 5
```

Redis handles the spatial narrowing on always-fresh data; Mongo applies the business
rules it owns. Neither does the other's job.

## Data flow — a booking end to end

```
Customer app                API                   Mongo / Redis / OSRM
     │
     ├─ POST /quotes ───────►│
     │                       ├─ resolveZones(from)  ──────► Mongo    (1 query, <1 ms)
     │                       ├─ resolveZones(to)    ──────► Mongo
     │                       ├─ route(from,to)  ──► Redis cache → OSRM on miss
     │                       ├─ match packages      ──────► Mongo
     │                       ├─ computeFare()             (pure, no I/O)
     │                       └─ INSERT quotes
     │◄── 200 quotes[] ──────┤
     │
     ├─ POST /bookings ─────►│
     │                       ├─ SELECT quote FOR UPDATE
     │                       ├─ INSERT booking (fare_snapshot frozen)
     │                       ├─ INSERT booking_events
     │                       └─ BullMQ.add('dispatch', delay: dispatch_at − now)
     │◄── 201 booking ───────┤
     │                                    ┌── dispatch.worker ──┐
     │                                    │ GEOSEARCH → filter  │
     │                                    │ INSERT offers       │
     │                                    │ socket + FCM push   │
     │                                    │ schedule timeout    │
     │                                    └──────────┬──────────┘
     │                                               ▼
     │                                        Driver app: offer.new
     │                                               │
     │                                    POST /driver/offers/:id/accept
     │                                               │
     │                                    UPDATE … WHERE driver_id IS NULL
     │◄── socket: driver_assigned ────────────────────┘
```

## Environments

| Env | Purpose | Data |
|-----|---------|------|
| `local` | Docker Compose: Mongo (replica set), Redis, OSRM (India extract) | Seeded fixture zones |
| `staging` | Full stack, mirrors prod | Anonymised copy |
| `production` | ap-south-1, multi-AZ RDS, ElastiCache | — |

The **local OSRM container is worth the setup effort**. Without it, every developer's
quote flow either hits a paid API or gets mocked — and mocked distances hide exactly the
band-boundary bugs that matter.

## Backups & recovery

- RDS automated backups, 30-day PITR
- **Nightly logical dump of zones and all package/price tables.** These are small,
  hand-authored, and irreplaceable — a bad polygon edit at 2 am should be a two-minute
  restore, not an archaeology project.
- Zone versioning (`superseded_by`) already gives in-app rollback; the dump is the
  backstop.

## Security

- Phone + OTP auth for customers and drivers; email + password + TOTP for admins
- JWT with a 15-minute access token and a rotating refresh token
- Driver and customer phone numbers **masked** through a telephony provider — neither side
  ever sees the other's real number
- Driver documents in a private bucket, presigned URLs with a 5-minute expiry
- Rate limits: `POST /quotes` 30/min/user, OTP requests 5/hour/phone
- Admin actions all audited (`audit_log`); PII access on the admin panel logged separately
- Row-level security for the driver and customer roles on their own tables

## Scale notes

At the year-1 target (2,000 concurrent drivers, ~5,000 bookings/day) a single
`db.r6g.xlarge` and two API instances are comfortable. The parts that will strain first,
in order:

1. **Location writes** → already tiered above; the next step is a separate write replica
2. **Socket connections** → Redis adapter lets you scale horizontally from day one
3. **OSRM** → stateless, scale by adding containers behind a load balancer
4. **`trip_traces`** → partitioned from the start; drop old partitions

Nothing here requires rearchitecting to reach 10× the year-1 target.
