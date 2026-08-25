# Testing

## What to test where

| Level | Runs against | Speed | Use for |
|---|---|---|---|
| **Unit** | nothing — pure functions and fakes | ms | Domain rules, use cases, everything in `packages/geo` and `pricing` |
| **Integration** | real Mongo + Redis | seconds | Repositories, the atomic claim, transactions |
| **API** | the Express app via supertest | seconds | Routes, validation, error envelopes |
| **E2E** | a running stack | minutes | The few flows worth the maintenance |

Weight the pyramid heavily toward unit. The architecture exists to make that possible — if a
rule needs a database to test, it is in the wrong layer.

## Unit tests: the payoff of the layers

`test/health.test.ts` runs with no database, no Redis, no Express:

```ts
const probe = (name: string, status: 'up' | 'down'): HealthProbePort => ({
  name,
  check: async () => ({ name, status }),
});

const r = await new GetHealthUseCase([probe('mongodb', 'up'), probe('redis', 'down')]).execute();
expect(r.status).toBe('degraded');
```

A three-line object literal substitutes for `MongoHealthProbe` because both satisfy
`HealthProbePort`. Nothing is mocked, no module registry is patched, the whole file runs in 10ms.

That is only possible because `GetHealthUseCase` is typed against the port
([02](clean-architecture-and-solid.md#l--liskov-substitution)). **If a unit test needs
`vi.mock`, treat it as a design smell first** — usually the code is importing a concrete class
where it should take a port.

### The two suites that matter most

**`packages/geo`** — 31 tests. These carry the zone invariants that used to be database
triggers, so a bug here is a bad polygon in production. Every case from
[`../LLD/zone-resolution.md`](../LLD/zone-resolution.md) is covered, including the awkward ones:

```ts
it('rejects a swapped coordinate rather than resolving it to the wrong place', …);
it('allows neighbours that share a border exactly', …);      // Z-2 tolerance
it('does not call a brief corner-clip a hill trip', …);      // terrain threshold
it('stops after Z-3 rather than reporting nonsense derived from a broken polygon', …);
```

> One of these caught a bad *test fixture* during development: two polygons intended to overlap
> only touched at an edge, and `checkOverlap` correctly stayed silent. The 100 m² tolerance was
> doing exactly its job — distinguishing a real overlap from two hand-drawn neighbours sharing a
> border. Worth knowing the rule is that precise.

**`pricing`** (when it lands) — pure by design, at tier 0. Fares are what customers dispute, so
this suite should be exhaustive and fast enough that nobody skips it. Add a property test for
the reconciliation invariant:

```ts
// For any valid fare: driver + company + allowance + tax === total.
// A breakdown that does not reconcile is how you end up unable to close the books.
```

## Integration tests

For repositories and anything touching a transaction. Use **`mongodb-memory-server`** with a
replica set — the dispatch claim and the booking→ledger write both need transactions:

```ts
const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
```

Faster than Testcontainers and needs no Docker daemon in CI. Reach for Testcontainers only if a
behaviour differs between the in-memory server and real Mongo.

Keep integration tests in `test/integration/` behind a separate script so `pnpm test` stays fast:

```json
"test": "vitest run",
"test:integration": "vitest run --config vitest.integration.config.ts"
```

### The one integration test to write first

The **atomic dispatch claim**. Everything else in
[`../LLD/dispatch-and-assignment.md`](../LLD/dispatch-and-assignment.md) is recoverable; a
double-assignment means two drivers at one pickup and a customer paying twice.

```ts
it('assigns exactly one driver when twenty claim simultaneously', async () => {
  const results = await Promise.all(
    driverIds.map((id) => dispatch.claim(bookingId, id)),
  );
  expect(results.filter((r) => r.claimed)).toHaveLength(1);
});
```

Run it with real concurrency, not sequentially. The point is the race.

## API tests

Supertest against `createApp()` — which is why `app.ts` builds the app without opening a
listener:

```ts
const res = await request(createApp()).get('/api/health');
expect(res.status).toBe(200);
expect(res.body.success).toBe(true);
```

Worth covering: the error envelope shape, validation rejections, auth on protected routes, and
that an `available: false` result returns **200** rather than 4xx
([05](coding-standards.md#unavailable-is-not-an-error)).

## What not to test

- **Framework behaviour.** Express routes to the handler. Mongoose saves documents.
- **Types.** The compiler already did.
- **Getters, or a container's wiring.** If `buildHealthContainer()` is wrong, every test in the
  module fails anyway.
- **Adapters, in unit tests.** `MongoHealthProbe` is three lines around a library call; test it
  in integration or not at all.

## Fixtures

Geometry fixtures live in `packages/geo/test/fixtures.ts` and are shared. They model a real
place — Siliguri at 26.71N, 88.43E — because reasoning about "is this polygon inside that one"
is much easier when the shapes correspond to somewhere you can picture.

```ts
SILIGURI_CITY        // CITY,  lng 88.35–88.50, lat 26.65–26.78
CENTRAL_PICKUP       // PICKUP, FREE, well inside
PAID_PICKUP          // PICKUP, PAID, shares CENTRAL's edge        → border must resolve FREE
EASTERN_PICKUP       // PICKUP, shares CENTRAL's east edge exactly → must NOT be an overlap
STRADDLING_PICKUP    // PICKUP, crosses the north city boundary   → legal; the outside half
                     //                                              drives PICKUP_OUTSIDE_CITY
CLOCKWISE_RING       // valid shape, wrong winding                 → must be stored rewound
BOWTIE               // self-intersecting                          → Z-3 violation
DARJEELING_HILLS     // HILL
ROUTE_TO_HILLS       // long climb                                 → HILL
ROUTE_GRAZING_HILLS  // clips a corner                             → PLAIN
```

Each fixture exists to make one boundary case testable. When you add one, say in a comment which
case it is for — otherwise the next person will "simplify" it and quietly delete a test's whole
point.

## Running

```bash
pnpm test                                # everything, via turbo
pnpm --filter @driverzone/geo test
pnpm --filter @driverzone/api test
pnpm --filter @driverzone/geo exec vitest --watch
pnpm --filter @driverzone/api test:integration
```

Note that turbo cancels sibling tasks when one fails, so a failure elsewhere can make a passing
suite look failed. Re-run the single package before investigating.

## Before merging

```bash
pnpm check    # typecheck + lint + test, 18 tasks
```

`lint` includes `lint:deps`. A boundary violation fails the build, and under MongoDB that rule
is protecting data integrity rather than tidiness — see
[04](boundaries-and-enforcement.md#module-internals-are-private).
