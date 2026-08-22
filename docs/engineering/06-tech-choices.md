# 06 — Tech Choices

Every dependency, why it is here, what was rejected, and when to revisit. If you are about to
add a package, add an entry here in the same format — a dependency nobody can justify is a
dependency nobody dares remove.

Format for each entry:

- **Chosen for** — the concrete job it does
- **Why this one** — what it beats and on what axis
- **Rejected** — the alternatives considered
- **Revisit when** — the condition that would change the answer

---

## Tooling

### pnpm

- **Chosen for:** installing dependencies and linking the nine workspace packages.
- **Why this one:** strict by default (no phantom dependencies), fast, and its
  `--filter`/`workspace:*` protocol makes the package graph explicit. Already in use on the
  team's other monorepo, so no learning cost.
- **Rejected:** npm workspaces (slower, no strictness); yarn (Berry's PnP fights React Native
  even harder than pnpm's symlinks); bun (fast, but too young to bet a production install on).
- **Note:** `.npmrc` sets `node-linker=hoisted`, which forfeits the phantom-dependency
  protection. That is the price of Metro compatibility — see
  [08](08-mobile-in-monorepo.md). `not-to-unresolvable` covers the same ground.
- **Revisit when:** never, realistically.

### Turborepo

- **Chosen for:** running `build`/`test`/`lint` across nine packages, with caching and
  change-filtering.
- **Why this one:** `--filter='...[origin/main]'` computes the affected subgraph from git, which
  is what stops a driver-app text change from rebuilding and redeploying the API. Zero-config
  on top of pnpm.
- **Rejected:** plain `pnpm -r --parallel` (works, no caching, no affected-graph — CI filtering
  becomes hand-written YAML); Nx (more capable, considerably more configuration than four apps
  justify); Bazel (no).
- **Common confusion:** Turborepo does **not** replace pnpm. It installs nothing. See
  [01](01-monorepo-layout.md#why-pnpm-and-turborepo).
- **Revisit when:** builds exceed ~5 minutes locally — that is when remote caching starts
  paying for itself.

### TypeScript

- **Chosen for:** everything.
- **Why this one:** the contract between four apps is types. The `.public.ts` pattern in
  [03](03-module-anatomy.md) is only zero-cost because TypeScript erases interfaces entirely.
- **Config:** strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `verbatimModuleSyntax`. See [05](05-coding-standards.md#typescript) — these caught four real
  bugs during scaffolding.

### dependency-cruiser

- **Chosen for:** enforcing module boundaries and the layer rules.
- **Why this one:** it resolves imports to real file paths, so it catches relative escapes and
  cycles that ESLint structurally cannot. `tsPreCompilationDeps: true` makes it see
  `import type`, which is where most layer violations actually live.
- **Rejected:** ESLint `no-restricted-imports` alone (string-matching only — kept anyway as the
  fast editor-time echo); `eslint-plugin-boundaries` (ESLint's resolution model, same blind
  spots); manual code review (decays in a month).
- **Load-bearing:** under MongoDB this also protects the zone invariants. See
  [04](04-boundaries-and-enforcement.md).
- **Revisit when:** never while the module architecture stands.

### Vitest

- **Chosen for:** unit and integration tests.
- **Why this one:** native ESM and TypeScript with no transform config, and it shares Vite's
  resolver so the `@/` alias works without a second mapping.
- **Rejected:** Jest (ESM support is still awkward, needs `ts-jest` or babel); node:test (fine,
  but weaker assertion and mocking ergonomics).

### ESLint 8 + Prettier

- **Chosen for:** lint and formatting.
- **Why ESLint 8, not 9:** the flat-config migration is not worth the churn while several
  plugins we want still ship eslintrc-only configs.
- **Gotcha:** leaf configs must use `require.resolve('@driverzone/config/eslint.base.cjs')`.
  ESLint 8's own `extends` resolver ignores a package's `exports` map and fails with "couldn't
  find the config to extend from".
- **Revisit when:** the plugin ecosystem has settled on flat config.

---

## Backend

### Express 4

- **Chosen for:** the HTTP layer.
- **Why this one:** the team has a working, proven Express + hexagonal setup. The architecture
  here comes from the modules and the container, not the framework — Express is deliberately a
  thin edge, and a thin edge should be boring.
- **Rejected:** NestJS (brings its own DI and module system, which would duplicate and partly
  contradict the container pattern — its decorators are a heavier commitment than the ~30 lines
  of wiring they replace); Fastify (faster, but the speed difference is irrelevant next to Mongo
  and OSRM latency); Hono (excellent, smaller ecosystem).
- **Revisit when:** Express 5 is stable — it awaits async handlers natively, which retires
  `shared/http/asyncHandler.ts`.

### MongoDB + Mongoose

- **Chosen for:** the primary datastore.
- **Why this one:** team fluency, and its geospatial support covers the two operations on the
  hot path — `$geoIntersects` with a `2dsphere` index for zone resolution, `$geoNear` for
  finding drivers. Single-document atomicity makes the dispatch claim in
  [`../06-dispatch-and-assignment.md`](../LLD/06-dispatch-and-assignment.md) clean:
  `findOneAndUpdate({ _id, driverId: null })` either wins or returns nothing.
- **Rejected:** PostgreSQL + PostGIS — genuinely the stronger fit for this product, and the
  original design. It loses on team familiarity, and that matters more than it looks: the
  people who will operate this at 3am know Mongo.
- **What it costs, honestly:** PostGIS enforced the zone invariants as database triggers, so an
  invalid polygon could not be saved from any code path. Mongo cannot express a cross-document
  geometric constraint, so those checks moved into `@driverzone/geo` and the `zones` write
  path. That is a weaker guarantee, held up by
  [`module-internals-are-private`](04-boundaries-and-enforcement.md) plus a nightly integrity
  job. It also cost the ability to compute intersection areas and route lengths in the query —
  hence Turf.
- **Requires:** a replica set, even single-node. Multi-document transactions need one, and the
  booking→ledger write does. Both compose files handle the init.
- **Revisit when:** zone or route geometry becomes a query-time bottleneck, or the ledger's
  consistency requirements outgrow what Mongo transactions comfortably give.

### Turf.js

- **Chosen for:** every geometric predicate that is not point-in-polygon or nearest-neighbour —
  `booleanWithin`, `booleanOverlap`, `intersect`, `difference`, `area`, `kinks`, `lineSplit`.
- **Why this one:** it is the replacement for the PostGIS functions Mongo does not have, and it
  runs in the browser as well as Node. That second property is worth a lot: the admin map editor
  validates a polygon live as it is drawn, using the exact same code the API will use to reject
  the save. The editor and the server cannot disagree.
- **Rejected:** JSTS (a Java port; larger, clumsier API); hand-rolled geometry (ray casting is
  easy, polygon boolean operations are emphatically not).
- **Status:** a first-class dependency, not a utility. It carries invariants that used to be
  database triggers, so it lives in `packages/geo` with its own test suite — 31 tests covering
  every case in [`../04-zone-resolution.md`](../LLD/04-zone-resolution.md).
- **Note:** import the individual `@turf/*` packages, never the `@turf/turf` meta-package —
  the latter is ~500KB and the admin bundle ships to browsers.

### Redis (ioredis)

- **Chosen for:** BullMQ's backing store, live driver locations (`GEOADD`/`GEOSEARCH`), and the
  settings cache.
- **Why this one:** BullMQ requires it, and the same instance solves the location write-volume
  problem. 2,000 on-duty drivers pinging every 10s is ~200 writes/s; sent to Mongo that bloats
  collections and starves booking queries. Redis absorbs it and Mongo gets a batched flush every
  30s. See [`../09-architecture.md`](../LLD/09-architecture.md).
- **Config note:** `maxRetriesPerRequest: null` is required by BullMQ, not a tuning choice — its
  blocking commands are long-lived and ioredis's default retry cap kills them mid-wait. Without
  it, dispatch workers die quietly seconds after starting.

### BullMQ

- **Chosen for:** dispatch wave timeouts, scheduled dispatch, notification retries.
- **Why this one:** dispatch timers must survive a process restart. This is the single most
  important operational decision in the codebase: an in-memory `setTimeout` dies on deploy, and
  the booking it was tracking sits in `SEARCHING` forever — no driver, no error, no alert,
  because nothing *failed*. A customer watches a spinner while the system believes it is
  working. BullMQ persists to Redis, retries, and is inspectable.
- **Rejected:** `setTimeout` (see above); Agenda (Mongo-backed, so no extra infrastructure, but
  weaker primitives and no usable UI); Temporal (the right model for this problem, and too much
  operational weight for a pilot).
- **Revisit when:** dispatch orchestration outgrows one queue — multi-step sagas with
  compensation are where Temporal starts to earn its keep.

### Zod

- **Chosen for:** request validation and environment parsing.
- **Why this one:** `z.infer` means the validated shape and the TypeScript type cannot drift.
  Parsing `process.env` through it fails the process at boot with the variable named, rather
  than surfacing as `undefined` inside a connection string an hour into a deploy.
- **Rejected:** Joi (no type inference); class-validator (needs decorators and
  `reflect-metadata`); hand-written guards (drift).

### pino

- **Chosen for:** structured logging to stdout, and redaction.
- **Why this one:** `redact` is built in. This system logs around trip-start OTPs, phone
  numbers and bearer tokens, and a redaction list that is configuration rather than a format we
  wrote is the difference between a rule and a maintenance burden. JSON in production,
  human-readable via `pino-pretty` in development, from one config.
- **Rejected:** winston (**previously chosen** — no redaction of any kind, so every rule would
  have been custom code; see [`../decision-log.md`](../decision-log.md)); `console.log` (no
  levels, no structure).
- **Known limit:** path-based redaction cannot see PII interpolated into a message string. An
  ESLint rule enforces static messages to close it — see
  [`05-coding-standards.md`](05-coding-standards.md#messages-are-static-data-goes-in-the-object).
- **Note:** nothing writes log files. The container runtime owns collection; a process writing
  its own logs is a disk-full outage waiting for a busy day.
- **Revisit when:** OpenTelemetry lands. `@opentelemetry/instrumentation-pino` injects
  `trace_id`/`span_id` into these same lines with no change to call sites.

### Helmet, CORS

Standard hardening. `trust proxy: 1` is set because the API runs behind nginx — without it
`req.ip` is the proxy and every rate limit shares one bucket.

---

## Frontend

### Next.js 15

- **Chosen for:** the admin panel.
- **Why this one:** `output: 'standalone'` traces only the files the server loads, which keeps
  the production image small in a monorepo. App Router gives layouts and streaming for the
  heavier admin screens.
- **Rejected:** Vite + React Router (lighter, but we would rebuild routing, data loading and
  the production server); Remix (fine, smaller ecosystem).
- **Monorepo config that matters:** `outputFileTracingRoot` must point at the repo root, or
  tracing stops at `apps/web` and ships an image missing half its imports.
  `transpilePackages` is required because the workspace packages ship TypeScript source.

### MapLibre GL + Mapbox Draw

- **Chosen for:** the zone polygon editor — the most important screen in the admin panel.
- **Why this one:** MapLibre is the open fork of Mapbox GL JS with no per-seat licence and no
  token requirement. Mapbox Draw gives polygon drawing and vertex editing out of the box.
- **Rejected:** Mapbox GL JS (per-seat pricing for an internal tool used by a handful of ops
  staff); Leaflet + Leaflet.draw (fine, but raster-first and noticeably worse at the
  vector-editing interactions the zone editor needs); Google Maps (expensive, awkward polygon
  editing).

### React 19 / React Native 0.76

Current stable at the time of writing. React Native's New Architecture is on by default in
0.76, which matters for the driver app's foreground-service work.

---

## Mobile

### Expo (managed) + EAS

- **Chosen for:** both mobile apps.
- **Why this one:** far better monorepo story than bare React Native, and EAS Build removes the
  need for a Mac in CI — a real constraint for a small team. Config plugins cover the native
  modules we need without ejecting.
- **Rejected:** bare React Native (full native control, at the cost of maintaining two native
  build systems and a Mac build agent); Flutter (excellent, but a second language and no reuse
  of `@driverzone/contracts` — the type sharing across all four apps is a large part of why the
  monorepo is worth it); native Android + iOS (four codebases, not two).
- **Open risk:** the driver app needs an **Android foreground service** for the persistent
  socket while on duty. That is a config plugin, not an eject — but prototype it in week one
  before committing. See [08](08-mobile-in-monorepo.md).
- **Revisit when:** a required native capability has no config plugin and cannot be written as
  one. `expo prebuild` is the escape hatch and it is not a rewrite.

---

## Infrastructure

### OSRM (self-hosted)

- **Chosen for:** road distance and route geometry on every outstation quote.
- **Why this one:** straight-line distance under-reports by 30–50% in hill terrain, which puts
  trips in the wrong band and mis-prices them against 70–100km bands. Self-hosted because every
  quote hits it and quote volume runs roughly 3× booking volume — per-call pricing becomes a
  meaningful line item fast. One mid-size instance handles the India extract.
- **Rejected:** Google Distance Matrix (accurate, priced per call, and rate-limited at exactly
  the wrong moment); Mapbox Directions (same shape of problem); haversine (wrong, see above).
- **Cached:** on an H3 cell pair at resolution 8, TTL 30 days. Hit rate runs 60–80% because
  pickup and drop points cluster hard around towns and landmarks.

### Docker + Compose

Two images from one repo — `driverzone-api` (which also runs the worker, different `CMD`) and
`driverzone-web`. Compose for local development; the same images run in production behind
nginx. See [09](09-build-and-deploy.md).

---

## Deliberately absent

| Not used | Why |
|---|---|
| An ORM beyond Mongoose | Mongoose is already the schema layer. A second abstraction over it buys nothing. |
| A DI container (tsyringe, InversifyJS) | `<module>.container.ts` is ~30 lines of explicit wiring per module, greppable and debuggable. A decorator-driven container trades that for magic and a metadata dependency. |
| GraphQL | Four known clients and a fixed set of screens. REST with typed contracts is less machinery for the same result. |
| A state-management library (web) | Server state via fetch + cache. Add TanStack Query when the admin panel actually needs it, not before. |
| Sentry / APM | Should be added before the pilot. Not scaffolded yet — tracked in [`../11-roadmap.md`](../LLD/11-roadmap.md). |
