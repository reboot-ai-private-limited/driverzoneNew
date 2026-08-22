# 01 — Monorepo Layout

## The tree

```
driverzone/
├── apps/                       deployable things
│   ├── api/                    Express + BullMQ worker   → Docker image
│   ├── web/                    Next.js admin panel       → Docker image
│   ├── customer/               Expo React Native         → App Store / Play
│   └── driver/                 Expo React Native         → Play Store
├── packages/                   shared, never deployed alone
│   ├── contracts/              API wire types + error codes    (all four apps)
│   ├── geo/                    coordinates, zone invariants, terrain  (api + web)
│   ├── design-system/          web React components + tokens   (web)
│   ├── mobile-ui/              RN components                   (customer + driver)
│   └── config/                 tsconfig / eslint bases         (everything)
├── docs/
│   ├── 01-12*.md               product & architecture
│   └── engineering/            this handbook
├── deploy/nginx/
├── docker-compose.dev.yml      infrastructure only — apps run on the host
├── docker-compose.prod.yml     full stack in Docker
├── turbo.json                  task orchestration + caching
├── pnpm-workspace.yaml         which directories are packages
└── .npmrc                      node-linker=hoisted  ← required by React Native
```

## apps/ vs packages/

The rule is **deployability**, not size.

- **`apps/*`** produce an artifact someone runs: a container image or a store binary. Each has
  its own `Dockerfile` or EAS profile. An app may depend on packages; an app must **never**
  depend on another app.
- **`packages/*`** are consumed at build time and never deployed on their own. They publish
  TypeScript source (`exports: "./src/index.ts"`) rather than a build — consumers compile them
  (`transpilePackages` in Next, Metro for RN, esbuild for the API). One less build step, one
  less thing to be stale.

If you are unsure where something goes, ask whether it could ever be deployed by itself. If
not, it is a package.

## Why four apps and not two

`customer` and `driver` are separate apps rather than one binary with a role flag:

- Different store listings, screenshots, review cycles, and release cadences
- The driver app needs an Android **foreground service** and background location; shipping
  those permissions to customers is both a review risk and a trust problem
- A customer-facing bug fix should not require re-reviewing driver background-location code

They share `@driverzone/mobile-ui` and `@driverzone/contracts`, which is where the actual
duplication would otherwise be.

## Why pnpm *and* Turborepo

They are not alternatives — this is the most common confusion about this setup.

|  | pnpm | Turborepo |
|---|---|---|
| Is a | package manager | task runner |
| Does | installs deps, links workspace packages | orchestrates and caches `build`/`test`/`lint` |
| Replaces | npm, yarn | nothing — it calls your package manager |

Turbo runs on top of pnpm. Dropping Turbo leaves you with `pnpm -r --parallel run build`, which
works — you lose build caching and `--filter='...[origin/main]'`, and that filter is what stops
a driver-app text change from rebuilding and redeploying the API. Dropping pnpm is not an
option; something has to install the packages.

## `.npmrc` — the one setting you must not change

```ini
node-linker=hoisted
```

pnpm's default linker builds `node_modules` from symlinks into a content-addressed store.
Metro, React Native's bundler, resolves modules by walking real directories and does not follow
those symlinks — so `@driverzone/contracts` resolves to nothing and the app fails with
`Unable to resolve module`, which reads like a broken install rather than a linker setting.

The cost is losing pnpm's protection against **phantom dependencies** (importing a package you
did not declare). We accept it because dependency-cruiser's `not-to-unresolvable` rule catches
the same class of mistake at a different point. See [08](08-mobile-in-monorepo.md).

## Where does my code go?

| I'm writing… | It goes in |
|---|---|
| A new API endpoint | `apps/api/src/modules/<module>/interface/` |
| A business rule | `apps/api/src/modules/<module>/domain/` |
| A Mongoose model | `apps/api/src/modules/<module>/infrastructure/` |
| A type both the API and an app need | `packages/contracts/src/` |
| Geometry, coordinates, zone validation | `packages/geo/src/` |
| A React component for the admin panel | `packages/design-system/src/` (reusable) or `apps/web/src/` (page-specific) |
| A React Native component both apps use | `packages/mobile-ui/src/` |
| A colour, spacing or font value | `packages/design-system/src/tokens.ts` — the one file web *and* native share |
| A cross-cutting API utility (logging, errors, db) | `apps/api/src/shared/` |

**`apps/api/src/shared/` vs `packages/`**: `shared/` is for things only the API needs — the
Mongo connection, the Express error handler, the logger. If a second app would want it, it is a
package instead. `shared/` sits *below* every module and may never import from `modules/`.

## Adding a package

1. `mkdir packages/<name>/src`
2. `package.json` with `"name": "@driverzone/<name>"`, `"exports": { ".": "./src/index.ts" }`,
   and `@driverzone/config` in `devDependencies`
3. `tsconfig.json` extending `@driverzone/config/tsconfig.base.json` (or `tsconfig.react.json`)
4. `.eslintrc.cjs`:
   ```js
   module.exports = { root: true, extends: [require.resolve('@driverzone/config/eslint.base.cjs')] };
   ```
   `require.resolve`, not the bare specifier — ESLint 8's own `extends` resolver ignores a
   package's `exports` map and fails with "couldn't find the config to extend from".
5. `pnpm install` to link it
6. If the API will consume it, add it to **both** Dockerfiles' `deps` and `build` stages —
   a missing `COPY` there fails the image build, not the local one

## Root scripts

```bash
pnpm dev          # every app in watch mode
pnpm typecheck    # tsc --noEmit everywhere
pnpm lint         # eslint + dependency-cruiser
pnpm test
pnpm check        # typecheck + lint + test
pnpm ci           # the above, filtered to what changed since origin/main
pnpm format
```
