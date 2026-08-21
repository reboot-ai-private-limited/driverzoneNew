# DriverZone — Engineering Handbook

How this codebase is built and why. If you are new here, read `01` through `04` in order —
that is roughly an hour and covers every decision you need to make sense of the rest.

The product documentation lives one level up in [`../`](../README.md): what DriverZone does,
the zone model, pricing, dispatch. This directory is about the *code*.

## Read in this order

| # | Doc | Answers |
|---|-----|---------|
| — | [Day one](#day-one) | Clone to running stack |
| 01 | [Monorepo layout](01-monorepo-layout.md) | What's in `apps/` vs `packages/`, and where new code goes |
| 02 | [Clean architecture & SOLID](02-clean-architecture-and-solid.md) | The layer rules, each SOLID principle with a real example from this codebase |
| 03 | [Module anatomy](03-module-anatomy.md) | `.public.ts`, the container, tiers, how a request flows end to end |
| 04 | [Boundaries & enforcement](04-boundaries-and-enforcement.md) | Every lint rule, what it catches, what breaks without it |
| 05 | [Coding standards](05-coding-standards.md) | Naming, errors, money, comments |
| 06 | [Tech choices](06-tech-choices.md) | Every dependency: why it's here, what was rejected, when to revisit |
| 07 | [Shared packages](07-shared-packages.md) | What belongs in `contracts` / `geo` / `design-system` / `mobile-ui` — and what must never |
| 08 | [Mobile in the monorepo](08-mobile-in-monorepo.md) | Expo + pnpm + Metro, and the resolution trap |
| 09 | [Build & deploy](09-build-and-deploy.md) | Artifacts, images, CI filtering, what deploys where |
| 10 | [Testing](10-testing.md) | What to test at which level, and with what |
| 11 | [Adding a module](11-adding-a-module.md) | The checklist |

## Day one

```bash
git clone <repo> && cd driverzone
corepack enable && corepack prepare pnpm@11.18.0 --activate
pnpm install

cp apps/api/.env.example apps/api/.env

docker compose up -d mongo mongo-init redis    # Mongo needs the replica-set init to accept writes
pnpm --filter @driverzone/api dev               # :4000
pnpm --filter @driverzone/web dev               # :3000

curl localhost:4000/api/health
```

Verify everything at once:

```bash
pnpm turbo run typecheck lint test    # 18 tasks, all should pass
```

## The three things worth knowing immediately

**1. Modules talk through `.public.ts` and nothing else.**
`src/modules/dispatch/` cannot import `src/modules/bookings/domain/booking.entity.js`. It
imports `bookings.public.js`. This is machine-enforced — see `04`. It costs nothing at
runtime: the contract file is types only and leaves no trace in the shipped bundle.

**2. `pnpm lint:deps` protects data integrity, not just tidiness.**
The zone invariants in [`../02-domain-model.md`](../02-domain-model.md) were originally
PostGIS triggers, so a bad polygon was impossible to save. MongoDB cannot express a
cross-document geometric constraint, so those checks moved into `@driverzone/geo` and run in
the `zones` module's write path. That is a real guarantee only while nothing else can reach
`zones/infrastructure/` — which is exactly what the boundary rule enforces. See `04`.

**3. Money is integer paise. Always.**
`₹1,499.50` is `149950`. Never a float, never rupees. Every amount field ends in `_paise` or
`Paise`. See `05`.

## Conventions inherited from the product docs

- Coordinates are `{lat, lng}` in application code and `[lng, lat]` in GeoJSON/MongoDB. The
  conversion happens in exactly one place — `@driverzone/geo`. Never inline it.
- Distance is metres, duration is minutes.
- Timestamps are stored UTC, rendered `Asia/Kolkata`.
