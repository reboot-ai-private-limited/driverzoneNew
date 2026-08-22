# 02 — Clean Architecture & SOLID

Every principle here is illustrated with code that is actually in this repository. If an
example does not match what you find, the code moved and this doc is wrong — please fix it.

## The dependency rule

```
                    ┌──────────────────────────────────┐
                    │          interface/              │  controllers, routes, validation
                    │   HTTP in → use case → HTTP out  │
                    └────────────────┬─────────────────┘
                                     │ depends on
                    ┌────────────────▼─────────────────┐
                    │         application/             │  use cases
                    │   orchestrates; owns no rules    │
                    └────────────────┬─────────────────┘
                                     │ depends on
                    ┌────────────────▼─────────────────┐
                    │            domain/               │  entities, value objects, PORTS
                    │   the rules. imports nothing.    │
                    └────────────────▲─────────────────┘
                                     │ implements
                    ┌────────────────┴─────────────────┐
                    │        infrastructure/           │  Mongoose, Redis, HTTP clients
                    │  the only layer that knows how   │
                    └──────────────────────────────────┘
```

**Every arrow points inward.** `domain/` is the centre and imports from no layer above it.
`infrastructure/` is on the outside but points *in*, because it implements interfaces the
domain declared.

The counter-intuitive part: `infrastructure/` sits at the bottom of the drawing but is the
*outermost* layer conceptually. Mongoose is a detail. If it is replaced, `domain/` and
`application/` must not notice.

This is not a claim — it is a thing that already happened to this project. See
[§Proof](#proof-the-postgres-to-mongo-switch).

### What each layer may import

| Layer | May import | May **not** import |
|---|---|---|
| `domain/` | its own layer, `@driverzone/contracts` types | anything in `application/`, `infrastructure/`, `interface/`; Mongoose; Express |
| `application/` | `domain/`, `shared/` | `infrastructure/`, `interface/` |
| `infrastructure/` | `domain/`, `shared/`, any library | `application/`, `interface/` |
| `interface/` | `application/`, `domain/`, `shared/` | `infrastructure/` |
| `<name>.container.ts` | **everything in its own module** | — |

The container is the deliberate exception. Somewhere has to name a concrete class; confining
that to one file per module is the whole trick.

All of this is machine-checked — see [04](04-boundaries-and-enforcement.md). You do not need
to remember the table; you need to recognise the error message when CI prints it.

---

## S — Single Responsibility

> A module has one reason to change.

**In this codebase:** `pricing` computes fares. `quotes` persists them. They are separate
modules on separate tiers.

The temptation is to merge them — a quote *is* a priced thing, and one module would mean less
wiring. What that costs:

`pricing` is at tier 0 and imports **nothing**. Rates and durations go in, a `FareBreakdown`
comes out, no I/O. That is what makes the most dispute-prone logic in the product exhaustively
testable — you can run a thousand fare cases in milliseconds with no database.

Merge it into `quotes` and every one of those tests needs a Mongo connection, because the
module it now lives in owns persistence. The rules did not change; the cost of verifying them
went up by two orders of magnitude.

The same split shows up inside a module:

```
domain/health.entity.ts       summarise() — the rule: any dependency down means degraded
application/getHealth.usecase.ts   gathers probes, calls summarise
interface/health.controller.ts     turns the report into 200 or 503
```

Three reasons to change, three files. When the degraded rule changes you edit the entity; when
the status code changes you edit the controller. Neither touches the other.

---

## O — Open/Closed

> Open for extension, closed for modification.

**In this codebase:** the fare breakdown is a list of lines, not a set of fields.

```jsonc
"lines": [
  { "code": "BASE",       "label": "3 Hours / 30 km", "amount_paise": 90000 },
  { "code": "PICKUP_FEE", "label": "Pickup charge",   "amount_paise": 10000 },
  { "code": "NIGHT",      "label": "Night charge",    "amount_paise": 0 }
]
```

Adding a hill surcharge, a toll reimbursement or a promotional discount is a new entry in that
array. No existing field changes, no client breaks, and every fare snapshot ever written still
parses. Had this been `{ base, pickupFee, nightCharge }`, each addition would be a schema
migration plus a coordinated release across four apps — two of which are store binaries you
cannot recall.

Same shape in `health`: adding an OSRM probe means one new class implementing
`HealthProbePort` and one line in the container. `GetHealthUseCase` is untouched, because it
was written against `HealthProbePort[]` and never counted them.

---

## L — Liskov Substitution

> Any implementation of an interface is usable wherever the interface is expected.

**In this codebase:** `test/health.test.ts` runs with no database, no Redis and no Express.

```ts
const probe = (name: string, status: 'up' | 'down'): HealthProbePort => ({
  name,
  check: async () => ({ name, status }),
});

const r = await new GetHealthUseCase([probe('mongodb', 'up'), probe('redis', 'down')]).execute();
expect(r.status).toBe('degraded');
```

A three-line object literal is substitutable for `MongoHealthProbe` because both satisfy
`HealthProbePort`. Nothing is mocked; no module registry is patched.

This is only true because `GetHealthUseCase` is typed against the **port**. Type it against
`MongoHealthProbe` and this test needs a running database to assert a branch that has nothing
to do with one — which is the point at which people stop writing the test.

Substitutability carries an obligation: an implementation must honour the interface's
*contract*, not merely its shape. `check()` promises to return a `DependencyHealth`. An adapter
that throws instead is a Liskov violation even though it typechecks — which is why the use
case wraps its probes in `Promise.allSettled` and converts a rejection into
`status: 'down'`. Defending against a broken implementation is the caller's job when the
implementations are pluggable.

---

## I — Interface Segregation

> No consumer should depend on methods it does not use.

**In this codebase:** `zones` will expose two contracts, not one.

```ts
// zones.public.ts

/** Read-only resolution. The hot path — every quote calls this. */
export interface ZoneResolutionContract {
  resolveAt(point: LatLng): Promise<ResolvedZones>;
  findHillZonesNear(route: LineString): Promise<Zone[]>;
}

/** Zone authoring. Admin only, and the only path that may write a polygon. */
export interface ZoneAdminContract {
  create(input: CreateZoneInput, actor: AdminId): Promise<Zone>;
  updateGeometry(id: ZoneId, geom: Polygon, actor: AdminId): Promise<Zone>;
  validate(input: ZoneValidationInput): Promise<ZoneViolation[]>;
}
```

`dispatch` receives `ZoneResolutionContract`. It is therefore **structurally incapable** of
mutating a polygon — not by convention, not by code review, but because the method is not on
the object it was handed.

That matters more here than in most systems. Under MongoDB the zone invariants are application
guards rather than database triggers ([04](04-boundaries-and-enforcement.md)), so "only the
zones module writes zones" is what keeps them true. A single wide `ZoneContract` with
`updateGeometry` on it would hand every consumer the ability to bypass them.

The general rule: **split by consumer, not by entity.** When a new consumer wants a different
slice, give it a new interface rather than widening an existing one.

---

## D — Dependency Inversion

> Depend on abstractions. High-level policy must not depend on low-level detail.

**In this codebase:** the port lives in `domain/`, beside the code that needs it — not beside
the code that implements it.

```
domain/healthProbe.port.ts          ← the interface. declared by the layer that NEEDS it.
infrastructure/mongoHealthProbe.adapter.ts   ← implements it
```

That placement *is* the inversion. The normal arrangement has the use case import the adapter,
so policy depends on detail. Here the adapter imports the port, so detail depends on policy,
and the arrow points inward.

Move `healthProbe.port.ts` next to the Mongo adapter and `application/` would be importing from
`infrastructure/` — which `.dependency-cruiser.cjs` rejects, because at that moment the
database owns the shape rather than the domain.

The wiring happens in exactly one place:

```ts
// health.container.ts — the ONLY file in the module that names a concrete class
export function buildHealthContainer(): HealthContainer {
  const probes: HealthProbePort[] = [new MongoHealthProbe(), new RedisHealthProbe()];
  const getHealth = new GetHealthUseCase(probes);
  return { router: buildHealthRouter(makeGetHealthController(getHealth)), contract: { … } };
}
```

Swapping an implementation is one line, in one file, and "what actually runs in production" has
a single greppable answer.

---

## Proof: the Postgres to Mongo switch

The strongest argument for this structure is not theoretical — it is this project's own
history.

The original design ([`../03-database-schema.md`](../LLD/03-database-schema.md)) was PostgreSQL +
PostGIS: `ST_Contains` for zone resolution, database triggers for the invariants. That was
changed to MongoDB before a line of feature code was written.

What that change touches, under this architecture:

| Layer | Change |
|---|---|
| `domain/` | **none** — a `Zone` is still a named polygon with a parent |
| `application/` | **none** — the resolution algorithm is unchanged |
| `interface/` | **none** — the endpoints and error codes are identical |
| `infrastructure/` | **all of it** — `ST_Contains` → `$geoIntersects`, DDL → Mongoose schemas |
| `@driverzone/geo` | **added** — the invariants Postgres enforced with triggers |

The algorithm in [`../04-zone-resolution.md`](../LLD/04-zone-resolution.md) — resolve the point,
find the pickup zone, check the drop, match packages, return variants — did not change by a
single step. Only the sentence "how do I ask the database which polygons contain this point"
changed, and that sentence lives in one file per module.

Databases get replaced. That is the whole reason the layers exist.

---

## The honest costs

This is not free, and pretending otherwise makes people cynical about it.

**More files.** The `health` module is nine files to answer `GET /api/health`. In a plain
Express app that is one file with fifteen lines. The trade only pays off past a certain size —
and DriverZone, with eleven modules and rules worth disputing in court, is well past it.

**Reader indirection.** You cannot jump from a call site to the implementation; you land on an
interface. The mitigation is that `<name>.container.ts` always tells you, and it is the first
place to look.

**Tier assignment is a real decision.** Choosing a module's tier in
`.dependency-cruiser.cjs` decides what it may ever depend on. Getting it wrong is not fatal but
it is annoying to unwind once siblings rely on it. See
[11](11-adding-a-module.md#choosing-a-tier).

**It can be over-applied.** A module with one adapter that will never have another does not
need a port. Use judgement: the ceremony earns its place when the thing behind the interface is
genuinely likely to change, or when testing it otherwise requires infrastructure.
