# Changelog

Notable changes to this repository. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are no releases yet — the first shippable milestone is the phase 9 pilot in
[`docs/LLD/roadmap.md`](docs/LLD/roadmap.md). Everything lands under `Unreleased` until
then.

This is not the commit log. Commits are written for someone bisecting a regression; this is for
someone coming back after two weeks and asking what moved. For *why* something is the way it
is, see [`docs/decision-log.md`](docs/decision-log.md).

## [Unreleased]

### Added

- `docs/LLD/zones.md` — the zones module LLD. What each zone type is actually for, the contract
  split between resolution and admin, the write path and its choke point, versioning, the full
  HTTP surface with success and fault codes, and an edge-case matrix covering the write path,
  the read path and operations. The rows marked ⚠ are the ones that fail *silently* if skipped.
- The MongoDB ring-winding trap, written down for the first time: a clockwise exterior ring is
  read by a `2dsphere` index as the whole earth minus the shape, with no error anywhere. Fixed
  by normalising with `@turf/rewind` in the write path.
- `coverageRequests` and `unservedDistanceRequests` now have proper sections in
  `docs/LLD/database-schema.md` instead of existing only inline in the resolution doc.

### Changed

- **Pickup zones are a serviceability gate and a fee, nothing else.** They have no parent and no
  package references them. Invariants **Z-1** and **P-1** are retired, `pickupZoneIds` is deleted
  from both package schemas, and **P-2** widened to a global per-terrain check. `@driverzone/geo`
  needed no change — `validateZone` already made `parentGeom` optional. See `docs/decision-log.md`.
- A pickup point outside the city is no longer a `ZONE_CONFIG_FAULT` 500. It is a new
  `PICKUP_OUTSIDE_CITY` outcome at 200 that offers the customer an outstation trip instead.
- `docs/LLD/api-contracts.md` documented a flat `{ "error": { … } }` body that
  `packages/contracts/src/http.ts` has not produced for some time. Corrected to the real
  `HttpSuccessBody` / `HttpErrorBody` envelope, and the admin zone routes filled in.

- HTTP access logging (`pino-http`): one line per request with method, route pattern, status,
  duration and `requestId`. `/api/health` and the driver location ping are excluded — see
  `docs/decision-log.md` for why.
- Log redaction. OTPs, phone numbers, bearer tokens, idempotency keys and addresses never reach
  stdout, enforced by config and proved by `apps/api/test/logging.test.ts`.
- An ESLint rule requiring static log messages, because path-based redaction cannot see inside
  an interpolated string.
- A documented level policy in `docs/engineering/coding-standards.md`.
- Request correlation. Every response carries an `x-request-id` header and a `requestId` in its
  envelope; every log line written during that request is stamped with it, via
  `AsyncLocalStorage` rather than a threaded parameter. An inbound header is reused, so a trace
  started at nginx stays one trace. Worker jobs inherit the ID from their payload.
- `AppError` now carries `cause`, and separates `publicDetails` (returned always) from
  `details` (logged, stripped in production).
- `apps/api/test/app.test.ts` — the HTTP layer under supertest: envelope, 404, error
  translation, the 503-when-degraded rule, request-id propagation. 10 tests.
- `apps/api/vitest.integration.config.ts` and the `test:integration` script that
  `docs/engineering/testing.md` had documented for a while without it existing.
- `docker-compose.dev.yml` — infrastructure only (Mongo, Redis, OSRM commented out). Ports bind
  loopback and are overridable via `MONGO_PORT` / `REDIS_PORT` / `OSRM_PORT`.
- `docker-compose.prod.yml` — the full stack from built images, with the databases unpublished
  and separate volumes from the dev stack.
- `apps/api/.env.prod.example` — production env template, kept apart from the dev `.env`.
- `docs/setup-development.md` — the setup guide: both compose workflows, the app combinations,
  the mobile-terminal rule, troubleshooting, and a spec for the not-yet-built seed script.
- `docs/decision-log.md` and this changelog.
- Root `dev:*` scripts — `dev:api`, `dev:worker`, `dev:backend`, `dev:web`, `dev:full`,
  `dev:customer`, `dev:driver`.
- `dev:worker` task in `turbo.json`; the API script existed but no task did, so the BullMQ
  worker could not be started through turbo.
- `scripts/check-doc-links.sh`, wired into `pnpm check` — every relative markdown link must
  resolve.

### Changed

- Low-level design docs `02`–`12` moved to `docs/LLD/`. The PRD, `README.md` and
  `setup-development.md` stay at `docs/` root.
- `apps/api/.env.example`: `MONGO_URI` now carries `?replicaSet=rs0&directConnection=true`.
  Without it the first multi-document transaction fails, far from the setup that caused it.
- **winston replaced with pino.** Chosen for built-in redaction rather than speed; reverses the
  choice recorded in `tech-choices.md`. Note the reversed argument order —
  `logger.info({ data }, 'message')`.
- Request IDs are now `req_` + UUID v7 (`req_01J…`), matching
  `docs/LLD/api-contracts.md` and sorting in creation order. Previously a bare UUID v4.
- Module containers expose `buildRouter()` instead of a `router` property, and
  `buildContainers()` moved from `routes.ts` to a new `src/container.ts`. The worker builds
  modules without constructing an HTTP surface it has no listener for.
- Redis connections and BullMQ queues are created on first use rather than at import, and
  `config/env.ts` no longer calls `process.exit(1)` at import — validation moved to an explicit
  `loadEnv()` in each entrypoint. Importing a use case no longer opens a socket or can kill a
  test runner.

### Fixed

- **`/api/health` reported `healthy` while Mongo was unable to serve.** The probe read
  `mongoose.connection.readyState`, a client-side socket flag, and issued no command — so a
  replica set that had lost its primary, or a wedged server, looked fine to the load balancer
  and to the container healthcheck. It now issues a real `admin().ping()` under a 2s timeout.
  Confirmed by pausing the Mongo container: previously `healthy`, now `503` with
  `detail: "ping timed out"`.
- Validation errors returned no field information in production. `error-handler` put Zod issues
  in the diagnostic channel, which `buildErrorBody` strips when `NODE_ENV=production`, so
  clients received a 400 with nothing to highlight.
- 44 markdown links and 8 prose references in code, broken by the `docs/LLD/` move.

### Removed

- `docker-compose.yml`. It mixed infrastructure with production application builds, so
  `docker compose up` meant two different things depending on which services you named. Every
  command now names its file with `-f`.
