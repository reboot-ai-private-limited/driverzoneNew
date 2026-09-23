# ─────────────────────────────────────────────────────────────────────────────
# apps/site — the public marketing site (home, about, contact, privacy, terms, delete-account).
#
# Same shape as apps/web/Dockerfile, minus everything the site does not use: it calls no API and
# imports no workspace package at runtime, so only packages/config (tsconfig/eslint) is copied.
#
#   docker build -f apps/site/Dockerfile -t driverzone-site .
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
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
COPY packages/config packages/config
COPY apps/site apps/site

# The canonical URL used for metadata/og:url (src/lib/site.ts). Inlined at BUILD time like every
# NEXT_PUBLIC_* value, so it is a build arg; unset, the build fails rather than shipping pages
# that advertise http://localhost:3001 as their own address.
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NODE_ENV=production

RUN test -n "$NEXT_PUBLIC_SITE_URL" || { \
      echo "NEXT_PUBLIC_SITE_URL is empty. Set it in the repo-root .env (e.g." >&2; \
      echo "https://driverzoneonline.com) and rebuild." >&2; exit 1; }

RUN pnpm --filter @driverzone/site build


FROM node:22-alpine AS runtime
WORKDIR /app
# HOSTNAME: the standalone server binds localhost by default, which inside a container means
# nothing outside it can connect.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# standalone/ excludes .next/static and public/ — both must be copied or the site renders
# unstyled with 404s on every chunk and image. See apps/web/Dockerfile.
COPY --from=build --chown=node:node /app/apps/site/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/site/.next/static     ./apps/site/.next/static
COPY --from=build --chown=node:node /app/apps/site/public           ./apps/site/public

USER node
EXPOSE 3001
CMD ["node", "apps/site/server.js"]
