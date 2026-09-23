# ─────────────────────────────────────────────────────────────────────────────
# apps/web — the Next.js admin panel.
#
# Separate image from the API, built from the same repo root. Contains the Next standalone
# server and nothing from apps/api — see the note in apps/api/Dockerfile.
#
#   docker build -f apps/web/Dockerfile -t driverzone-web .
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
# Next phones home on `next build` as well as at runtime, so this is set in every stage that
# runs Next. There is no next.config equivalent; the env var is the switch.
ENV NEXT_TELEMETRY_DISABLED=1


FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
# Every workspace manifest, not just this app's: --frozen-lockfile validates the whole
# workspace and fails if one named in the lockfile is absent. Manifests only — no source.
COPY apps/api/package.json                apps/api/
COPY apps/web/package.json                apps/web/
COPY apps/site/package.json               apps/site/
COPY apps/customer/package.json           apps/customer/
COPY apps/driver/package.json             apps/driver/
COPY packages/config/package.json         packages/config/
COPY packages/contracts/package.json      packages/contracts/
COPY packages/geo/package.json            packages/geo/
COPY packages/design-system/package.json  packages/design-system/
COPY packages/mobile-ui/package.json      packages/mobile-ui/
RUN pnpm install --frozen-lockfile --ignore-scripts=false


FROM deps AS build
COPY packages/config        packages/config
COPY packages/contracts     packages/contracts
COPY packages/geo           packages/geo
COPY packages/design-system packages/design-system
COPY apps/web apps/web

# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, which makes this image
# environment-specific: pointing it at a different API means a rebuild, not a restart. They are
# build args rather than runtime env for exactly that reason — passing them at `docker run`
# would look like it worked and change nothing. None of these is a secret.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

# The zone editor's map. Like every NEXT_PUBLIC_* value this is inlined into the client bundle
# and therefore PUBLIC — unavoidable, because the key authenticates a script the browser loads.
# It is protected by configuration, not secrecy, and both parts are required before deploying:
#   • an HTTP referrer restriction limiting the key to the panel's own domain, and
#   • an API restriction to Maps JavaScript API + Places API only.
# Unset builds an image whose zone editor shows a setup notice instead of a map; everything
# else on the screen still works. See docs/engineering/frontend-architecture.md §Environment.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NODE_ENV=production

# Unset, `next build` succeeds and bakes in the localhost fallback from src/lib/api/client.ts —
# an image that looks fine until a browser on another machine cannot reach the API. Fail here
# instead, where the message can say what to do. The Maps key is deliberately NOT checked: unset
# is a supported state that degrades to a setup notice.
RUN test -n "$NEXT_PUBLIC_API_BASE_URL" || { \
      echo "NEXT_PUBLIC_API_BASE_URL is empty. It is inlined at build time, so an image built" >&2; \
      echo "without it silently calls http://localhost:4000/api. Set it in the repo-root .env" >&2; \
      echo "and rebuild - see docs/engineering/build-and-deploy.md." >&2; exit 1; }

RUN pnpm --filter @driverzone/web build


FROM node:22-alpine AS runtime
WORKDIR /app
# HOSTNAME: the standalone server binds localhost by default, which inside a container means
# nothing outside it can connect — the port maps fine and every request hangs.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Three copies, all required.
#   1. standalone/  — the traced server plus only the node_modules it actually loads. In a
#                     monorepo it mirrors the workspace layout, hence apps/web/server.js below.
#   2. .next/static — NOT part of standalone output. Missing it renders the page unstyled with
#                     a 404 on every JS chunk, which looks like a broken app rather than a
#                     missing COPY.
#   3. public/      — same story, for the logo and favicons.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static     ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public           ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
