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
pnpm dev:web
```

Working on something else? [Pick your combination](#running-the-combination-you-need) —
`dev:api`, `dev:backend`, `dev:customer`, `dev:driver`. Note that `pnpm dev` with no suffix is
**not** the one you want; the mobile apps need their own terminal, and the section below
explains why.

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
[`pricing-and-commission.md`](LLD/pricing-and-commission.md) needs a transaction to stay
consistent. Adding the replica set later means re-seeding every environment.

But a replica set is not usable until it is initiated. `mongo-init` is a one-shot container
that runs `rs.initiate()` and exits — you will see it as `Exited (0)` in `docker compose ps`,
which is correct, not a crash. Skip it and Mongo starts fine and refuses every write with
`MongoServerError: not primary`.

### Running the combination you need

There are four things you can run, and you rarely want all of them. Pick by what you are
working on:

| Working on | Command | Runs |
|---|---|---|
| API endpoints, domain logic | `pnpm dev:api` | api |
| Dispatch, notifications, anything queued | `pnpm dev:backend` | api + worker |
| The admin panel | `pnpm dev:web` | api + web |
| Admin panel with queue side effects | `pnpm dev:full` | api + worker + web |
| The customer app | `pnpm dev:customer` **in its own terminal** | customer |
| The driver app | `pnpm dev:driver` **in its own terminal** | driver |

`dev:web` starts the API too, because the panel is unusable without it — every screen it has
calls `/api`. If you genuinely want Next alone, `pnpm turbo run dev --filter=@driverzone/web`.

These are thin wrappers over turbo filters (see `package.json`), so any combination the table
does not cover is one command away:

```bash
pnpm turbo run dev --filter=@driverzone/api --filter=@driverzone/web
pnpm turbo run dev dev:worker --filter=@driverzone/api      # server and worker together
pnpm turbo run dev --filter='...@driverzone/geo'            # everything depending on geo
```

Multiple `--filter` flags union. `dev` and `dev:worker` are separate turbo tasks, so naming
both runs both.

### The mobile apps go in their own terminal

**Do not run `apps/customer` or `apps/driver` through turbo.** They start `expo start`, which
needs a real terminal, and turbo's output multiplexer is not one. What you lose:

- the **QR code** — the only convenient way to open the app on a physical device
- the **keyboard shortcuts** (`a` Android, `i` iOS, `r` reload, `j` debugger)
- the `exp://…` URL Expo prints for manual entry

You get a Metro bundler with no way to reach it. This is why `pnpm dev:customer` calls
`pnpm --filter … dev` directly instead of going through turbo, and why `pnpm dev` — bare, no
filter — is the wrong command: it starts both Expo servers this way, plus two more tasks
competing for the same terminal.

So a customer-app session is two terminals:

```bash
# terminal 1
pnpm dev:backend        # or dev:api, if nothing you touch is queued

# terminal 2
pnpm dev:customer       # QR code, shortcuts, all of it
```

Both mobile apps at once is three terminals. The second one finds Metro's default port taken
and asks:

```
? Use port 8082 instead? › (Y/n)
```

Answer `Y` and they coexist fine. That prompt is also the clearest demonstration of why these
cannot run under turbo: there it appears with no terminal able to answer it, and the task hangs
forever.

### A phone cannot reach `localhost`

Once the apps start calling the API (phase 7, [`roadmap.md`](LLD/roadmap.md)), this bites
immediately: `localhost` on a physical device means *the device*, not your machine. Expo
already prints the address it expects you to use —

```
› Metro waiting on exp://192.168.1.16:8081
```

— and the API needs the same treatment: `http://192.168.1.16:4000/api`, your LAN address from
`hostname -I` or `ipconfig`. The API server binds all interfaces already, so nothing needs
changing on that side; the phone and the laptop just have to be on the same network.

An emulator is the exception. The Android emulator reaches the host at `10.0.2.2`, and the iOS
simulator shares the host's network stack, so `localhost` works there.

### The worker is not a second app

`apps/api` ships **two composition roots over the same code**: `server.ts` serves HTTP,
`worker.ts` hands the same modules to BullMQ queue consumers. That is why `dev:backend` runs
two turbo tasks against one package rather than two packages, and why production runs one image
with two commands ([`engineering/09`](engineering/build-and-deploy.md)). A worker running
different code from the API is a class of bug that cannot happen here.

### Verify the whole workspace

```bash
pnpm turbo run typecheck lint test
```

`lint` includes `dependency-cruiser`, which enforces the module boundaries. Under MongoDB
those boundaries protect data integrity rather than tidiness — see
[`engineering/04`](engineering/boundaries-and-enforcement.md).

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

## Seed data

A fresh `docker compose down -v` leaves an empty database: no admin to log into the panel with,
no drivers to dispatch to. Every developer used to recreate that by hand, differently, which made
bugs that depend on the shape of the data impossible to reproduce across machines.

```bash
pnpm seed        # or: pnpm --filter @driverzone/api seed
```

Creates four accounts, and prints them when it finishes:

| Role | Phone | State |
|---|---|---|
| Admin | `+919000000001` | active — the only way into the admin panel |
| Driver | `+919000000002` | `APPROVED`, verified, off duty; licence and Aadhaar both `VERIFIED` |
| Customer | `+919000000003` | full profile, two saved addresses, one vehicle |
| Customer | `+919000000004` | phone only — the brand-new, empty-profile case |

The two customers exist because the empty state is where progressive-profile bugs live: every
screen has to render an account with no name, no addresses and no vehicles.

**Idempotent.** It is keyed on fixed IDs, so running it twice restores the intended state rather
than producing a second set of accounts, and it leaves any other data in the database alone. The
one exception is deliberate: the empty customer's profile fields are only written on insert, so
filling that account in while testing survives the next seed run.

### Logging in without reading the logs

By default a login means calling `otp/send` and reading the code off the API log line. To skip
that, set a fixed code in `apps/api/.env`:

```ini
DEV_FIXED_OTP=000000
```

`POST /{role}/auth/otp/verify` then accepts that code directly — no `otp/send` first. It is
scoped to the four seeded numbers above; any other number still gets a real random code, so the
generation, hashing and attempt-burning paths stay exercised locally.

Four independent things have to hold for it to do anything: the variable set, `NODE_ENV` not
production, the number on the seed list, and the code matching. The process additionally
**refuses to start** if the variable is set with `NODE_ENV=production`. See the decision log,
2026-08-24.

### Still to build

The seed covers identity only. `zones`, `catalog`, `quotes` and `bookings` do not exist yet, so
there are still no polygons, no packages and therefore no quotes — a fresh database cannot
produce a fare. When those modules land the seed should grow to cover them, and two properties
matter more there than they do here:

- **Seed zones through `zones.public.ts`, not Mongoose.** That runs the `@driverzone/geo`
  invariants, so the seed cannot create geometry the app itself could never produce. Identity
  needs no equivalent — its rules are single-document and the schema enforces them on any write,
  which is why `seed.ts` uses the models directly and says so in its header.
- **More than one driver.** Dispatch waves need several candidates with different duty states and
  vehicle classes to be worth testing; one approved driver is enough only while there is no
  dispatch module.

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
If it persists see [`engineering/08`](engineering/mobile-in-monorepo.md). Do not remove
`node-linker=hoisted` from `.npmrc` — Metro cannot walk pnpm's default symlink layout.

**Stale or broken database state**
```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
```
`-v` deletes the volumes. That is the point, and it is unrecoverable.

---

## OSRM

Road distance for outstation band matching ([`04`](LLD/zone-resolution.md)). It is commented out
in both compose files because it needs a prepared OSM extract before it will start — the
`osrm-extract` / `osrm-partition` / `osrm-customize` commands are in
[`engineering/09`](engineering/build-and-deploy.md#local-development). Budget about an hour
and ~8GB of RAM, once.

You can build most features without it. You cannot trust an outstation quote without it:
mocked distances hide exactly the band-boundary bugs that matter.

---

## Where to go next

- [`engineering/README.md`](engineering/README.md) — the handbook. Read `01`–`04` in order.
- [`engineering/09`](engineering/build-and-deploy.md) — what gets built, what deploys where.
- [`../README.md`](../README.md) — daily workflow and the full command reference.
