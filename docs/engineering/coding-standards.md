# Coding Standards

Conventions that are not enforced by a linter, plus the reasoning for the ones that are.

## Money

**Always integer paise. Never a float, never rupees.**

```ts
const base_fare_paise = 149950;   // ₹1,499.50
```

Floating-point arithmetic on money produces receipts whose lines do not sum to the total, and
customers notice. `0.1 + 0.2 !== 0.3` on a fare breakdown is a support ticket.

- Every amount field ends in `_paise` (wire/DB) or `Paise` (TypeScript). No exceptions — the
  suffix is how a reviewer spots a unit error.
- Percentages are **basis points**: `2500` = 25%. Also integers.
- Round **once, at the end**, to the nearest rupee. Rounding intermediate components makes the
  lines not add up.
- `parseFloat` is banned by ESLint. If you need it for something that is not money, use
  `Number()` and say why in a comment.

Money crosses the wire twice — as an integer to compute with, and preformatted to render:

```ts
{ amount_paise: 105000, amount_display: "₹1,050" }
```

Four clients formatting independently means four subtly different results. The server formats
once.

## Coordinates

`{ lat, lng }` in application code. `[lng, lat]` in GeoJSON and MongoDB.

**The conversion happens in exactly one place** — `@driverzone/geo`. Never inline it.

```ts
import { toGeoJsonPoint, assertPlausibleCoordinate } from '@driverzone/geo';

assertPlausibleCoordinate(input.pickup, 'pickup');   // at the API boundary, always
const point = toGeoJsonPoint(input.pickup);
```

A swap does not throw on its own: Siliguri's `26.72, 88.39` silently becomes a point in the
Arabian Sea, matches no zone, and tells a customer standing in a city you serve that you do not
serve it. `assertPlausibleCoordinate` is a tripwire for that and for an unpopulated `0,0`.

## Units

| Quantity | Unit | Suffix |
|---|---|---|
| Money | paise | `_paise` |
| Percentage | basis points | `_bps` |
| Distance | metres | `_m` / `Metres` |
| Duration | minutes | `_minutes` / `Min` |
| Timeouts | seconds | `_seconds` |
| Timestamps | UTC `Date` | `_at` |

Suffix everything. `distance` is a question; `distance_m` is an answer.

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files | `camelCase.<role>.ts` | `campaignRecipient.repository.impl.ts` |
| Entities | `<thing>.entity.ts` | `booking.entity.ts` |
| Ports | `<thing>.port.ts` | `zoneRepository.port.ts` |
| Use cases | `<verb><Thing>.usecase.ts` | `createBooking.usecase.ts` |
| Mongoose models | `<thing>.model.ts` | `zone.model.ts` |
| Adapters | `<thing>.<tech>.ts` | `dispatchQueue.bullmq.ts` |
| Contracts | `<Consumer><Purpose>Contract` | `ZoneResolutionContract` |
| Classes | `PascalCase` | `GetHealthUseCase` |
| Factories | `make…` / `build…` | `makeGetHealthController` |

`make…` returns a handler; `build…` returns a composed object (a router, a container). A small
distinction that makes the container readable at a glance.

## Errors

Everything throws `AppError` or a subclass. The error handler
(`shared/http/error-handler.ts`) is the only place an error becomes a response.

```ts
throw AppError.notFound('That booking no longer exists.');
throw AppError.conflict('This trip was just taken by another driver.');
throw AppError.internal('ZONE_CONFIG_FAULT', { zoneId, point });
```

**`message` is shown to the user.** It must never carry a cause, a query, an id, or a stack.
Diagnostics go in `details`, which is logged and stripped from production responses.

### Expected vs fault

`AppError.isExpected` decides what pages someone.

- **Expected** (`400`, `404`, `409`): traffic, not incidents. Logged at `info`.
- **Fault** (`AppError.internal`, `isExpected: false`): a violated invariant. Logged at `error`
  with a stack, and alerts.

Logging expected errors at `error` trains everyone to ignore the error log, which is how a real
fault goes unnoticed. This distinction is the whole reason the flag exists.

### "Unavailable" is not an error

Zone-resolution outcomes — no pickup coverage, drop outside the city, no package for that
distance — return **HTTP 200** with `available: false`:

```jsonc
{
  "available": false,
  "reason": "ZONE_NO_PICKUP_COVERAGE",
  "message": "We don't have drivers at your pickup location yet."
}
```

These are the system working correctly. Returning 4xx buries genuine faults under expected
traffic and makes the error rate meaningless. See
[`../LLD/zone-resolution.md`](../LLD/zone-resolution.md).

Clients render `message` verbatim and never build copy from `reason` — that way a reason added
server-side displays correctly on app versions that predate it, which matters when the old
version is a store binary you cannot recall.

## Logging

pino, JSON to stdout in production, pretty in development. Nothing writes log files — the
container runtime owns collection.

### Argument order

```ts
logger.info({ bookingId, driverId }, 'driver assigned');   // data first, message second
```

The reverse of winston's. Getting it backwards does not throw: pino logs the object as the
message and drops every field.

### Levels

| Level | Means | Example |
|---|---|---|
| `fatal` | the process is going down | invalid env, cannot reach Mongo at boot |
| `error` | a fault; someone should look | unhandled throw, `AppError` with `isExpected: false` |
| `warn` | degraded but handled | Redis reconnecting, health probe timed out, 4xx response |
| `info` | a state change worth reconstructing later | booking created, driver assigned, wave escalated |
| `debug` | developer detail, off in production | container wiring, cache hit/miss |
| `trace` | per-iteration noise, never on in production | — |

Production runs at `info`. The rule above still governs: expected errors log at `info`, not
`error`.

### Messages are static; data goes in the object

```ts
logger.info(`otp ${otp} sent to ${phone}`);        // ✗ lint error
logger.info({ requestedBy }, 'otp sent');          // ✓
```

**This is a redaction rule, not a style rule.** `redact` matches object paths and cannot see
inside a string, so an interpolated message bypasses every entry in the list — the example above
writes a live trip-start code to stdout. `no-restricted-syntax` in `apps/api/.eslintrc.cjs`
enforces it. It also makes logs aggregatable: a static message groups, an interpolated one is
unique per request.

### What is never logged

Configured in `shared/logging/logger.ts`, derived from the payloads in
[`../LLD/api-contracts.md`](../LLD/api-contracts.md): OTPs (`otp`, `start_otp`), phone
numbers (`phone`, `masked_phone`), credentials (`token`, `password`, `refresh_token`,
`authorization`), `idempotency-key`, and `address` / `customer_car_plate`.

**Coordinates are deliberately not redacted.** A lat/lng is what you debug dispatch with, and
one point in one line is a different exposure from a stored trace. The rule that protects
location instead: never log a route or a trace whole — log the zone ID it resolved to.

### What is never logged *at all*

Two paths are excluded from the access log, and both would otherwise drown everything else:

- `/api/health` — polled every 15 s by the container healthcheck, ~5,700 lines a day carrying
  no information. Excluded only while it succeeds.
- The driver location ping — 200 writes/s sustained
  ([`../LLD/architecture.md`](../LLD/architecture.md)). That is a metric, not a log; at
  one line each it is ~17M lines a day.

The access log records the route **pattern** (`/api/bookings/:id`), never the raw URL. Raw paths
carry identifiers, which makes "how often does this endpoint 500" unanswerable and puts IDs in a
retained, indexed field.

## Async

Every async Express handler goes through `asyncHandler`:

```ts
export const makeXController = (useCase: XUseCase): RequestHandler =>
  asyncHandler(async (req, res) => {
    sendSuccess(req, res, await useCase.execute(req.body));
  });
```

Express 4 does not await handlers. Without this, a rejected promise is an unhandled rejection
and a request that hangs until the client times out — no 500, nothing in the error handler,
nothing useful in the logs.

## Validation

Zod at the boundary, in `interface/<module>.validation.ts`. Parse into a typed DTO; use cases
receive validated data and never re-check it.

```ts
export const createBookingSchema = z.object({
  quote_id: z.string().uuid(),
  customer_car_plate: z.string().min(4).max(16),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
```

Validate once, at the edge. A use case that defends against malformed input is a use case whose
type signature is lying.

## TypeScript

`packages/config/tsconfig.base.json` is strict, and three settings do real work:

| Setting | Catches |
|---|---|
| `noUncheckedIndexedAccess` | `arr[i]` is `T \| undefined`. Every off-by-one and sparse lookup. |
| `exactOptionalPropertyTypes` | `{ ip: undefined }` is not the same as `{}`. Stops `undefined` serialising into a response as `null`. |
| `verbatimModuleSyntax` | A value import of a type-only symbol is an error, not a runtime surprise. |

> These caught four real bugs during scaffolding, before any feature code existed —
> `mongoose.readyState` is `0-3` **plus 99**, which a four-element tuple cannot index; and
> `req.ip` is `string | undefined`, which would have put `"ip": null` in every response
> envelope. Keep them on. When one blocks you, it has found something.

Other rules:

- **No `any`.** `unknown` plus a narrowing check.
- **No non-null `!`** except immediately after a check the compiler cannot see, with a comment.
- **`import type`** for type-only imports (auto-fixable).
- **ESM**: relative imports carry the `.js` extension even from `.ts` sources. This is NodeNext,
  not a mistake.

## Comments

Comment the **why**, never the what. The code says what.

```ts
// Bad — restates the code
// Loop through the probes and check each one
for (const probe of probes) { … }

// Good — explains a decision the code cannot
// Settled rather than all: one probe throwing must not hide the status of every other
// dependency — that turns a Redis blip into "we know nothing about anything".
const results = await Promise.allSettled(probes.map((p) => p.check()));
```

Worth a comment:

- A non-obvious ordering or timing constraint
- A workaround, with the upstream issue
- A performance decision and its measurement
- A rejected alternative and why
- Anything that will read as a mistake to someone who lacks the context

Not worth a comment: restating a signature, `// constructor`, a changelog (that is git).

**File headers** on anything structural — every `.public.ts`, every container, every config.
Say what the file is for and what breaks if it is wrong. `apps/api/.dependency-cruiser.cjs` is
the model.

## Commits

```
<module>: <imperative summary>

Why this change, and what was rejected.

Refs: docs/LLD/dispatch-and-assignment.md §Waves
```

`dispatch: escalate wave on empty candidate set`, not `fix dispatch`. The module prefix makes
`git log --oneline` navigable in a monorepo.
