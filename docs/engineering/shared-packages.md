# Shared Packages

Five packages in `packages/`. Each has a narrow job and a clear rule about what must never go
in it.

All of them publish **TypeScript source**, not a build:

```json
{ "exports": { ".": "./src/index.ts" } }
```

Consumers compile them — Next via `transpilePackages`, Metro natively, the API via esbuild.
One less build step, one less thing to be stale, and jump-to-definition lands on real source
instead of a `.d.ts`.

---

## `@driverzone/contracts`

**The wire format.** Request and response shapes, error codes, the HTTP envelope.

**Consumed by:** all four apps.

**Contains:** types only. Nothing that compiles to JavaScript.

```ts
export interface HttpSuccessBody<T> { success: true; statusCode: number; data: T; … }
export const UNAVAILABLE_REASONS = ['ZONE_NO_PICKUP_COVERAGE', 'DROP_OUTSIDE_CITY', …] as const;
export interface Money { amount_paise: number; amount_display: string }
```

**Must never contain:** business logic, validation, formatting, anything with behaviour. A
function here would ship into three client bundles to serve one of them.

### Why the API depends on this rather than mirroring it

The team's previous monorepo deliberately gave its API no workspace dependencies and
hand-mirrored ~900 lines of shared types into a package, keeping the two in sync by hand.

With **one** consumer that is tolerable. DriverZone has **three** — the admin panel and two
mobile apps — so the drift risk triples, and the consequence is different in kind: a web/API
mismatch is a redeploy, while a mobile/API mismatch is a store binary you cannot recall. Users
sit on old versions for months.

So `apps/api` depends on `@driverzone/contracts` directly. One definition, four readers, and a
renamed field is a type error in three apps at build time rather than a runtime surprise in a
shipped binary.

The cost is that both Dockerfiles must `COPY packages/contracts` in their build stage. That is
a visible, loud failure — the image build fails — rather than a silent one.

---

## `@driverzone/geo`

**Coordinates, zone invariants, terrain classification.** The package that carries the most
weight per line in the repo.

**Consumed by:** `apps/api` (the zones write guard, terrain), `apps/web` (live map-editor
validation).

```ts
// coords.ts     — the ONE place [lng,lat] ordering is handled
assertPlausibleCoordinate(p, 'pickup');
toGeoJsonPoint(p);

// zone-rules.ts — the invariants that used to be PostGIS triggers
validateZone({ geom, siblings });               // → ZoneViolation[]
// parentGeom is optional and nothing supplies one: Z-1 was retired with the
// pickup→city parent link. checkWithinParent and clipToParent stay, dormant.

// terrain.ts    — DORMANT. Terrain is now decided by whether the drop point falls inside a
//                 hill zone, not by measuring the route (docs/LLD/packages.md §Terrain).
//                 Retained and tested so reviving route-based classification is a wiring
//                 change; the trigger is drivers reporting specific routes as underpaid.
classifyTerrain(route, hillZones, thresholdMetres);
```

### Why this is a package and not `apps/api/src/shared/`

Because the admin map editor needs the identical code.

When an admin drags a pickup-zone corner across a neighbouring zone, the editor must say so
*immediately*, with the offending area painted red — not after a round trip on save. And the
editor's verdict must never disagree with the API's, because "it looked fine in the editor but
the save failed" is the kind of bug that makes people stop trusting a tool.

The only reliable way to guarantee agreement is to run the same code in both places. Turf works
in the browser, so this is possible; making it a package is what makes it happen.

### Why it is load-bearing

The invariants in [`../LLD/domain-model.md`](../LLD/domain-model.md) were PostGIS triggers. Under
MongoDB they live here.

That means a bug in `zone-rules.ts` is not a UI defect — it is a bad polygon in production, a
customer being told a city you serve is unserved, and a `ZONE_CONFIG_FAULT` alert at an
inconvenient hour. It has 31 tests covering every case in
[`../LLD/zone-resolution.md`](../LLD/zone-resolution.md), including the awkward ones: a point
exactly on a shared border, neighbours whose hand-drawn edges nearly coincide, a route grazing a
hill zone for 800m.

**Must never contain:** database access, HTTP calls, anything not a pure function of geometry.

---

## `@driverzone/design-system`

**Web React components and the design tokens.**

**Consumed by:** `apps/web`. And `src/tokens.ts` alone by `@driverzone/mobile-ui`.

```ts
// tokens.ts — plain values, zero imports
export const colors = { bg: '#ffffff', brand: '#0b6bcb', zonePickupPaid: '#9a6700', … };
export const space  = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 };
```

`tokens.ts` importing nothing is what lets React Native consume it without dragging a single
web dependency into a Metro bundle. Keep it that way — the moment it imports a React component,
`mobile-ui` cannot use it.

**Must never contain:** business logic, API calls, React Native components.

---

## `@driverzone/mobile-ui`

**React Native components shared by both apps.**

**Consumed by:** `apps/customer`, `apps/driver`.

### Why this is separate from `design-system`

A `div` is not a `View`. Web components import `react-dom` and Radix; native components import
`react-native`. A package containing both would pull react-dom into a Metro bundle and
react-native into a browser bundle, and neither survives that.

The two packages share **tokens and nothing else**. That is the correct amount of sharing: the
values (brand blue, 16px spacing) genuinely should match across web and native; the
implementations genuinely cannot.

Components that belong here: the trip card, the fare breakdown, the OTP input, the map marker —
anything both the customer and driver apps render. Components used by only one app stay in that
app.

---

## `@driverzone/config`

**Shared tsconfig and ESLint bases.** No source.

```
tsconfig.base.json     strict, ES2022, NodeNext        → api, contracts, geo
tsconfig.react.json    extends base + JSX + DOM libs   → web, design-system, mobile-ui, apps
eslint.base.cjs        the rules every package shares
```

Extend it like this:

```js
module.exports = { root: true, extends: [require.resolve('@driverzone/config/eslint.base.cjs')] };
```

**`require.resolve`, not the bare specifier.** ESLint 8's own `extends` resolver does not honour
a package's `exports` map and fails with "couldn't find the config to extend from" even though
the file is plainly there. Node's `require` honours it.

Note also that **the ESLint toolchain itself lives in the root `package.json`**, not here. In a
hoisted layout leaf packages resolve binaries from the root `node_modules`, and a devDependency
of `@driverzone/config` is not installed for its consumers — so `eslint` and the
`@typescript-eslint/*` plugins have to be root devDependencies or nothing can run `lint`.

---

## Deciding where something goes

```
Does it have behaviour (compiles to JS)?
├── no  → @driverzone/contracts
└── yes
    └── Is it geometry?
        ├── yes → @driverzone/geo
        └── no
            └── Is it a UI component?
                ├── web only    → @driverzone/design-system
                ├── native only → @driverzone/mobile-ui
                └── both        → it's a token. tokens.ts.
            └── Not UI?
                └── Does more than one APP need it?
                    ├── yes → a new package
                    └── no  → apps/api/src/shared/ (or that app's own src/)
```

## Two rules that keep this from rotting

**A package never depends on an app.** Dependencies flow `apps → packages`, never back. A
package needing something from an app means the thing is in the wrong place.

**A package with one consumer is usually premature.** `apps/api/src/shared/` is the right home
until a second app genuinely wants it. Promoting later is a `git mv` and a manifest; demoting a
package nobody else uses is awkward and rarely happens.

`@driverzone/geo` looks like a violation of that rule — the API is its main consumer today. It
is not: the admin editor is a *known, imminent* second consumer, and the whole reason it exists
is that both must run identical code.
