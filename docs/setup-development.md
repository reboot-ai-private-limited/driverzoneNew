# Setting Up DriverZone Locally

Two workflows, two compose files. Pick the one that matches what you are doing.

| | `docker-compose.dev.yml` | `docker-compose.prod.yml` |
|---|---|---|
| **What runs in Docker** | Mongo, Redis, OSRM | everything — plus API, worker, admin panel |
| **Where the apps run** | your machine, via `pnpm` | inside built images |
| **Code changes** | hot reload, sub-second | rebuild the image |
| **Database ports** | published to the host | closed — compose network only |
| **Use it to** | build features (the default, every day) | verify a release, reproduce an image-only bug, deploy |

If you are here to write code, you want the **development setup**. The production setup is for
the handful of times a day-to-day dev needs it.

There is no bare `docker-compose.yml`. Every command names its file with `-f`, on purpose —
mixing the two stacks by accident is exactly what the split exists to prevent.

---

## Prerequisites

| | Version | Check |
|---|---|---|
| Node | ≥ 20 | `node --version` |
| pnpm | 11.18.0 | `corepack enable && corepack prepare pnpm@11.18.0 --activate` |
| Docker | any recent, with Compose v2 | `docker compose version` |

Use **corepack**, not a globally installed pnpm. The version is pinned in `package.json` and a
different one resolves the lockfile differently — which surfaces days later as a dependency
that works on your machine and nowhere else.

---

## Development setup

From a fresh clone, top to bottom:

```bash
git clone git@github.com:reboot-ai-private-limited/driverzoneNew.git driverzone
cd driverzone

corepack enable && corepack prepare pnpm@11.18.0 --activate
pnpm install

cp apps/api/.env.example apps/api/.env

# Mongo + Redis. Takes ~15s the first time while the images pull.
docker compose -f docker-compose.dev.yml up -d

# The API and the admin panel, both in watch mode.
pnpm turbo run dev --filter=@driverzone/api --filter=@driverzone/web
```

If Docker reports a port already in use, you have a Mongo or Redis on the host already — see
[the troubleshooting entry](#troubleshooting) for the one-variable fix.

In a second terminal, confirm it worked:

```bash
curl localhost:4000/api/health
```

`200` means healthy. `503` means the API is up but a dependency is not — the `dependencies`
array in the response names which one. The admin panel is on <http://localhost:3000>.

That's the whole setup. The rest of this section is what those commands are actually doing.

### Why the apps run outside Docker

Because a rebuild is not a reload. Running `pnpm dev` on the host means `tsx watch` and
`next dev` see your file the moment you save it; the same code in an image is a multi-minute
`docker compose build` per change. Nothing about the API requires a container — only Mongo,
Redis and OSRM do, and those are what `docker-compose.dev.yml` provides.

This is also why `apps/api/.env` points at `localhost:27017` and `localhost:6379`: your API
process is on the host, not on the compose network, so it reaches the databases through the
ports the dev file publishes. The production file publishes neither, because there the API is
a container and talks to `mongo:27017` by service name.

Those ports bind to `127.0.0.1`, not `0.0.0.0` — an unauthenticated Mongo has no business
being reachable from the coffee-shop wifi — and both are overridable (`MONGO_PORT`,
`REDIS_PORT`, `OSRM_PORT`) for machines that already run one.

The connection string carries `?replicaSet=rs0&directConnection=true`. Without those the driver
connects in single-node topology: ordinary reads and writes work, and the first transaction
fails with `Transaction numbers are only allowed on a replica set member or mongos` — which
tends to surface much later than the setup that caused it.

### Why `mongo-init` exists

The `mongo` service starts as a **replica set** (`--replSet rs0`) even though it is a single
node, because multi-document transactions require one and the booking→ledger write in
[`05-pricing-and-commission.md`](05-pricing-and-commission.md) needs a transaction to stay
consistent. Adding the replica set later means re-seeding every environment.

But a replica set is not usable until it is initiated. `mongo-init` is a one-shot container
that runs `rs.initiate()` and exits — you will see it as `Exited (0)` in `docker compose ps`,
which is correct, not a crash. Skip it and Mongo starts fine and refuses every write with
`MongoServerError: not primary`.

### Filters, and why the bare command is wrong

`pnpm turbo run dev` with no filter also starts the two **Expo dev servers** for
`apps/customer` and `apps/driver`. They are interactive terminal UIs, they fight over stdin
with the other tasks, and you almost certainly do not want them while working on the backend.
Name what you need:

```bash
pnpm turbo run dev --filter=@driverzone/api                    # API only
pnpm turbo run dev --filter=@driverzone/api --filter=@driverzone/web
pnpm turbo run dev --filter=@driverzone/customer               # the customer app
```

### The worker

`apps/api` ships **two composition roots over the same code**: `server.ts` serves HTTP,
`worker.ts` hands the same modules to BullMQ queue consumers. `turbo run dev` starts only the
server. Start the worker when you are touching dispatch or notifications:

```bash
pnpm turbo run dev:worker --filter=@driverzone/api    # or: pnpm --filter @driverzone/api dev:worker
```

Both at once, in one terminal:

```bash
pnpm turbo run dev dev:worker --filter=@driverzone/api --filter=@driverzone/web
```

### Verify the whole workspace

```bash
pnpm turbo run typecheck lint test
```

`lint` includes `dependency-cruiser`, which enforces the module boundaries. Under MongoDB
those boundaries protect data integrity rather than tidiness — see
[`engineering/04`](engineering/04-boundaries-and-enforcement.md).

---

## Production setup

Everything in Docker, built the way a deployed host builds it.

```bash
cp apps/api/.env.prod.example apps/api/.env.prod
# edit apps/api/.env.prod — at minimum CORS_ORIGINS

docker compose -f docker-compose.prod.yml up -d --build
```

The first `--build` compiles both images and takes several minutes. Then:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api

curl localhost:4000/api/health
curl -I localhost:3000
```

Tear it down when you are finished — it holds ports 3000 and 4000, which the dev workflow also
wants:

```bash
docker compose -f docker-compose.prod.yml down
```

### What differs from the dev stack, and why

- **`apps/api/.env.prod`, not `.env`.** The dev file has `NODE_ENV=development` and localhost
  URIs; loading it into a production image would quietly misconfigure both.
- **Mongo and Redis publish no ports.** They are reachable only by `api` and `worker` over the
  compose network. On a real host, a published 27017 is an unauthenticated database exposed to
  anything that can route to it. To inspect it:
  `docker compose -f docker-compose.prod.yml exec mongo mongosh driverzone`.
- **Separate volumes** (`driverzone-mongo-data-prod` vs `-dev`). The two stacks never share
  data, so a prod-stack experiment cannot corrupt what you develop against.
- **`worker` is the API image with a different `command`.** One build, one version, no drift.
- **`restart: unless-stopped`** everywhere the dev file has nothing.

### `NEXT_PUBLIC_API_BASE_URL` is a build arg, not runtime env

Next inlines `NEXT_PUBLIC_*` into the client bundle at **build** time, so the web image is
environment-specific. Pointing it at a different API is a rebuild, not a restart — passing the
variable at `docker run` looks like it worked and changes nothing.

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.driverzone.example/api \
  docker compose -f docker-compose.prod.yml up -d --build web
```

It is the **browser** that calls this URL, so it must be reachable from the browser.
`http://api:4000` resolves inside the compose network and nowhere else.

---

## Everyday commands

| | Development | Production |
|---|---|---|
| Start | `docker compose -f docker-compose.dev.yml up -d` | `docker compose -f docker-compose.prod.yml up -d --build` |
| Status | `docker compose -f docker-compose.dev.yml ps` | `docker compose -f docker-compose.prod.yml ps` |
| Logs | `docker compose -f docker-compose.dev.yml logs -f mongo` | `docker compose -f docker-compose.prod.yml logs -f api` |
| Stop, keep data | `docker compose -f docker-compose.dev.yml down` | `docker compose -f docker-compose.prod.yml down` |
| Stop, **wipe the database** | `docker compose -f docker-compose.dev.yml down -v` | `docker compose -f docker-compose.prod.yml down -v` |
| Rebuild images | — | `docker compose -f docker-compose.prod.yml build --no-cache` |

Shell alias worth having:

```bash
alias dzdev='docker compose -f docker-compose.dev.yml'
alias dzprod='docker compose -f docker-compose.prod.yml'
```

---

## Seed data — planned, not yet implemented

> **Status: not built.** Documented here so the shape is agreed before someone writes it.
> Until it lands, create test accounts by hand or through the admin panel.

Right now a fresh `down -v` leaves you with an empty database: no admin to log into the panel
with, no drivers to dispatch to, no zones, and therefore no packages — which means no quote can
be produced at all. Every developer recreates that by hand, differently, and bugs that depend
on the shape of the data become impossible to reproduce across machines.

The fix is a seed script, run once after the stack is up:

```bash
pnpm --filter @driverzone/api seed        # planned
```

What it should create:

| | | Why |
|---|---|---|
| 1 admin | fixed credentials, printed on completion | log into the panel without a signup flow |
| ~3 drivers | varied: online/offline, different vehicle classes, one suspended | dispatch waves need more than one candidate to be worth testing |
| ~3 customers | one with saved addresses, one brand new | the empty-state and populated cases both matter |
| 2–3 zones | one city, one pickup-coverage area, one hill region | zone resolution is the core algorithm ([`04`](04-zone-resolution.md)) — with no polygons nothing prices |
| packages on those zones | one incity hourly, one outstation band | a zone with no packages still returns no quote |
| a few bookings | one per interesting lifecycle state ([`07`](07-booking-lifecycle.md)) | admin list/detail screens are unreviewable against an empty table |

Properties it needs to have, in rough priority order:

1. **Refuse to run against production.** Hard-fail on `NODE_ENV=production` before touching
   anything. A seed script is a data-destroying script wearing a friendly name.
2. **Idempotent.** Fixed IDs (UUID v7 where ordering matters, per the repo convention) and
   upserts, so running it twice does not produce six drivers. `--reset` can be a separate,
   explicit flag.
3. **Deterministic.** Same IDs, phone numbers and polygons on every machine, so "driver
   `…0003` never gets the offer" means the same thing in your terminal as in mine. No faker
   with a random seed.
4. **Written against the module public APIs**, not raw Mongoose. Seeding through
   `zones.public.ts` means the geometry invariants in `@driverzone/geo` run — a seed that
   writes invalid polygons straight to the collection creates state the app can never produce
   and everyone then debugs.
5. **Prints what it made.** A table of logins and IDs at the end; nobody should have to read
   the script to find the admin password.

Likely shape: `apps/api/src/scripts/seed.ts`, run with `tsx`, composing the same container the
server does. Worth folding into the setup steps above once it exists, and worth a
`docker compose -f docker-compose.dev.yml up -d && pnpm seed` one-liner.

---

## Troubleshooting

**`MongoServerError: not primary`**
The replica-set init did not run. It is a one-shot container:
```bash
docker compose -f docker-compose.dev.yml up -d mongo-init
```

**`failed to bind host port 0.0.0.0:6379: address already in use`**
Something else owns the port — usually a Mongo or Redis installed on the host, or the
production stack still running. Find it with `ss -tlnp | grep 6379`, then either stop it or
move the dev stack out of the way:

```bash
REDIS_PORT=6380 docker compose -f docker-compose.dev.yml up -d
```

Then change `REDIS_URL` in `apps/api/.env` to match — the override moves the **host** port
only, so the API has to be told. `MONGO_PORT` and `OSRM_PORT` work the same way. Putting them
in a root `.env` file makes them stick without retyping.

**Ports 3000/4000 in use when starting `pnpm dev`**
The production stack is up. `docker compose -f docker-compose.prod.yml down`.

**`Invalid environment: MONGO_URI is required`**
`apps/api/.env` does not exist. `cp apps/api/.env.example apps/api/.env`. Every variable is
parsed through Zod at boot (`apps/api/src/config/env.ts`) so a missing one fails immediately
with its name, rather than surfacing as `undefined` inside a connection string an hour later.

**`env file /…/apps/api/.env.prod not found`**
The production stack needs its own env file: `cp apps/api/.env.prod.example apps/api/.env.prod`.

**The API is running but writes go to the wrong data**
Check which stack is up. Both publish `:4000` but they use different volumes, so an API from
the prod stack is reading `driverzone-mongo-data-prod`. `docker volume ls | grep driverzone`.

**`ERR_PNPM_IGNORED_BUILDS` on install**
pnpm blocks install scripts by default. The permitted ones are listed under `allowBuilds` in
`pnpm-workspace.yaml`. If a new dependency needs one, add it there deliberately — a postinstall
script is arbitrary code from a transitive dependency.

**`Unable to resolve module …` in a mobile app**
Metro cache, nine times out of ten:
```bash
pnpm --filter @driverzone/customer exec expo start --clear
```
If it persists see [`engineering/08`](engineering/08-mobile-in-monorepo.md). Do not remove
`node-linker=hoisted` from `.npmrc` — Metro cannot walk pnpm's default symlink layout.

**Stale or broken database state**
```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
```
`-v` deletes the volumes. That is the point, and it is unrecoverable.

---

## OSRM

Road distance for outstation band matching ([`04`](04-zone-resolution.md)). It is commented out
in both compose files because it needs a prepared OSM extract before it will start — the
`osrm-extract` / `osrm-partition` / `osrm-customize` commands are in
[`engineering/09`](engineering/09-build-and-deploy.md#local-development). Budget about an hour
and ~8GB of RAM, once.

You can build most features without it. You cannot trust an outstation quote without it:
mocked distances hide exactly the band-boundary bugs that matter.

---

## Where to go next

- [`engineering/README.md`](engineering/README.md) — the handbook. Read `01`–`04` in order.
- [`engineering/09`](engineering/09-build-and-deploy.md) — what gets built, what deploys where.
- [`../README.md`](../README.md) — daily workflow and the full command reference.
