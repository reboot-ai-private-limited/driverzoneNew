# Boundaries & Enforcement

Architecture that is only written down decays. Everything in
[02](clean-architecture-and-solid.md) and [03](module-anatomy.md) is machine-checked, and
this doc explains each rule and what breaks without it.

```bash
pnpm --filter @driverzone/api lint       # eslint + depcruise
pnpm --filter @driverzone/api lint:deps  # depcruise alone
```

Current state: **51 modules, 88 dependencies, 0 violations.**

## Why two tools

`.eslintrc.cjs` and `.dependency-cruiser.cjs` overlap, and that is deliberate.

|  | ESLint | dependency-cruiser |
|---|---|---|
| Sees | the literal import **string** | the **resolved file path** |
| Catches | `@/modules/x/domain/y.js` | that, plus `../../x/domain/y.js` |
| Cycles | cannot — a cycle is a graph property | yes |
| Speed | instant, in your editor | a few seconds, in CI |
| Role | the fast echo | **the authority** |

ESLint's `no-restricted-imports` matches the source string, so it can only catch the *aliased*
spelling of a cross-module reach. It is structurally unable to catch a relative escape: the
obvious pattern for it, `../../*/domain/*`, matches the `..` segment and so flags the legal
`../../domain/x.js` while missing the illegal `../../zones/domain/x.js` — exactly backwards.

dependency-cruiser resolves every import to a real path, so how it was spelled stops mattering.
Keep both: ESLint tells you in the editor seconds after you type it, depcruise tells you the
truth.

## The rules

### `not-to-unresolvable`

An import that resolves to nothing.

Usually a typo or a missing `.js` extension. But it has a second, far more dangerous meaning:
if the `@/` alias fails wholesale, every import becomes unresolvable, every import loses its
`to` path, and **every other rule in the file passes vacuously** — a green that means nothing.

Treat a spike here as the config being broken, not the code.

> This fired for real during setup. `@driverzone/geo` and `@driverzone/contracts` publish
> TypeScript source through an `exports` map, and the resolver ignored it until
> `exportsFields` and `conditionNames` were configured. Until then the workspace packages were
> invisible and the module count was 34 instead of 51 — a third of the graph unchecked, with a
> passing build.

### `no-circular`

A cycle between **files**.

TypeScript compiles one happily and ESM resolves it at runtime, so it surfaces as an
`undefined` dependency while a container is being constructed — far from the import that caused
it, and usually at 2am.

This is the runtime-breaking kind. Module-level cycles are a separate concern this rule cannot
see (see [tiers](#tier-rules)).

### `module-internals-are-private`

A module's layers, its container and every file at its root are private. Cross-module means
`<name>.public.ts`, nothing else.

Because it matches resolved paths, it closes the relative-escape, container and module-root
holes at once, whichever way the import is spelled.

**Under MongoDB this rule carries data integrity, not just tidiness.**

The zone invariants in [`../LLD/domain-model.md`](../LLD/domain-model.md) — pickup zones inside
their city, no same-type overlap, no self-intersection — were PostGIS triggers. A bad polygon
was *impossible to save*, from any code path, forever.

MongoDB cannot express a cross-document geometric constraint. Those checks now live in
`@driverzone/geo` and run in the `zones` module's write path. That is a genuine guarantee only
while nothing else can reach `zones/infrastructure/` and write a polygon that was never
validated — which is exactly what this rule enforces.

So: `pnpm lint:deps` is part of the data-integrity story. Do not disable it to unblock a merge.

### `domain-imports-nothing-above-it`

`domain/` is the innermost layer. It must not know that a Mongoose model or an Express route
exists.

**A type-only import counts.** `import type { X } from '../infrastructure/…'` still means the
schema, not the domain, owns `X` — and the day the schema changes, your business rules change
with it. This is why `tsPreCompilationDeps: true` is set; without it depcruise ignores
`import type` and reports a clean tree that is not clean.

### `application-depends-on-ports-not-adapters`

A use case depends on the port in `domain/`, never on the concrete adapter.

Typing a field against the class instead of the interface is what makes a use case untestable
without the real thing. The container is the only place that names an adapter.

### `interface-depends-on-ports-not-adapters`

Same rule one layer up: controllers and routers are handed what they need by the container and
type it against a port.

### `shared-is-below-modules`

`shared/` — db, http, errors, logging, queue — sits below every module. An import pointing the
other way inverts that and puts every module on the shortest path to a cycle.

### Tier rules

`no-circular` works on **files**, and a module-level cycle usually never becomes a file-level
one. A `.public.ts` imports nothing but its own domain types, so:

```
dispatch → bookings.public.ts    (bookings' domain types only)
bookings → dispatch.public.ts    (dispatch's domain types only)
```

…is two modules depending on each other with **no file cycle anywhere** for depcruise to find.
The tier list is what catches it.

```js
const MODULE_TIERS = [ ['health','settings','pricing'], ['identity'], … ];
```

A module may import only from a strictly lower tier. Same-tier imports are forbidden: two
modules on one tier importing each other is the mutual coupling this exists to prevent, so a
genuine dependency between them means one belongs on a higher tier.

**Adding a module means adding it here**, and that is deliberate — see
[11](adding-a-module.md#choosing-a-tier).

## Verify the rules actually work

A boundary rule nobody has seen fail is a boundary rule nobody trusts. Break one on purpose —
put an illegal import in a scratch file inside `application/`:

```ts
// apps/api/src/modules/health/application/__probe.ts
import { MongoHealthProbe } from '../infrastructure/mongoHealthProbe.adapter.js';
export const x = MongoHealthProbe;
```

```
$ pnpm --filter @driverzone/api lint:deps
error application-depends-on-ports-not-adapters:
  src/modules/health/application/__probe.ts
  → src/modules/health/infrastructure/mongoHealthProbe.adapter.ts
```

Then the type-only case, which is the one people assume slips through — a scratch file in
`domain/` importing from `interface/`:

```ts
// apps/api/src/modules/health/domain/__probe.ts
import type { Router } from 'express';
import { buildHealthRouter } from '../interface/health.routes.js';
export type X = typeof buildHealthRouter extends (r: never) => Router ? true : false;
```

```
$ pnpm --filter @driverzone/api lint:deps
error domain-imports-nothing-above-it:
  src/modules/health/domain/__probe.ts → src/modules/health/interface/health.routes.ts
```

Delete both scratch files afterwards. Both cases verified working in this repository.

## The one exemption, and why only ESLint needs it

`src/routes.ts` is the **application** composition root. Its entire job is to build module
containers and wire contracts between them, so importing a container is the point of it.

```js
overrides: [
  {
    files: ['src/routes.ts', 'src/app.ts', 'src/server.ts', 'src/worker.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
],
```

dependency-cruiser needs no equivalent, because its rule is scoped to `from: ^src/modules/` —
a file outside a module was never in scope.

That asymmetry is a neat illustration of the whole section: ESLint's rule is a flat glob with
no notion of where the importer lives, and needed a hand-maintained exemption list.
dependency-cruiser understood the structure and got it right without being told. The two tools
are not redundant.

## When a rule blocks you

In order of preference:

1. **The dependency is backwards.** Should the other module depend on you instead? Reversing an
   arrow usually reveals the contract was answer-shaped in the wrong direction.
2. **The contract is missing.** You want something reasonable that `.public.ts` does not
   expose. Add it — that is the design working.
3. **The tier is wrong.** A genuine dependency on a same-tier module means one of you belongs
   higher. Edit `MODULE_TIERS` and say why in the commit.
4. **The shared thing belongs in `shared/` or a package.** Two modules needing the same helper
   means it is owned by neither.

`// eslint-disable` on a boundary rule is not on this list. If you believe you have found the
case that justifies it, change the rule and explain it in the config — where the next person
will read it — rather than in a comment they will never find.
