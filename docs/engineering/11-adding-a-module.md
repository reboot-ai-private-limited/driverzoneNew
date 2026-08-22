# 11 — Adding a Module

Copy `apps/api/src/modules/health/`. It is the reference implementation and it is deliberately
small enough to read in five minutes.

## Checklist

```
[ ] 1. Decide the tier and add it to MODULE_TIERS
[ ] 2. Create the directory structure
[ ] 3. Write domain/ first — entities, rules, ports
[ ] 4. Write the use cases against those ports
[ ] 5. Write <module>.public.ts — the contract
[ ] 6. Write infrastructure/ — the adapters
[ ] 7. Write interface/ — controller, routes, validation
[ ] 8. Write <module>.container.ts — the wiring
[ ] 9. Build it in src/container.ts, mount it in src/routes.ts
[ ] 10. Unit-test the domain and use cases with fakes
[ ] 11. pnpm --filter @driverzone/api lint:deps
```

The order matters. Writing `domain/` first forces you to decide what the module *is* before
what it talks to, and the ports fall out of the use cases rather than being reverse-engineered
from a Mongoose schema.

## Choosing a tier

This is the decision that is hardest to unwind, because siblings start depending on your
placement immediately.

```js
const MODULE_TIERS = [
  ['health', 'settings', 'pricing'],
  ['identity'],
  ['notifications', 'ledger'],
  ['zones'],
  ['catalog'],
  ['quotes'],
  ['bookings'],
  ['dispatch'],
  ['admin', 'reporting'],
];
```

Ask, in order:

1. **What must this module import?** It must sit strictly above all of them.
2. **What will import this module?** They must sit strictly above it.
3. **Can it be pure?** A module with no I/O belongs at tier 0, and that is worth engineering
   for. `pricing` is there because plain-data-in, breakdown-out is what makes fare logic
   exhaustively testable — the property that matters most for the logic customers dispute.

**Same-tier imports are forbidden.** If your module genuinely needs a sibling on its own tier,
one of you is on the wrong tier. Decide which before editing the list.

**Lower is better.** A module at tier 2 can be consumed by everything above it. A module at tier
8 can be consumed by almost nothing. Push work downward where you can.

If you find yourself wanting to move an existing module up, stop — that usually means a
dependency is backwards. See [04](04-boundaries-and-enforcement.md#when-a-rule-blocks-you).

## Designing the contract

`<module>.public.ts` is the part worth thinking hardest about. Everything else is recoverable;
a bad contract propagates into every consumer.

**Split by consumer, not by entity.**

```ts
// Two consumers, two interfaces. dispatch physically cannot mutate a polygon.
export interface ZoneResolutionContract { resolveAt(p: LatLng): Promise<ResolvedZones>; }
export interface ZoneAdminContract      { updateGeometry(id, geom, actor): Promise<Zone>; }
```

**Answer-shaped, not data-shaped.**

```ts
// bad — hands out the document and lets the caller apply this module's rules
getBooking(id): Promise<Booking>;

// good — the caller reports what happened; this module decides what it means
recordDeliveryStatus(input: { bookingId: string; status: string }): Promise<void>;
```

**Batch.** A contract method called inside `.map()` is a query per row. Return a `Map`.

**Take the tenant scope as a parameter.** `namesByIds(customerId, ids)` — an id from another
customer resolves to nothing rather than leaking a name, and the caller cannot forget to scope
it.

**Document the obligations.** If a caller must only invoke a method when something actually
happened — a status genuinely changed, not a duplicate webhook — say so in the doc comment. A
counter nothing decrements is a support ticket three weeks later.

## Skeleton

```
src/modules/<name>/
├── <name>.public.ts
├── <name>.container.ts
├── domain/
│   ├── <thing>.entity.ts
│   ├── <thing>.errors.ts
│   └── <thing>.repository.port.ts
├── application/
│   ├── dto/<name>.dto.ts
│   └── useCases/<verb><Thing>.usecase.ts
├── infrastructure/
│   ├── <thing>.model.ts
│   └── <thing>.repository.impl.ts
└── interface/
    ├── <name>.controller.ts
    ├── <name>.routes.ts
    └── <name>.validation.ts
```

Not every module needs every file. A module with no HTTP surface has no `interface/`; a module
with no persistence has no repository. Do not create empty directories to match the template.

## Wiring it up

```ts
// src/container.ts — module wiring, imported by BOTH entrypoints
export function buildContainers(): AppContainers {
  const health   = buildHealthContainer();                       // tier 0
  const identity = buildIdentityContainer();                     // tier 1
  const zones    = buildZonesContainer({ settings: settings.contract });  // tier 3

  return { health, identity, zones };
}

// src/routes.ts — the HTTP half, imported by the server only
export function buildApiRouter(c: AppContainers): Router {
  const router = Router();
  router.use('/health', c.health.buildRouter());
  router.use('/zones',  c.zones.buildRouter());
  return router;
}
```

Build in tier order. Dependencies arrive as **contracts**, never as containers — a container is
a construction detail, a contract is a promise.

If the wiring ever needs to run backwards to satisfy a dependency, the tiers are wrong.

## Verify

```bash
pnpm --filter @driverzone/api typecheck
pnpm --filter @driverzone/api lint        # eslint + depcruise
pnpm --filter @driverzone/api test
```

`lint:deps` will tell you immediately if the tier is wrong:

```
error tier-3-zones: zones may import only: health, settings, pricing, identity,
  notifications, ledger. An import pointing sideways or upward means either the
  dependency is backwards, or this module belongs on a different tier — decide
  which before editing MODULE_TIERS.
```

## Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `module-internals-are-private` | Imported another module's `domain/` or container | Import its `.public.js`; add to that contract if the thing you want is missing |
| `application-depends-on-ports-not-adapters` | Use case typed against the Mongoose repository class | Type it against the port in `domain/` |
| `domain-imports-nothing-above-it` | An entity imports a type from `infrastructure/` | Move the type into `domain/`. The schema must not own a domain shape — and yes, `import type` counts |
| `no-circular` | Two files import each other | Usually a shared type that belongs in a third file |
| `not-to-unresolvable` | Missing `.js` on a relative import | This is NodeNext ESM. Add the extension |
| Tier error on a brand-new module | Not added to `MODULE_TIERS` | Add it, and choose the tier deliberately |

## A worked example: `zones`

Tier 3. Consumes `settings` (for the hill threshold). Consumed by `quotes`, `dispatch`, `admin`.

```
zones/
├── zones.public.ts
│     ZoneResolutionContract   — resolveAt(), findHillZonesNear()   [hot path, read-only]
│     ZoneAdminContract        — create(), updateGeometry(), validate()  [admin only]
├── zones.container.ts
├── domain/
│   ├── zone.entity.ts            Zone, ZoneType, ResolvedZones
│   ├── zone.errors.ts            ZoneConfigFaultError, ZoneOverlapError
│   └── zone.repository.port.ts   findContaining(point), save(zone), findSiblings(...)
├── application/useCases/
│   ├── resolveZonesAtPoint.usecase.ts
│   ├── createZone.usecase.ts        ← calls validateZone() from @driverzone/geo
│   └── validateZoneGeometry.usecase.ts
├── infrastructure/
│   ├── zone.model.ts                Mongoose schema + 2dsphere index
│   └── zone.repository.impl.ts      $geoIntersects
└── interface/
    ├── zones.controller.ts
    ├── zones.routes.ts
    └── zones.validation.ts
```

Two things about this module specifically:

**`createZone.usecase.ts` is the invariant choke point.** It calls `validateZone()` from
`@driverzone/geo` and refuses to save on any ERROR violation. Under PostGIS this was a database
trigger; under MongoDB this use case *is* the guarantee. It is only a real guarantee because
`module-internals-are-private` stops anything else reaching `zones/infrastructure/` — which is
why [04](04-boundaries-and-enforcement.md) calls `lint:deps` load-bearing.

**The read/write contract split is not cosmetic.** `dispatch` gets
`ZoneResolutionContract` and therefore *cannot* call `updateGeometry` — the method is not on the
object it was handed. That is what stops the invariant choke point from being bypassed by a
future well-meaning change in another module.
