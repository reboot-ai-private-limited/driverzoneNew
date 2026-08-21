# DriverZone

Zone-based driver booking. Customers book a vetted driver for their own car — hourly within a
city, or point-to-point outstation. Prices come from polygons an admin draws on a map.

One repo, four apps:

| | | Runs on |
|---|---|---|
| `apps/api` | Express API + BullMQ worker | server |
| `apps/web` | Next.js admin panel | server |
| `apps/customer` | Expo React Native | App Store / Play |
| `apps/driver` | Expo React Native | Play Store |

Plus five shared packages in `packages/`. See
[`docs/engineering/01`](docs/engineering/01-monorepo-layout.md).

---

## Prerequisites

| | Version | Check |
|---|---|---|
| Node | ≥ 20 | `node --version` |
| pnpm | 11.18.0 | `corepack enable && corepack prepare pnpm@11.18.0 --activate` |
| Docker | any recent | `docker --version` |

Use **corepack**, not a globally installed pnpm — the version is pinned in `package.json` and a
different one resolves the lockfile differently.

## First-time setup

```bash
git clone git@github.com:reboot-ai-private-limited/driverzoneNew.git driverzone
cd driverzone

corepack enable && corepack prepare pnpm@11.18.0 --activate
pnpm install

cp apps/api/.env.example apps/api/.env

# Mongo + Redis. mongo-init promotes Mongo to a replica set and exits — without it
# every write fails with "not primary".
docker compose up -d mongo mongo-init redis

pnpm turbo run typecheck lint test      # 18 tasks, all should pass
```

Then start what you're working on (next section) and confirm:

```bash
curl localhost:4000/api/health
```

`200` = healthy. `503` = the API is up but a dependency is down — check the `dependencies`
array in the response, it names which one.

---

## Daily workflow

```bash
git checkout main
git pull origin main
pnpm install                    # in case someone changed a dependency

git checkout -b feat/zones-polygon-editor

# … work …

pnpm check                      # typecheck + lint + test, everything
git add -A
git commit -m "zones: reject a polygon that leaves its parent city"
git push -u origin feat/zones-polygon-editor
```

Then open a PR against `main`.

### Branch names

```
feat/<short-description>     new functionality
fix/<short-description>      bug fix
docs/<short-description>     documentation only
chore/<short-description>    tooling, deps, config
refactor/<short-description> no behaviour change
```

### Commit messages

Prefix with the module or app you touched — it makes `git log --oneline` navigable in a
monorepo:

```
dispatch: escalate to the next wave when no candidates are in radius

An empty wave-1 radius previously burned the full 45s TTL before widening,
adding a minute to time-to-assignment for outlying pickups.

Refs: docs/06-dispatch-and-assignment.md §Waves
```

Not `fix stuff`. Full convention in
[`docs/engineering/05`](docs/engineering/05-coding-standards.md#commits).

### Before you push

```bash
pnpm check
```

This runs `typecheck`, `lint` and `test` across all nine packages. `lint` includes
`dependency-cruiser`, which enforces the module boundaries — **a boundary violation fails the
build, and under MongoDB that rule is protecting data integrity, not tidiness**. See
[`docs/engineering/04`](docs/engineering/04-boundaries-and-enforcement.md).

---

## Working on each app

### API — `apps/api`

```bash
docker compose up -d mongo mongo-init redis     # dependencies must be up first

pnpm --filter @driverzone/api dev                # :4000, watch mode
pnpm --filter @driverzone/api dev:worker         # the BullMQ worker, separate terminal
```

The worker is a **second composition root over the same code**, not a second app — it builds
the same modules and hands them to queue consumers instead of routes. Run it whenever you're
touching dispatch or notifications.

```bash
pnpm --filter @driverzone/api typecheck
pnpm --filter @driverzone/api test
pnpm --filter @driverzone/api lint               # eslint + dependency-cruiser
pnpm --filter @driverzone/api lint:deps          # boundaries only, faster
pnpm --filter @driverzone/api build              # tsc --noEmit && esbuild → dist/
```

**Adding a module?** Follow
[`docs/engineering/11`](docs/engineering/11-adding-a-module.md) and copy
`src/modules/health/` — it's the reference implementation, nine files, five minutes to read.

### Admin panel — `apps/web`

```bash
pnpm --filter @driverzone/web dev                # :3000
```

Expects the API on `:4000`. Start that first or every request 404s.

```bash
pnpm --filter @driverzone/web typecheck
pnpm --filter @driverzone/web lint
pnpm --filter @driverzone/web build              # next build, standalone output
```

### Mobile — `apps/customer`, `apps/driver`

```bash
pnpm --filter @driverzone/customer dev           # Expo dev server
pnpm --filter @driverzone/driver dev
pnpm --filter @driverzone/driver android         # run on a connected device/emulator
```

Point the app at your machine's LAN IP, not `localhost` — `localhost` on a phone is the phone.

```bash
pnpm --filter @driverzone/driver typecheck
pnpm --filter @driverzone/driver lint
```

**Mobile apps are not part of `turbo run build`.** They build to store binaries via EAS:

```bash
pnpm --filter @driverzone/driver exec eas build --profile preview --platform android
```

See [`docs/engineering/08`](docs/engineering/08-mobile-in-monorepo.md), especially the Metro
resolution section — that's where the one real monorepo trap lives.

### Shared packages — `packages/*`

No dev server; consumers compile them from source. Edit and the watching app picks it up.

```bash
pnpm --filter @driverzone/geo test               # 31 tests — the zone invariants
pnpm --filter @driverzone/geo exec vitest --watch
```

`packages/geo` carries the zone invariants that were database triggers under PostGIS. A bug
there is a bad polygon in production, so it has real test coverage and should keep it.

---

## Command reference

Run from the repo root — turbo fans out across all packages:

| Command | Does |
|---|---|
| `pnpm dev` | Every app in watch mode |
| `pnpm typecheck` | `tsc --noEmit` everywhere |
| `pnpm lint` | ESLint + dependency-cruiser |
| `pnpm test` | All test suites |
| `pnpm build` | Build api + web (mobile excluded) |
| `pnpm check` | typecheck + lint + test — **run before pushing** |
| `pnpm ci` | The above, filtered to what changed since `origin/main` |
| `pnpm format` | Prettier, write |
| `pnpm format:check` | Prettier, verify only |

Target one package with `--filter`:

```bash
pnpm --filter @driverzone/api test
pnpm --filter '@driverzone/api...' build       # api AND everything it depends on
pnpm --filter '...@driverzone/geo' test        # geo AND everything that depends on it
```

That last one is the useful one: after changing `packages/geo`, it tests every consumer.

---

## Docker

```bash
docker compose up -d mongo mongo-init redis    # dependencies only — the usual case
docker compose up -d                            # full stack, builds api + web images
docker compose logs -f api
docker compose down                             # keeps volumes
docker compose down -v                          # wipes the database
```

Building the images by hand — note the context is the **repo root**, not the app directory:

```bash
docker build -f apps/api/Dockerfile -t driverzone-api .
docker build -f apps/web/Dockerfile -t driverzone-web . \
  --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
```

**A Docker build succeeding is not the same as the image working.** Run it before believing it:

```bash
docker run --rm -e MONGO_URI=… -e REDIS_URL=… driverzone-api
```

---

## Troubleshooting

**`ERR_PNPM_IGNORED_BUILDS` on install**
pnpm blocks install scripts by default. The permitted ones are listed under `allowBuilds` in
`pnpm-workspace.yaml`. If a new dependency needs one, add it there deliberately — a postinstall
script is arbitrary code from a transitive dependency.

**`Unable to resolve module …` in a mobile app**
Metro cache, nine times out of ten:
```bash
pnpm --filter @driverzone/customer exec expo start --clear
```
If it persists, see [`docs/engineering/08`](docs/engineering/08-mobile-in-monorepo.md). Do not
remove `node-linker=hoisted` from `.npmrc` — Metro cannot walk pnpm's default symlink layout.

**`MongoServerError: not primary`**
The replica-set init didn't run:
```bash
docker compose up -d mongo-init
```

**`ESLint couldn't find the config "@driverzone/config/eslint.base.cjs"`**
The package's `.eslintrc.cjs` is using the bare specifier. It must use `require.resolve` —
ESLint 8's own resolver ignores a package's `exports` map:
```js
module.exports = { root: true, extends: [require.resolve('@driverzone/config/eslint.base.cjs')] };
```

**`error module-internals-are-private`**
You imported another module's internals. Import its `<name>.public.js` contract instead; if what
you need isn't on it, add it — that's the design working.
[`docs/engineering/04`](docs/engineering/04-boundaries-and-enforcement.md#when-a-rule-blocks-you)
lists the options in order.

**A test suite shows as failed but passes on its own**
Turbo cancels sibling tasks when one fails, so a failure elsewhere makes healthy suites look
broken. Re-run the single package before investigating:
```bash
pnpm --filter @driverzone/geo test
```

**`tsc` complains about `string | undefined` on something obviously fine**
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on deliberately, and they find
real bugs — four during scaffolding alone. Fix the code rather than loosening the config;
[`docs/engineering/05`](docs/engineering/05-coding-standards.md#typescript) explains why.

---

## Three things to know before your first PR

**Money is integer paise.** `₹1,499.50` is `149950`. Never a float, never rupees. Every amount
field ends in `_paise` or `Paise`.

**Coordinates are `{lat, lng}` in code, `[lng, lat]` in GeoJSON and Mongo.** The conversion
lives in `@driverzone/geo` and nowhere else. Getting it wrong doesn't throw — it silently
resolves to the Arabian Sea and tells a customer you don't serve their city.

**Modules talk through `.public.ts` and nothing else.** Machine-enforced, and it costs nothing
at runtime — the contract file is types only and leaves no trace in the shipped bundle.

---

## Documentation

| | |
|---|---|
| [`docs/`](docs/README.md) | **The product** — zones, pricing, dispatch, booking lifecycle, API contracts |
| [`docs/engineering/`](docs/engineering/README.md) | **The code** — layout, architecture, boundaries, tech choices, deploy |

New to the project? Read `docs/engineering/README.md`, then `01` through `04`. About an hour,
and it covers every decision you need to make sense of the rest.
