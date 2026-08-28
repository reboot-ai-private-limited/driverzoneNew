# Tech Choices

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
  [08](mobile-in-monorepo.md). `not-to-unresolvable` covers the same ground.
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
  [01](monorepo-layout.md#why-pnpm-and-turborepo).
- **Revisit when:** builds exceed ~5 minutes locally — that is when remote caching starts
  paying for itself.

### TypeScript

- **Chosen for:** everything.
- **Why this one:** the contract between four apps is types. The `.public.ts` pattern in
  [03](module-anatomy.md) is only zero-cost because TypeScript erases interfaces entirely.
- **Config:** strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
  `verbatimModuleSyntax`. See [05](coding-standards.md#typescript) — these caught four real
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
  [04](boundaries-and-enforcement.md).
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
  [`../LLD/dispatch-and-assignment.md`](../LLD/dispatch-and-assignment.md) clean:
  `findOneAndUpdate({ _id, driverId: null })` either wins or returns nothing.
- **Rejected:** PostgreSQL + PostGIS — genuinely the stronger fit for this product, and the
  original design. It loses on team familiarity, and that matters more than it looks: the
  people who will operate this at 3am know Mongo.
- **What it costs, honestly:** PostGIS enforced the zone invariants as database triggers, so an
  invalid polygon could not be saved from any code path. Mongo cannot express a cross-document
  geometric constraint, so those checks moved into `@driverzone/geo` and the `zones` write
  path. That is a weaker guarantee, held up by
  [`module-internals-are-private`](boundaries-and-enforcement.md) plus a nightly integrity
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
  every case in [`../LLD/zone-resolution.md`](../LLD/zone-resolution.md).
- **Note:** import the individual `@turf/*` packages, never the `@turf/turf` meta-package —
  the latter is ~500KB and the admin bundle ships to browsers.

### Redis (ioredis)

- **Chosen for:** BullMQ's backing store, live driver locations (`GEOADD`/`GEOSEARCH`), and the
  settings cache.
- **Why this one:** BullMQ requires it, and the same instance solves the location write-volume
  problem. 2,000 on-duty drivers pinging every 10s is ~200 writes/s; sent to Mongo that bloats
  collections and starves booking queries. Redis absorbs it and Mongo gets a batched flush every
  30s. See [`../LLD/architecture.md`](../LLD/architecture.md).
- **Config note:** `maxRetriesPerRequest: null` is required by BullMQ, not a tuning choice — its
  blocking commands are long-lived and ioredis's default retry cap kills them mid-wait. Without
  it, dispatch workers die quietly seconds after starting.

### BullMQ

- **Chosen for:** dispatch wave timeouts, scheduled dispatch, notification retries.
- **Why this one:** dispatch timers must survive a process restart. This is the single most
  important operational decision in the codebase: an in-memory `setTimeout` dies on deploy, and
  the booking it was tracking sits in `SEARCHING` forever — no driver, no error, no alert,
  because nothing _failed_. A customer watches a spinner while the system believes it is
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
  [`coding-standards.md`](coding-standards.md#messages-are-static-data-goes-in-the-object).
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

### Tailwind v4

- **Chosen for:** every style in the admin panel.
- **Why this one:** v4's theme is CSS — `@theme` in a stylesheet, no `tailwind.config.js` — which
  means `@driverzone/design-system` can ship a `theme.css` alongside its components and an app
  gets the whole design language with one import. For dense admin screens the utility model is
  also simply faster than a stylesheet per component, and it keeps the styles next to the markup
  they describe, which is where they are read.
- **Rejected:** CSS Modules + custom properties (no dependency at all, and the honest
  alternative — but noticeably slower to build tables and forms, and no escape hatch for a
  one-off); shadcn/ui (a large head start, at the cost of ~30 vendored files we then own and a
  second token layer to keep in sync with `tokens.ts`); vanilla-extract (typed and zero-runtime,
  but a build step in a package that deliberately has none).
- **The config that matters:** `apps/web/src/app/globals.css` must declare
  `@source "…/packages/design-system/src"`. Without it, every class used inside a design-system
  component is absent from the generated CSS and the primitives render unstyled — which looks
  like a broken build rather than a missing line of config.
- **Note:** `tokens.ts` stays the source of truth and `theme.css` mirrors it, held together by a
  test rather than codegen. See [`design-language.md`](design-language.md) §Guards.

### TanStack Query v5

- **Chosen for:** all server state in the admin panel — caching, invalidation, refetching,
  mutation lifecycle.
- **Why this one:** the panel is a pure client application (see
  [`frontend-architecture.md`](frontend-architecture.md)), so every screen owns fetch, cache,
  loading, error, retry and invalidation. Hand-writing that per screen produces six subtly
  different versions of the same bug. The zone editor is what settled it: debounced validation on
  every geometry change, invalidation across a list and a detail view at once, and a map that must
  not blank on a background refetch.
- **Rejected:** SWR (lighter, but weaker mutation and invalidation primitives, which is most of
  what an editor needs); plain `fetch` in `useEffect` (this is the thing being avoided); RTK Query
  (brings Redux for a panel with no client state to manage).
- **Previously:** deliberately absent. `tech-choices.md` said "add it when the admin panel
  actually needs it, not before" — this is that moment. See [`../decision-log.md`](../decision-log.md).
- **Load-bearing config:** never retry a 4xx, and let the API client's single-flight refresh own
  401 rather than the retry logic. Both are in
  [`frontend-architecture.md`](frontend-architecture.md).

### Radix primitives

- **Chosen for:** dialog, sheet, dropdown menu, select, tooltip, tabs, popover.
- **Why this one:** these are the components whose focus trapping, escape and outside-click
  handling, typeahead and ARIA wiring are genuinely hard, and where a hand-rolled version is
  wrong in ways that only show up for a keyboard or screen-reader user. Unstyled, so the design
  language stays ours.
- **Rejected:** a full component library (Mantine, MUI — brings a whole visual system we would
  then fight); hand-rolling (fine for a button, not for a focus trap); Headless UI (comparable,
  smaller primitive set).
- **Note:** these are the **first runtime dependencies `@driverzone/design-system` has ever had**.
  Deliberate, and the bar for the next one is the same: a component we would otherwise get
  subtly wrong. See [`../decision-log.md`](../decision-log.md).

### Google Maps JavaScript API

- **Chosen for:** the zone polygon editor — the most important screen in the admin panel.
- **Why this one:** **hybrid view — satellite imagery WITH road labels.** The question a pickup
  boundary answers is "where does the built-up area end, and what road is that", and no single
  open layer answers both halves. Places autocomplete solves orientation, which is the part OSM's
  thin commercial-POI coverage actually cost us. Terrain view carries shaded relief for hill
  zones, whose edges are price boundaries drawn over an approach corridor.
- **Rejected:** MapLibre GL + Mapbox Draw — see the reversal below; Leaflet + Leaflet.draw
  (raster-first and noticeably worse at vector editing).

> **This reverses an earlier decision, and the reasoning is worth keeping.** MapLibre was chosen
> for having no per-seat licence, and it was built and shipped. Three things changed the answer:
>
> 1. **The place-data gap was real in practice.** OSM's roads and place names in Siliguri are
>    fine; its commercial POI coverage is thin, and orienting yourself on the map was the
>    repeated complaint. GeoJSON import removes most of the *drawing* need, but not the *finding*
>    need.
> 2. **"Google is expensive" was right for the wrong screen.** Quote traffic runs ~3× bookings and
>    a per-call price there is still unacceptable — that rejection stands for the customer app and
>    for `zone-resolution.md`'s road-distance path. It never applied here: three ops people
>    drawing a polygon a few times a month is hundreds of map loads a month.
> 3. **The open stack cost a runtime failure the build could not catch.** MapLibre v6 resolves its
>    web worker from `import.meta.url`, which webpack rewrites to a hashed chunk path — the worker
>    404'd and surfaced as `Failed to load module script: … MIME type "text/html"`. It was fixable,
>    but only with a copy script that existed to work around the bundler. Google's API loads by
>    script tag at runtime and has no bundler interaction at all.
>
> **What the reversal costs, honestly.** An API key with a billing account behind it, which must
> be referrer- and API-restricted because it ships in the client bundle (§Environment in
> `frontend-architecture.md`). Clunkier editing for many-vertex polygons — mitigated, not solved,
> by GeoJSON import being the primary way a zone gets its shape. And `google.maps.Data` has no
> dashed stroke, so the always-visible city boundary costs one extra `Polyline` overlay.
>
> **What made the reversal cheap, and should be preserved.** Geometry crosses every boundary as
> GeoJSON, and `validateZone` in `@driverzone/geo` does not know what drew the polygon. The map
> is a LEAF: swapping it touched `ZoneMap.tsx`, two files in `features/zones/lib/`, and about
> thirty lines of `ZonesScreen`. The rail, the inspector, the violation panel, every hook and all
> the validation were untouched. Keep it that way.

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
  before committing. See [08](mobile-in-monorepo.md).
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
nginx. See [09](build-and-deploy.md).

---

## Deliberately absent

| Not used                               | Why                                                                                                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An ORM beyond Mongoose                 | Mongoose is already the schema layer. A second abstraction over it buys nothing.                                                                                            |
| A DI container (tsyringe, InversifyJS) | `<module>.container.ts` is ~30 lines of explicit wiring per module, greppable and debuggable. A decorator-driven container trades that for magic and a metadata dependency. |
| GraphQL                                | Four known clients and a fixed set of screens. REST with typed contracts is less machinery for the same result.                                                             |
| Sentry / APM                           | Should be added before the pilot. Not scaffolded yet — tracked in [`../LLD/roadmap.md`](../LLD/roadmap.md).                                                                 |
