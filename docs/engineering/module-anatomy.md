# Module Anatomy

Every API module has the same shape. `apps/api/src/modules/health/` is the reference
implementation — small enough to read in five minutes, complete enough to copy.

```
<module>/
├── <module>.public.ts        the ONLY file other modules may import
├── <module>.container.ts     the ONLY file that names concrete classes
├── domain/
│   ├── <thing>.entity.ts     what it IS + the rules
│   ├── <thing>.errors.ts     module-specific AppError subclasses
│   └── <thing>.port.ts       what the domain NEEDS, without naming a provider
├── application/
│   ├── useCases/<verb><Thing>.usecase.ts
│   └── dto/<module>.dto.ts
├── infrastructure/
│   ├── <thing>.model.ts             Mongoose schema
│   ├── <thing>.repository.impl.ts   implements the port
│   └── <thing>.<tech>.ts            other adapters (bullmq, redis, http)
└── interface/
    ├── <module>.controller.ts
    ├── <module>.routes.ts
    └── <module>.validation.ts       Zod schemas
```

## `<module>.public.ts` — the contract

The single surface other modules may import. Everything else in the directory is private, and
that is enforced, not requested ([04](boundaries-and-enforcement.md)).

```ts
import type { HealthReport } from './domain/health.entity.js';

/** Aggregate reads. Consumed by the admin dashboard's status tile. */
export interface HealthReportContract {
  report(): Promise<HealthReport>;
}

export type HealthPublicContract = HealthReportContract;
export type { DependencyHealth, HealthReport } from './domain/health.entity.js';
```

### It costs nothing at runtime

The most common objection to this pattern is that the indirection must be slow. It is not —
the file contains no runtime code at all.

Verified in this repository:

```
$ tsc --outDir /tmp/erasure          # with isolatedModules, TS emits a module marker
$ cat /tmp/erasure/modules/health/health.public.js
export {};                            # 52 bytes, nothing executes

$ pnpm --filter @driverzone/api build # esbuild drops the empty module entirely
$ grep -c 'HealthReportContract' dist/server.js
0
$ grep -c 'health.public' dist/server.js
0
$ grep -o 'MongoHealthProbe' dist/server.js | wc -l
2                                     # the real class is right there
```

The contract leaves **no trace** in the shipped bundle. A call through it is a plain method
call on an object the container already injected — the same machine code as calling the class
directly. There is no proxy, no serialisation, no dispatch table.

### Designing a good contract

**Split by consumer, not by entity.** Two consumers wanting different things get two
interfaces. See Interface Segregation in [02](clean-architecture-and-solid.md).

**Make it answer-shaped, not data-shaped.** Compare:

```ts
// bad — hands out the document and lets the caller apply this module's rules
getCampaign(id): Promise<Campaign>;

// good — the caller states what happened; this module decides what it means
recordDeliveryStatus(input: { bookingId: string; status: string }): Promise<void>;
```

The first duplicates the counting rules into every consumer and puts them in the wrong module.

**Batch, don't invite N+1.** A contract called inside a `.map()` is a query per row.

```ts
// The DLR table shows a name per row. One call per page, whatever the page size.
namesByIds(customerId: string, ids: string[]): Promise<Map<string, string>>;
```

**Scope by tenant in the signature.** `namesByIds(customerId, ids)` rather than
`namesByIds(ids)`: an id belonging to another customer resolves to nothing instead of leaking
a name. Making the caller pass the scope means they cannot forget it.

## `<module>.container.ts` — the composition root

The one file allowed to name concrete classes. Every layer above types against ports; this is
where ports meet adapters.

```ts
export interface HealthContainer {
  contract: HealthPublicContract;
  buildRouter: () => Router;
}

export function buildHealthContainer(): HealthContainer {
  const probes: HealthProbePort[] = [new MongoHealthProbe(), new RedisHealthProbe()];
  const getHealth = new GetHealthUseCase(probes);

  return {
    contract: { report: () => getHealth.execute() },
    buildRouter: () => buildHealthRouter(makeGetHealthController(getHealth)),
  };
}
```

**`buildRouter` is a function, not a `router` property.** Both entrypoints build every
container — the worker needs the same contracts the HTTP server does — but only one of them
serves HTTP. As a property, every module would allocate a router, its middleware and its
validation schemas inside a process with no listener. As a function, `buildApiRouter` calls it
and the worker never does.

A container that needs another module's contract takes it as an argument:

```ts
export interface DispatchDeps {
  bookings: BookingLifecycleContract;
  drivers: DriverAvailabilityContract;
  zones: ZoneResolutionContract;
  notifications: PushContract;
}

export function buildDispatchContainer(deps: DispatchDeps): DispatchContainer { … }
```

Dependencies arrive as **contracts**, never as containers. A container is a construction
detail; a contract is a promise.

## `src/routes.ts` — the application composition root

Where every module is built, in tier order, and contracts are threaded between them.

```ts
export function buildContainers(): AppContainers {
  // tier 0 — depends on no other module
  const health = buildHealthContainer();
  return { health };
}
```

As modules land this becomes the readable summary of the entire dependency graph. The tier
list in `.dependency-cruiser.cjs` is the machine-checked version of what this file does by
hand — and if the wiring here ever needs to run backwards, the tiers are wrong.

## Module tiers

A module may import only from a **strictly lower** tier. Same-tier imports are forbidden too:
two modules on one tier importing each other is exactly the mutual coupling this prevents.

```js
const MODULE_TIERS = [
  ['health', 'settings', 'pricing'], // pricing is PURE: rates in, FareBreakdown out, no I/O
  ['identity'],                      // customers, drivers, admins, auth
  ['notifications', 'ledger'],       // push/socket fan-out; earnings entries
  ['zones'],                         // polygons, resolution, the invariant write guard
  ['catalog'],                       // packages, variants, prices
  ['quotes'],                        // zones + catalog + pricing
  ['bookings'],                      // quotes + pricing + identity + notifications + ledger
  ['dispatch'],                      // the only module permitted to set bookings.driverId
  ['admin', 'reporting'],            // top of the graph; nothing may depend on these
];
```

Two entries worth explaining:

**`pricing` at tier 0.** It could sit above `catalog` and read price rows itself. Keeping it
pure — plain data in, a breakdown out — is what lets the fare logic be tested exhaustively with
no database. Fares are the thing customers dispute; that test suite needs to be cheap enough
that nobody skips it.

**`dispatch` near the top, alone.** It is the only module permitted to write
`bookings.driverId`. One module owning the assignment race is what keeps the atomic claim in
[`../LLD/dispatch-and-assignment.md`](../LLD/dispatch-and-assignment.md) correct — two writers
would reintroduce double-assignment no matter how careful each one was.

## How a request flows

`GET /api/health`, end to end:

```
server.ts               connects Mongo, then opens the listener
  └─ app.ts             helmet, cors, json → mounts /api
      └─ routes.ts      buildContainers() → buildApiRouter()
          └─ health.container.ts
              ├─ new MongoHealthProbe()      infrastructure  ← knows Mongoose exists
              ├─ new RedisHealthProbe()      infrastructure
              ├─ new GetHealthUseCase([…])   application     ← typed against the PORT
              ├─ makeGetHealthController()   interface
              └─ buildHealthRouter()         interface

request →  router  →  controller           interface     HTTP → call
                   →  useCase.execute()     application   orchestration
                   →  probe.check()         infrastructure the actual I/O
                   →  summarise(deps)       domain        the rule
                   ←  HealthReport
                   ←  sendSuccess(200 | 503)
```

Note the controller returns **503** when degraded rather than 200 with a `degraded` field. A
load balancer acts on status codes; a JSON field reads fine to a human and is invisible to
every orchestrator in existence.

## Two composition roots, one image

`src/server.ts` and `src/worker.ts` both call `buildContainers()`. They build the same modules
from the same code and differ only in what they do with them: the server hands them to routes,
the worker hands them to queue consumers.

They ship in **one Docker image** with different `CMD`s, which is what stops them drifting.
See [09](build-and-deploy.md).
