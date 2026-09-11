/**
 * Machine-checks the architectural invariants that TypeScript cannot see.
 *
 * ESLint (`.eslintrc.cjs`) already blocks the ALIAS spelling of a cross-module import and is
 * the faster feedback loop, so it stays. But `no-restricted-imports` matches the literal
 * source string rather than the resolved file, which makes it structurally unable to do the
 * rules below:
 *
 *  - it cannot see a RELATIVE escape. The obvious pattern for it, `../../*​/domain/*`, matches
 *    the `..` segment and so flags the legal `../../domain/x.js` while missing the illegal
 *    `../../zones/domain/x.js` — exactly backwards.
 *  - it cannot see a CYCLE at all, because a cycle is a property of the graph, not of one import.
 *
 * dependency-cruiser resolves every import to a real path, so how it was spelled stops
 * mattering. ESLint is the echo; this file is the authority.
 *
 * Under MongoDB this file also carries DATA INTEGRITY, not just tidiness. The zone invariants
 * in docs/LLD/domain-model.md were PostGIS triggers — a bad polygon could not be saved. Mongo
 * cannot express a cross-document geometric constraint, so those checks live in
 * @driverzone/geo and run in the zones module's write path. That is only a real guarantee
 * while `module-internals-are-private` holds: it is what stops another module reaching
 * `zones/infrastructure/` and writing a polygon that was never validated.
 */

/**
 * The module dependency graph, as tiers. A module may import only from a STRICTLY LOWER tier.
 *
 * This exists because `no-circular` below cannot enforce it. `no-circular` works on files, and
 * a module-level cycle usually never becomes a file-level one: a `.public.ts` imports nothing
 * but its own domain types, so `dispatch → bookings.public` plus `bookings → dispatch.public`
 * is two modules depending on each other with no file cycle anywhere to find.
 *
 * Same-tier imports are forbidden too. Two modules on one tier importing each other is exactly
 * the mutual coupling this prevents, so a genuine dependency between them means one of them
 * belongs on a higher tier.
 *
 * **Adding a module means adding it here**, and that is deliberate. Choosing its tier is
 * choosing what it may ever depend on — the decision hardest to unwind once siblings rely on it.
 */
const MODULE_TIERS = [
  // pricing is PURE: rates and durations in, a FareBreakdown out, no I/O. That is what lets
  // the most dispute-prone logic in the product be tested without a database (docs/LLD/architecture.md).
  // `faq` is here for the plainest possible reason: it imports nothing. It is admin-authored
  // content that no other module reads — nothing in the API decides anything from an FAQ, and
  // the day something wants to, the value belongs in `settings` instead.
  ['health', 'settings', 'pricing', 'faq'],
  ['identity'], //                     customers, drivers, admins, auth
  // payments sits beside them rather than above: it collects from CUSTOMERS, while ledger records
  // what is owed to DRIVERS. Neither reads the other, and the booking that ties the two together
  // is four tiers up.
  // `wallet` joins them for the same reason: it is rows and their sum, depends on nothing, and
  // everything that moves money needs it. It is a CUSTOMER ledger where `ledger` is a driver one,
  // and the two never speak — same tier is what keeps it that way.
  ['notifications', 'ledger', 'payments', 'wallet'], // push/socket fan-out; earnings; customer money
  ['zones'], //                        polygons, resolution, the invariant write guard
  ['packages'], //                     packages, variants, prices
  ['quotes'], //                       zones + packages + pricing
  ['bookings'], //                     quotes + pricing + identity + notifications + ledger
  // Between the two, and it has to be both. It reads `bookings` because a customer may only
  // favourite a driver they have really ridden with — without that proof the endpoint is an
  // oracle for arbitrary driver ids — and `dispatch` reads IT because the favourite wave is the
  // first thing that rings. That pair is why favourites is a module and not an array on the
  // customer document: `identity` is at tier 1 and cannot see a booking from there.
  ['favourites'], //                   identity (driver cards) + bookings (proof of a shared trip)
  // Same tier, and they never speak: dispatch finds a driver for a booking, reviews reads one
  // that is already over. Both need `bookings` below them and nothing needs either.
  ['dispatch', 'reviews'], //          dispatch: the only module permitted to set bookings.driverId
  ['admin', 'reporting'], //           top of the graph; nothing may depend on these
];

const layeringRules = MODULE_TIERS.map((tier, index) => {
  const below = MODULE_TIERS.slice(0, index).flat();
  return {
    name: `tier-${index}-${tier.join('-')}`,
    comment:
      `${tier.join(' and ')} may import only: ${below.join(', ') || '(no other module)'}. ` +
      'An import pointing sideways or upward means either the dependency is backwards, or this ' +
      'module belongs on a different tier — decide which before editing MODULE_TIERS.',
    severity: 'error',
    from: { path: `^src/modules/(${tier.join('|')})/` },
    to: {
      path: '^src/modules/[^/]+/',
      pathNot: [`^src/modules/$1/`, ...(below.length ? [`^src/modules/(${below.join('|')})/`] : [])],
    },
  };
});

module.exports = {
  options: {
    doNotFollow: { path: 'node_modules' },

    /*
     * Resolves the `@/*` alias. Without it every aliased import becomes unresolvable, and since
     * an unresolvable import has no `to` path, EVERY rule below would pass vacuously — a green
     * that means nothing. `not-to-unresolvable` is what turns that failure mode into a loud one.
     */
    tsConfig: { fileName: 'tsconfig.json' },

    /*
     * Required, and the least obvious setting here. Without it dependency-cruiser ignores
     * `import type` — and a layer violation is very often type-only. Off, this reports a clean
     * tree that is not clean.
     */
    tsPreCompilationDeps: true,

    /*
     * ESM/NodeNext: a .ts source imports its sibling as './x.js', so .ts must resolve first.
     *
     * `exportsFields`/`conditionNames` are what let the workspace packages resolve at all:
     * @driverzone/geo and @driverzone/contracts publish TypeScript source via
     * `exports: { ".": "./src/index.ts" }`, and without these the resolver ignores the exports
     * map, fails to find them, and `not-to-unresolvable` fires on every import of either —
     * which looks like a code problem and is not.
     */
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },

  forbidden: [
    {
      name: 'not-to-unresolvable',
      comment:
        'An import that resolves to nothing. Usually a typo or a missing .js extension — but if ' +
        'it is the @/ alias failing wholesale, every other rule here has silently stopped ' +
        'checking anything. Treat a spike as the config being broken, not the code.',
      severity: 'error',
      from: { path: '^src' },
      to: { couldNotResolve: true },
    },

    {
      name: 'no-circular',
      comment:
        'A cycle between FILES. TypeScript compiles one happily and ESM resolves it at runtime, ' +
        'so it surfaces as an `undefined` dependency while a container is being constructed — ' +
        'far from the import that caused it.',
      severity: 'error',
      from: { path: '^src' },
      to: { circular: true },
    },

    {
      name: 'module-internals-are-private',
      comment:
        "A module's layers, its container and every other file at its root are private. " +
        "Cross-module means '<name>.public.ts', nothing else. Because this matches resolved " +
        'paths it closes the relative-escape, container and module-root holes at once, ' +
        'whichever way the import is spelled. Under Mongo this rule also protects the zone ' +
        'invariants — see the header.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/[^/]+/',
        pathNot: [
          // Your own module — reach into it however you like.
          '^src/modules/$1/',
          // Any module's public contract — the one legal way across.
          '^src/modules/[^/]+/[^/]+\\.public\\.ts$',
        ],
      },
    },

    {
      name: 'domain-imports-nothing-above-it',
      comment:
        'domain/ is the innermost layer: entities, value objects and the PORTS describing what ' +
        'it needs. It must not know a Mongoose model or an Express route exists. A type-only ' +
        'import counts — importing a type from infrastructure/ still means the schema, not the ' +
        'domain, owns that shape.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain/' },
      to: { path: '^src/modules/[^/]+/(application|infrastructure|interface)/' },
    },

    {
      name: 'application-depends-on-ports-not-adapters',
      comment:
        'A use case depends on the port in domain/, never on the concrete adapter implementing ' +
        'it. Typing a field against the class instead of the interface is what makes a use case ' +
        'untestable without the real thing — the container is the only place naming an adapter.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/application/' },
      to: { path: '^src/modules/[^/]+/(infrastructure|interface)/' },
    },

    {
      name: 'interface-depends-on-ports-not-adapters',
      comment:
        'Same rule as the layer below: controllers, routers and guards are handed what they ' +
        'need by the container and type it against a port.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/interface/' },
      to: { path: '^src/modules/[^/]+/infrastructure/' },
    },

    {
      name: 'shared-is-below-modules',
      comment:
        'shared/ sits below every module — errors, logging, db, queue, http. An import pointing ' +
        'the other way inverts that and puts every module on the shortest path to a cycle.',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/modules/' },
    },

    ...layeringRules,
  ],
};
