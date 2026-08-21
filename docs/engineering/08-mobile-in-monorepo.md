# 08 — Mobile in the Monorepo

Two React Native apps live alongside the API and the admin panel. That works well, and there is
exactly one trap. This doc is mostly about the trap.

## The trap: Metro cannot see pnpm's `node_modules`

**Symptom:**

```
error: Unable to resolve module @driverzone/contracts from
  /home/you/driverzone/apps/customer/App.tsx
```

or, more confusingly:

```
error: Unable to resolve module react-native from …
```

That second one reads like a broken install. It is not — the install is fine.

**Cause:** pnpm's default `isolated` linker builds `node_modules` out of symlinks into a
content-addressed store. Metro resolves modules by walking **real** directories upward from the
importing file and does not follow those symlinks. So the packages are installed, present, and
invisible.

**Fix — three parts, all required:**

### 1. `.npmrc` at the repo root

```ini
node-linker=hoisted
```

Produces an npm-style flat `node_modules` tree that Metro can walk. This is the load-bearing
one: without it the other two do nothing.

The cost is losing pnpm's protection against **phantom dependencies** — importing a package you
never declared, which works locally and breaks when the hoisting order changes. We accept that
because `not-to-unresolvable` in
[dependency-cruiser](04-boundaries-and-enforcement.md#not-to-unresolvable) catches the same
class of mistake in CI.

### 2. `metro.config.js` in each app

```js
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Metro only resolves inside the project root unless told otherwise. Without this, editing a
// shared package does nothing until you clear the cache — the file is not being watched.
config.watchFolders = [workspaceRoot];

// pnpm installs most packages at the root. Without this: "Unable to resolve module react-native".
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// The workspace packages ship TypeScript source via `exports: "./src/index.ts"` rather than a
// build, so Metro has to read the exports map to find them.
config.resolver.unstable_enablePackageExports = true;
```

### 3. Verify it early

```bash
pnpm --filter @driverzone/customer start
```

Confirm the app bundles and that `@driverzone/mobile-ui` resolves. **Do this in week one.**
Discovering it in week six, mid-feature, is how a team ends up seriously proposing to move the
mobile apps out of the monorepo — a large change to fix a three-line config problem.

## Diagnosing resolution failures

```bash
# 1. Nuke the caches. Metro caches resolution aggressively and stale entries look like bugs.
pnpm --filter @driverzone/customer exec expo start --clear

# 2. Is the package physically where Metro will look?
ls -la node_modules/@driverzone/          # should be real dirs or workspace links
ls node_modules/react-native/package.json # must exist at the ROOT under hoisted

# 3. Does the exports map point at something real?
cat packages/contracts/package.json | grep -A2 exports
```

Order matters: nine times out of ten it is the cache.

## Expo, not bare React Native

Two reasons, both practical:

- **Monorepo support.** Expo's tooling handles workspace resolution; bare RN needs manual
  Gradle and CocoaPods paths for every shared package.
- **EAS Build removes the Mac.** iOS builds happen on Expo's infrastructure. For a small team
  that is the difference between having a CI pipeline and not.

The cost is native-module access. Expo config plugins cover most of it, and `expo prebuild` is
the escape hatch if something genuinely cannot be a plugin — that is a change in build strategy,
not a rewrite.

## The driver app's real risk: the foreground service

[`../06-dispatch-and-assignment.md`](../06-dispatch-and-assignment.md) requires the driver app
to hold a **persistent socket** while on duty, because FCM alone will not reliably deliver a
45-second ringing trip offer.

On Android that means a **foreground service** — a permanent notification saying "DriverZone is
online" — which keeps the process alive and the socket connected.

This is the single largest technical unknown in the mobile plan:

- It needs an Expo config plugin (`expo-task-manager` + `expo-location` in background mode gets
  most of the way; a bespoke plugin may be needed for the exact notification behaviour)
- It interacts badly with OEM battery managers — see below
- Play Store review scrutinises background location and foreground services closely, and the
  listing must justify them

**Prototype this in week one, before committing to Expo managed.** If it cannot be done as a
plugin, that is a decision to make while it is cheap.

## OEM battery optimisation — budget real time for this

Xiaomi, Oppo, Vivo and Realme — the bulk of the Indian driver market — ship aggressive battery
managers that kill background apps and delay or drop FCM messages, sometimes by minutes.

A driver app that does not receive offers is not a driver app. Mitigations, all needed:

1. **Foreground service** while on duty (above)
2. An **onboarding flow** that walks the driver through per-OEM autostart and
   battery-optimisation settings, with screenshots for each brand
3. **Socket + FCM together**, always, with delivery tracked per offer
4. `delivered_via` / `delivered_at` on `dispatch_offers`, so an offer that lapsed but was never
   delivered is recorded as an **infrastructure failure** rather than counted against the
   driver's acceptance rate

That onboarding flow is tedious, unglamorous, and the highest-leverage screen in the driver app.

## Sharing code with the API

Both apps depend on `@driverzone/contracts` and `@driverzone/mobile-ui`.

**Do not import `@driverzone/geo` into a mobile app.** It pulls in Turf, which is substantial,
and neither app needs polygon boolean operations — the server resolves zones. If an app ever
needs a coordinate helper, split `coords.ts` into its own tiny package rather than shipping the
whole thing.

Bundle size matters more here than on the web: drivers are frequently on poor connections and
metered data.

## Builds

Mobile apps are **not** part of `turbo run build`. Their `build` script is a note pointing here.

```bash
pnpm --filter @driverzone/driver exec eas build --profile preview   --platform android
pnpm --filter @driverzone/driver exec eas build --profile production --platform android
```

They deploy to stores, not servers. See [09](09-build-and-deploy.md) — this is the concrete
answer to "do I need to ship the mobile code to the API server": no, and there is nowhere for
it to go.
