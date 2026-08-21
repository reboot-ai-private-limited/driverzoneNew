# ─────────────────────────────────────────────────────────────────────────────
# apps/api — the Express API *and* the BullMQ worker.
#
# ONE image, two commands. `src/worker.ts` is a second composition root, not a second
# application: it builds the same modules from the same code and differs only in what it does
# with them. Compose runs it as `node dist/worker.js`.
#
# THIS IS THE ANSWER TO "do I ship everything to every server?" — no. The build CONTEXT is the
# repo root, because the pnpm lockfile and workspace manifest live there and a frozen install
# is impossible without them. The resulting IMAGE contains only dist/ plus production
# dependencies: no Next.js, no React Native, no admin panel.
#
#   docker build -f apps/api/Dockerfile -t driverzone-api .
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
# Pinned to `packageManager` in the root package.json. An unpinned corepack would resolve a
# different pnpm on the deploy host than the lockfile was written by.
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app


# ── deps ─────────────────────────────────────────────────────────────────────
# Manifests only, copied apart from the source so editing a .ts file does not invalidate the
# install layer. On a small VM that is a 20-second rebuild instead of a three-minute one.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# Every workspace manifest, not just this app's: --frozen-lockfile validates the whole
# workspace and fails if one named in the lockfile is absent. Manifests only — no source.
COPY apps/api/package.json                apps/api/
COPY apps/web/package.json                apps/web/
COPY apps/customer/package.json           apps/customer/
COPY apps/driver/package.json             apps/driver/
COPY packages/config/package.json         packages/config/
COPY packages/contracts/package.json      packages/contracts/
COPY packages/geo/package.json            packages/geo/
COPY packages/design-system/package.json  packages/design-system/
COPY packages/mobile-ui/package.json      packages/mobile-ui/
# --frozen-lockfile: a deploy must fail loudly on a stale lockfile rather than quietly
# resolving versions that were never tested.
RUN pnpm install --frozen-lockfile --ignore-scripts=false


# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
# The workspace packages are SOURCE-only — their `exports` point at ./src/index.ts. There is
# nothing prebuilt to copy, and omitting them fails the build on the first @driverzone import.
COPY packages/contracts packages/contracts
COPY packages/geo       packages/geo
COPY packages/config    packages/config
COPY apps/api/tsconfig.json apps/api/.dependency-cruiser.cjs apps/api/esbuild.config.mjs apps/api/
COPY apps/api/src apps/api/src

# `build` is `tsc --noEmit && esbuild …`, so a type error fails the image rather than shipping.
RUN pnpm --filter @driverzone/api build

# A production-only, real (non-symlinked) node_modules tree that can be copied into a clean
# stage. Needed because the third-party runtime deps are left external — mongoose and bullmq do
# dynamic resolution a bundler cannot follow.
#
# The @driverzone/* workspace packages are NOT external; esbuild.config.mjs explains why. If
# they were, this image would build cleanly and crash on its first line.
RUN pnpm --filter @driverzone/api deploy --prod --legacy /prod/api


# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Ownership set on copy rather than a later `chown -R`, which would duplicate every file into
# a second layer.
COPY --from=build --chown=node:node /prod/api/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist     ./dist

# Never root. Nothing here writes to disk — logs go to stdout for the container runtime.
USER node
EXPOSE 4000

# Exec form, so node is PID 1 and receives SIGTERM directly. server.ts installs its own handler
# and drains in-flight requests; a shell wrapper would swallow the signal and every deploy
# would cut live responses mid-flight.
CMD ["node", "dist/server.js"]
