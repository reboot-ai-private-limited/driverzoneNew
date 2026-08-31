# Changelog

Notable changes to this repository. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

There are no releases yet — the first shippable milestone is the phase 9 pilot in
[`docs/LLD/roadmap.md`](docs/LLD/roadmap.md). Everything lands under `Unreleased` until
then.

This is not the commit log. Commits are written for someone bisecting a regression; this is for
someone coming back after two weeks and asking what moved. For _why_ something is the way it
is, see [`docs/decision-log.md`](docs/decision-log.md).

## [Unreleased]

### Added

- **The admin packages screen** at `/packages` — the editor for what we sell and what it costs.
  InCity is a table of packages; Outstation is a table of distance bands with the **gaps between
  them interleaved as rows**, because a gap is the one package failure nothing else reports: an
  overlap is refused at write time, caught again by the nightly job and made deterministic by
  read-time precedence, while two adjacent bands that fail to meet is a silence until a customer
  hits it. A gap row's action opens the create form pre-filled with the missing range.
  Full-page editors at `/packages/{incity,outstation}/{new,[id]}`, a live commission split under
  every fare, and a deactivate dialog that computes which distances actually go dark rather than
  assuming the band's own range.

- **Splitting a distance band** — one action instead of an edit-then-create sequence with a 409
  in the middle. Shrinks the original, then creates the upper half with the fares copied (not
  divided — dividing would invent the per-km rate this model does not have). Two writes with no
  transaction available, so the half-done case is reported as what it is, and the range that was
  not created is already a red row in the list.

- **`packages.mapper.ts` and `packages.typecheck.ts`.** The mapper turns domain entities into the
  snake_case DTOs the contracts promise; the typecheck pins the Zod schemas, the mapper output and
  `@driverzone/contracts` to each other so the next disagreement is a build failure.

- **Global settings — the `settings` module and its APIs.** Nineteen tunable numbers behind
  `GET`/`PATCH /api/admin/settings` and `POST /api/admin/settings/reset`, plus audience-filtered
  reads at `GET /api/customer/settings` and `GET /api/driver/settings`. Covers the pickup default
  charge, the two time-of-day surcharge windows and their amounts, insurance, the waiting/no-show
  clock, the driver late fine, driver ring time, and the cancellation ladder for both sides.
  `docs/LLD/booking-lifecycle.md` has asserted "all thresholds live in `global_settings`" against
  a collection nobody had built; this is that collection.

  The defaults live in **code**, in `settings/domain/setting.registry.ts` — a row exists only for
  an override, so there is no seed script and no migration, ever. Each entry carries its own Zod
  schema, unit, label, description and read-audiences, which means adding a setting is one entry
  and touches neither the API surface, the OpenAPI document, nor the admin form that comes next.

  Writes are bulk and all-or-nothing, because some rules are about a *pair* of keys and are
  checked against the configuration the write would produce rather than against the patch: the two
  surcharge windows must not overlap (either may wrap midnight), no-show must be later than free
  waiting, and neither cancellation ladder may step down. A batch that fails any of them writes
  nothing. Reads go through a 60s cache that a write in the same process clears immediately, so an
  admin who saves and reloads sees the change rather than the old value for a minute.

- **The Settings screen** at `/settings`, and the nav entry stops saying "coming soon". The
  admin can now change a pickup charge, a surcharge window, the waiting clock or the cancellation
  ladder without a deploy — which is the whole reason the module underneath it exists.

  The form is not hand-built: it renders from `GET /admin/settings`, which returns each key with
  its group, label, unit and description, so `RUPEES` gets a `₹` box, `TIME_WINDOW` gets a pair of
  time pickers, and a setting added to the API's registry appears here correctly with no frontend
  change. Nothing in `features/settings/` knows any setting by name.

  One dirty-tracked `PATCH` for the whole page, because the API validates cross-key rules against
  the configuration the write would produce — per-field autosave would let an incoherent pair
  through one request at a time. Rejections map back onto the offending inputs, and a
  `SETTING_INVARIANT_VIOLATED` lights up *every* key named in the rule, so both halves of an
  overlapping pair are visible rather than just the one that was touched. Per-field reset calls
  the reset endpoint rather than typing the default back in — those are different outcomes, and
  only one of them keeps tracking the shipped default.

  Fields the admin is still editing survive the refetch that a save or reset triggers. Getting
  that from a value comparison is not possible: right after a reset the local draft still holds
  the override that was just deleted, so it reads as edited too. The screen keeps an explicit
  touched-key list instead.

- **`SettingsReadContract`**, read-only by design — the invariants above are enforced on the one
  write path, and a second one would demote them to a convention. Not threaded into any module
  yet: the open TODOs in `resolveForTrip.usecase.ts` and `zone.entity.ts` want keys this pass
  deliberately does not define, and a contract wired into a module that ignores it reads like a
  dependency that exists.

### Changed

- **Outstation bands are one panel per terrain, with the coverage strip back on top.** Plains and
  Hills get their own table — they are independent ladders, and a shared table with a Terrain
  column implied one sequence you could read straight down — and each is headed by a strip drawn
  proportional to km. A gap is now shown twice, hatched in the strip and red in the table, both
  opening the create form pre-filled with the missing range: an overlap is caught three times
  over, a gap is caught by nobody.

- **An incity variant is a duration and a price.** `label`, `includedMinutes`, `baseFarePaise`,
  `driverCommissionBps` — nothing else. `includedMinutes` stays because it is what the customer
  buys and what tells the driver when they are released.

- **The outstation return fare is the whole two-way journey**, not a same-day round trip. A 540 km
  destination matches the band containing 540 — the ONE-WAY distance — and that band's return fare
  covers all 1,080 km, however many days the driver is away.

- **Incity beats outstation unconditionally.** The rung-(a) distance guard leaned on `includedKm`
  and was dropped with it rather than re-expressed as a flat km limit, which reverses the
  2026-08-20 `incity.max_distance_multiple` decision. Both points inside the city zone now means
  incity at any distance — and with overage gone, a 60 km cross-city run sells as a ₹900 hourly
  rental with nothing to collect the difference. Deliberate; see `docs/decision-log.md`.

- **Three open questions closed by deletion** rather than specification: Q1 (no destination rule),
  Q2 (no overage billing), Q4 (a round trip is however long it takes).

- **Price no longer varies by car category, in either product.** An outstation band is
  `oneWayFarePaise`, a nullable `roundTripFarePaise` and one `driverCommissionBps`; an incity
  variant carries its own fare and overage rates. The `prices[]` subdocument, `CommissionType`
  (`PERCENT | FLAT`) and the stored company commission are gone. The band fare is now **flat** —
  72 km and 98 km both pay the 70–100 fare — which closes `open-questions.md` Q3 and brings its
  warning with it: flat pricing needs many narrow bands, hence the split action. An SUV and a
  hatchback now pay the same fare for the same trip; that is pricing power given up, not waste
  removed. See `docs/decision-log.md`.

- **The company's commission is derived, never stored** — `10000 − driver`. Two independently
  stored shares let a form save 75% and 20% and leave 5% of every trip in nobody's column. The
  pair that could disagree no longer exists.

- **`roundTripFarePaise` is nullable**, meaning *this band does not sell a same-day return* —
  never that the return is free. Such a request answers `NO_PACKAGE_AVAILABLE`, deliberately not
  `NO_PACKAGE_FOR_DISTANCE`: the distance is covered, so sending ops to add a band would send them
  to create one that already exists.

- **P-3 narrowed for incity and retired for outstation.** An active incity package needs one
  active variant; the "…holding an active price" clause had nothing left to check. A band carries
  `oneWayFarePaise` as a required field, so "active but unsellable" stopped being representable
  rather than merely forbidden.

- **`CAR_CATEGORIES` moved to `contracts/src/identity.ts`.** It is no longer a packages concept —
  what it still decides is who can drive, not what anything costs.

- **Settings money is whole rupees, not paise** — the one exception to the paise convention, for
  ops-facing round figures that a paise input would make hostile to type. The 100× hazard this
  creates (`baseFarePaise + settings['pricing.insurance_charge']`) is closed by making `Rupees` an
  *opaque* type: settings money cannot be added to a number at all, and `rupeesToPaise()` is the
  only way across. The usual `number & { __unit }` brand was tried first and does not work — an
  intersection is still assignable to `number`, so the arithmetic compiles; `settings.typecheck.ts`
  pins the difference.

### Removed

- **`includedKm`, `extraMinuteRatePaise`, `extraKmRatePaise`, `enforceDropInCity` and `sortOrder`**
  from the incity variant. **There is no overage**: a 3-hour booking that runs 3h 40m is an
  operations conversation, not a fare line. `computeFinalFare` and the fare snapshot's `rates`
  block go with them, and the fare card no longer discloses per-minute or per-km rates.

- **`nightChargePaise` from incity price rows**, and `night_charge_paise` from `IncityPriceDto`.
  Time-of-day surcharges are global now, and the same fare line configured per-row *and* globally
  is one place too many. Nothing read it — no data migration, no seeded package carries it.

- **`pnpm seed` now seeds zones too** — Siliguri, three pickup areas inside it, and Darjeeling
  and Kalimpong above it, in a new `apps/api/src/config/devZones.ts` alongside `devAccounts.ts`.
  A fresh database resolved nothing before this: `/coverage/check` said "not served" for every
  point and the zone editor opened on an empty map, so everyone drew their own polygons —
  the reproducibility problem the account fixtures exist to prevent, recurring one module over.
  Created through `zones.public.ts` rather than Mongoose, so the `@driverzone/geo` invariants run
  on every seeded polygon and the seed cannot write geometry the admin panel would have refused;
  the price is that zone `_id`s differ between machines and `code` is the stable handle. Keyed on
  `code`, so a second run reports "already present" instead of re-versioning a polygon you were
  mid-way through editing. `--reset` clears zones first, through the module's own
  `deactivate` → `delete` path.
  The fixture is positioned against the accounts: `+919000000003`'s two saved addresses resolve
  differently on purpose — Sevoke Road into a free pickup zone, Matigara into the city with none —
  so one seeded customer covers both branches of the pickup-charge path.
- `docs/engineering/frontend-architecture.md` and `docs/engineering/design-language.md` — the
  admin panel's design, settled before the zone editor gets built on top of it. How it fetches
  (client-first, TanStack Query straight to the API, no BFF), how it holds a session, the
  four states every data surface must handle, and separately what it looks like: colour,
  density, the nav, the component inventory.
- **The panel's foundation in `apps/web`** — a typed API client that unwraps the response
  envelope and throws `ApiError`; a session layer implementing `docs/LLD/auth.md` with the
  access token in memory, boot restore as a silent refresh, proactive renewal at 12 minutes and
  a **single-flight** refresh; the query-key factory and staleness policy; and the proving
  slice: admin OTP login → app shell → a zones list with real loading, error, empty and ready
  states. 34 tests, mostly on the session.
- **`@driverzone/design-system` becomes a real design system** — Tailwind v4 `@theme` mirroring
  `tokens.ts`, plus ~20 components: `Button`, `Input`/`FormField`, `OtpInput`, `Select`,
  `DataTable`/`CellStack`, `Pagination`, `FilterBar`, `Panel`/`DefinitionList`, `Badge`,
  `Dialog`/`ConfirmDialog`, `DropdownMenu`, `Tooltip`, and the state family
  (`Skeleton`, `EmptyState`, `ErrorState`, `DataState`, `RequestId`, `TopProgressBar`).
  Its first runtime dependencies: Radix for the seven components whose focus and ARIA wiring we
  would otherwise get subtly wrong.
- **Brand primary is now `#C0FF72`.** It is a near-white lime — 1.18:1 against white — so it is
  a _surface_, never an _ink_, and a separate `interactive` token carries links, focus rings and
  selected state. `theme.contrast.test.ts` asserts every declared pair, and
  `tokens.drift.test.ts` asserts `theme.css` still matches `tokens.ts`. Both were confirmed to
  fail on a deliberately bad value, which is the only reason to trust either.
- `packages/config/eslint.react.cjs` — a React ESLint config mirroring the existing
  `tsconfig.base`/`tsconfig.react` split, with `react-hooks/exhaustive-deps` as an **error**
  (a stale closure in the refresh timer is a token that never renews) and `jsx-a11y`, so the
  accessibility claims in the design language are checked rather than asserted.

### Fixed

- **The zones screen's package count was always zero.** The packages controllers put camelCase
  domain entities on the wire while the contracts and swagger both promised snake_case, and the
  lists sent a bare array where `{ packages: [...] }` was declared — so `packagesForZone` filtered
  on `city_zone_id`, matched nothing, and the city card reported no packages for a zone that had
  them. The mapper fixes today's instance; `packages.typecheck.ts` is what stops the next one.

- **Every max-width in the admin panel collapsed to a few pixels.** `theme.css` declared named
  spacing tokens `--spacing-xs/sm/md/lg/xl`, and those names belong to Tailwind v4's
  `--container-*` scale — which is what `max-w-*` reads, falling back to `--spacing-*` when a
  container key is absent. So `max-w-sm` compiled to `8px` and the login card rendered as a
  vertical line. Spacing now uses Tailwind's numeric scale, `--container-content-max` replaces
  the spacing token it was using, and `tokens.drift.test.ts` refuses any `--spacing-*` key with
  a reserved container name. Nothing caught this: typecheck, lint, tests and `next build` were
  all green while the UI was unusable.
- `.text-md` compiled with no `line-height`. Tailwind pairs each `--text-*` with a
  `--text-*--line-height` and its own pairs survive being given new sizes, but `md` is not one
  of Tailwind's names, so that pair had to be declared.

- `apps/web` could not build against any workspace package. `@driverzone/geo` and
  `@driverzone/contracts` compile under NodeNext and so carry `.js` extensions on relative
  imports — correct, and required by `apps/api` — which webpack resolved literally and failed
  on. `next.config.ts` now sets `resolve.extensionAlias`. `@driverzone/design-system` needed
  the opposite treatment: it compiles with `moduleResolution: Bundler`, where extensionless is
  correct, and its `.js` extensions were simply wrong.

- `docs/LLD/zones.md` — the zones module LLD. What each zone type is actually for, the contract
  split between resolution and admin, the write path and its choke point, versioning, the full
  HTTP surface with success and fault codes, and an edge-case matrix covering the write path,
  the read path and operations. The rows marked ⚠ are the ones that fail _silently_ if skipped.
- The MongoDB ring-winding trap, written down for the first time: a clockwise exterior ring is
  read by a `2dsphere` index as the whole earth minus the shape, with no error anywhere. Fixed
  by normalising with `@turf/rewind` in the write path.
- `coverageRequests` and `unservedDistanceRequests` now have proper sections in
  `docs/LLD/database-schema.md` instead of existing only inline in the resolution doc.
- `docs/LLD/packages.md` — the packages module LLD. The two products, the precedence ladder that
  picks exactly one of them, per-direction outstation pricing, the four layers of guard against
  overlapping distance bands (and the one guard against a _gap_, which is a different and
  quieter failure), plus the realignment surface for the existing `packages` module.
- **`zones` module** (tier 3) — the first domain module beyond `identity`: zone CRUD with
  geometry validation via `@driverzone/geo`, point→zone resolution
  (`GET /coverage/check`, and a `ZoneResolutionContract` for future modules), versioned edits
  (Z-5 — editing geometry writes a new version and supersedes the old one, never mutates in
  place), and the admin lifecycle at `/admin/zones/*` — create, update geometry, validate (dry
  run), deactivate with a blast-radius confirmation, hard delete, dependents. 22 unit tests
  exercising real Z-1/Z-2/Z-3 geometry, not a mock of it. **This code predates the design
  landed above** — it still enforces the retired Z-1 and requires a parent on every pickup
  zone. Realignment is the next commit on this branch.
- `@driverzone/geo` gains `zoneStats()` (area/vertex count — informational, not an invariant)
  and re-exports `Polygon`/`Point`/`LineString`, so consumers never import the bare `geojson`
  package directly — it ships types only, which `dependency-cruiser` cannot resolve the way
  `tsc` can.
- `@driverzone/contracts` gains the `zones` request/response DTOs:
  `CreateZoneRequest`/`UpdateZoneGeometryRequest`/`DeactivateZoneRequest`,
  `ListZonesQuery`/`Response`, `ZoneDependentsResponse`, `CoverageCheckQuery`/`Response`.
- `apps/api/src/shared/db/auditLog.model.ts` — the generic `auditLog` collection, extracted out
  of `identity` so `zones` (and future modules) can write to it without reaching into another
  module's `infrastructure/`.

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

- **Terrain now comes from the destination point, not the route.** A trip is `HILL` when its drop
  point falls inside a hill zone. This reverses assumption A5 and retires
  `outstation.hill_route_threshold_m`. `classifyTerrain` and `hillMetresOnRoute` are retained in
  `@driverzone/geo`, tested but unused — the same treatment `checkWithinParent` got. The cost is
  real and documented: a flat destination behind a mountain now prices as `PLAIN`, and the
  mitigation is to draw the hill polygon over the approach corridor. OSRM stays for distance, but
  is now called with `overview=false` since nothing needs the route geometry.
- **The server picks the product.** A quote resolves from two points to exactly one package —
  incity with all its variants, or outstation with the price row for the requested car category
  and direction. The client no longer chooses a tab, which retires FR-B3.
- `catalog` → `packages` throughout the docs, matching the module that already exists.
- **Pickup zones are a serviceability gate and a fee, nothing else.** They have no parent and no
  package references them. Invariants **Z-1** and **P-1** are retired, `pickupZoneIds` is deleted
  from both package schemas, and **P-2** widened to a global per-terrain check. `@driverzone/geo`
  needed no change — `validateZone` already made `parentGeom` optional. See `docs/decision-log.md`.
- A pickup point outside the city is no longer a `ZONE_CONFIG_FAULT` 500. It is a new
  `PICKUP_OUTSIDE_CITY` outcome at 200 that offers the customer an outstation trip instead.
- `docs/LLD/api-contracts.md` documented a flat `{ "error": { … } }` body that
  `packages/contracts/src/http.ts` has not produced for some time. Corrected to the real
  `HttpSuccessBody` / `HttpErrorBody` envelope, and the admin zone routes filled in.

- **Pickup zones are a serviceability gate and a fee, nothing else.** They have no parent and no
  package references them. Invariants **Z-1** and **P-1** are retired, `pickupZoneIds` is deleted
  from both package schemas, and **P-2** widened to a global per-terrain check. `@driverzone/geo`
  needed no change — `validateZone` already made `parentGeom` optional. See `docs/decision-log.md`.
- A pickup point outside the city is no longer a `ZONE_CONFIG_FAULT` 500. It is a new
  `PICKUP_OUTSIDE_CITY` outcome at 200 that offers the customer an outstation trip instead.
- `docs/LLD/api-contracts.md` documented a flat `{ "error": { … } }` body that
  `packages/contracts/src/http.ts` has not produced for some time. Corrected to the real
  `HttpSuccessBody` / `HttpErrorBody` envelope, and the admin zone routes filled in.
- The generic `auditLog` model moved from `identity/infrastructure/` to
  `apps/api/src/shared/db/auditLog.model.ts`. `identity/infrastructure/audit.mongo.ts` is now a
  thin adapter over the shared model — no behaviour change.
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
