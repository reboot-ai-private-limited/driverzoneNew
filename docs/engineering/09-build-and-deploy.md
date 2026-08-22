# 09 — Build & Deploy

## Monorepo ≠ monodeploy

The most common worry about a four-app monorepo is that every server ends up carrying every
app's code. It does not, and the reason is worth being precise about.

**The build context is the repo root. The image is not.**

Both Dockerfiles are built from `.` — they have to be, because the pnpm lockfile and workspace
manifest live there and `--frozen-lockfile` is impossible without them. But each one copies only
its own runtime output into a clean final stage:

```dockerfile
# apps/api/Dockerfile — runtime stage
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist     ./dist
```

No Next.js. No React Native. No admin panel. The API image contains `dist/` and the production
dependencies it actually requires.

`.dockerignore` keeps `node_modules`, build output, `docs/` and every `.env` out of the build
context, so they are never uploaded to the daemon and cannot end up in a layer.

The mobile apps' **`package.json` files do stay in the context** — `pnpm install
--frozen-lockfile` validates the whole workspace and fails if a package named in the lockfile
is missing. Their source is a few KB and is never copied into any image. Excluding them
outright produces a confusing early failure:

```
failed to compute cache key: "/packages/mobile-ui/package.json": not found
```

## What gets produced

| Artifact | Built from | Contains | Goes to |
|---|---|---|---|
| `driverzone-api` | `apps/api/Dockerfile` | `dist/` + prod deps | VM / ECS |
| `driverzone-worker` | **the same image**, different `CMD` | — | VM / ECS |
| `driverzone-web` | `apps/web/Dockerfile` | Next standalone output | VM / ECS |
| `driverzone-customer.aab` | `apps/customer` via EAS | — | Play Store / App Store |
| `driverzone-driver.aab` | `apps/driver` via EAS | — | Play Store |

**Two server artifacts, two store binaries.** The mobile apps never touch a server.

### One image, two processes

`server.ts` and `worker.ts` are two composition roots over the same modules
([03](03-module-anatomy.md)). They ship in one image:

```yaml
# docker-compose.prod.yml
api:
  build: { context: ., dockerfile: apps/api/Dockerfile }
worker:
  build: { context: ., dockerfile: apps/api/Dockerfile }
  command: ['node', 'dist/worker.js']
```

One build, one version, no drift. A worker running different code from the API is a whole
category of bug that simply cannot occur here.

## Dockerfile structure

Three stages, and the split is about layer caching:

```
base     node:22-alpine + pinned corepack pnpm
  ↓
deps     COPY manifests only  →  pnpm install --frozen-lockfile
  ↓                              ← editing a .ts file does NOT invalidate this
build    COPY source          →  tsc --noEmit && esbuild  →  pnpm deploy --prod
  ↓
runtime  COPY dist + node_modules, USER node, CMD
```

Copying manifests separately from source is the difference between a 20-second rebuild and a
three-minute one on a small VM.

Details that took a while to get right and should not be casually changed:

- **`corepack prepare pnpm@11.18.0`** pinned to the root `packageManager`. Unpinned, the deploy
  host resolves a different pnpm than the lockfile was written by.
- **`--frozen-lockfile`** so a stale lockfile fails the build loudly rather than quietly
  resolving untested versions.
- **`COPY packages/…`** in the build stage. The workspace packages are source-only; omit them
  and the build fails on the first `@driverzone/` import.
- **Externals are enumerated, not blanket** (`apps/api/esbuild.config.mjs`). Third-party deps
  stay external because Mongoose and BullMQ do dynamic resolution a bundler cannot follow —
  which is why `pnpm deploy --prod` produces a real node_modules tree to copy. The
  `@driverzone/*` workspace packages are **bundled**. See the warning below.
- **`USER node`.** Never root.
- **Exec-form `CMD`**, so node is PID 1 and receives SIGTERM directly. A shell wrapper swallows
  the signal, `server.ts` never drains, and every deploy cuts live responses mid-flight — for a
  driver mid-accept, an offer that neither succeeded nor failed.
- **`tsc --noEmit` inside `build`**, so a type error fails the image rather than shipping.

### The trap: do not blanket-externalise with source-only workspace packages

`--packages=external` marks *everything* external, and it cannot be selectively undone. With
workspace packages that publish TypeScript source (`exports: "./src/index.ts"`), that means the
runtime tries to `import` a `.ts` file from inside `node_modules`, and Node refuses:

```
Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently
unsupported for files under node_modules, for
".../node_modules/@driverzone/geo/src/index.ts"
```

**This does not fail at build time.** `tsc --noEmit` passes, esbuild succeeds, every layer
looks right, the image is the expected size — and the container crashes on its first line.

The fix is to enumerate externals from `package.json` and exclude our own packages:

```js
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@driverzone/'));
```

Bundling them is also better: `@driverzone/geo` pulls in Turf, but the API only imports
`CoordinateError`, so tree-shaking drops Turf entirely and `dist/server.js` is 11.6kb.

The general lesson: **a Docker build succeeding is not the same as the image working.** Run the
container before believing it:

```bash
docker run --rm -e MONGO_URI=… -e REDIS_URL=… driverzone-api
```

### Next.js specifics

- `output: 'standalone'` — traces only the files the server loads.
- `outputFileTracingRoot` must point at the repo root, or tracing stops at `apps/web` and ships
  an image missing half its imports.
- **Three** COPY lines are required. `.next/static` and `public/` are *not* part of standalone
  output; missing them renders the page unstyled with a 404 on every chunk, which looks like a
  broken app rather than a missing COPY.
- `HOSTNAME=0.0.0.0` — the standalone server binds localhost by default, which inside a
  container means the port maps fine and every request hangs.
- `NEXT_PUBLIC_*` are inlined at **build** time, so the web image is environment-specific.
  Pointing it at a different API is a rebuild, not a restart. They are build args for exactly
  that reason: passing them at `docker run` would look like it worked and change nothing.

## Local development

```bash
cp apps/api/.env.example apps/api/.env
docker compose -f docker-compose.dev.yml up -d    # infrastructure only
pnpm turbo run dev --filter=@driverzone/api --filter=@driverzone/web
```

`docker-compose.dev.yml` runs Mongo, Redis and OSRM and nothing else — the apps run on the
host so a save reloads instead of rebuilding an image. `docker-compose.prod.yml` runs the
stack below in full, from these images. Both are covered in
[`../setup-development.md`](../setup-development.md).

`mongo-init` promotes the single node to a replica set and exits. Without it Mongo starts but
refuses every write with `not primary` — multi-document transactions require a replica set, and
the booking→ledger write needs one.

OSRM is commented out in compose because it needs a prepared OSM extract:

```bash
mkdir -p deploy/osrm && cd deploy/osrm
wget https://download.geofabrik.de/asia/india-latest.osm.pbf
docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/india-latest.osm.pbf
docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/india-latest.osrm
docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/india-latest.osrm
```

Takes about an hour and needs ~8GB RAM. Worth doing once — without it, every developer's quote
flow either hits a paid API or gets mocked, and mocked distances hide exactly the band-boundary
bugs that matter ([`../04-zone-resolution.md`](../04-zone-resolution.md)).

## CI

Path-filtering is what makes a four-app monorepo pleasant rather than painful. Without it a
driver-app copy change rebuilds and redeploys the API.

```bash
pnpm ci    # turbo run typecheck lint test build --filter='...[origin/main]'
```

`...[origin/main]` computes the affected subgraph from git: changed packages **and** everything
depending on them. Touch `packages/geo` and it correctly rebuilds the API and the admin panel;
touch `apps/driver` and it builds nothing else.

Suggested pipeline:

```
on PR:
  install (pnpm cache) → pnpm ci

on merge to main:
  detect changed paths
  ├─ apps/api or packages/{contracts,geo,config}  → build+push api image  → deploy api + worker
  ├─ apps/web or packages/{contracts,geo,design-system,config} → build+push web image → deploy web
  └─ apps/{customer,driver} or packages/mobile-ui → eas build (manual approval)
```

Mobile builds stay behind a manual gate. Store review takes days and a wasted submission costs
more than a wasted container build.

## Production topology

At pilot scale, one VM:

```
                nginx (TLS, rate limits)
                   │
        ┌──────────┼──────────┐
        │          │          │
   web:3000   api:4000    (worker, no port)
                   │
        ┌──────────┼──────────┐
     mongo       redis      osrm
```

API and web are separate containers from day one even on one host. When the API needs
horizontal scaling, moving it to its own host is a compose change rather than a refactor —
which is the entire reason for the split.

### Scaling order

The parts that strain first, in order:

1. **Driver location writes** — already tiered through Redis
   ([`../09-architecture.md`](../09-architecture.md)); next step is a dedicated write path
2. **Socket connections** — Socket.IO's Redis adapter allows horizontal scaling from day one
3. **OSRM** — stateless; add containers behind a load balancer
4. **Mongo** — replica set already required; add read preference for reporting queries

Nothing here needs rearchitecting to reach 10× the year-one target.

## Environment variables

| Where | How | Why |
|---|---|---|
| API (runtime) | compose `env_file` | Secrets must never enter an image layer — a baked `.env` leaks to anyone who can pull |
| Web (`NEXT_PUBLIC_*`) | Docker build args | Inlined into the client bundle at build time |
| Mobile | EAS secrets + `app.config.ts` | Baked into the binary |

`apps/api/src/config/env.ts` parses everything through Zod at boot. A missing variable fails the
process immediately with the variable named, rather than surfacing as `undefined` inside a
connection string an hour into a deploy.

## Release checklist

- [ ] `pnpm check` green
- [ ] `pnpm --filter @driverzone/api lint:deps` — no boundary violations
- [ ] Both images build from a clean clone
- [ ] Migrations/seeds run against staging first
- [ ] `/api/health` returns 200 after deploy (503 = a dependency is down)
- [ ] Contract change? Both mobile apps still typecheck against the new `@driverzone/contracts`
- [ ] Mobile release? Confirm the **oldest supported app version** still works against the new
      API — users sit on old binaries for months
